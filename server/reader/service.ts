import { createHash, randomUUID } from "node:crypto";
import {
  articleSummarySchema,
  dailyIssueSchema,
  occurrenceSchema,
  readerPreferencesSchema,
  readingProgressSchema,
  runAttemptSchema,
  readerSemanticRuntimeTraceSchema,
  type ArticleSummary,
  type DailyIssue,
  type Occurrence,
  type ReaderPreferences,
  type ReaderSemanticRuntimeTrace,
  type ReadingProgress,
  type RunAttempt,
  type RunAttemptTrigger,
} from "../../src/shared/reader-contract";
import { safeFetchArticle, type SafeHttpResponse } from "./safe-fetch";
import {
  collectEditorial,
  EditorialCollectionError,
  readArticleFullText,
} from "./editorial";
import type { JsonCompletionClient } from "../provider";
import type { SemanticExistingArticleInput } from "./semantic";
import { addLocalDays, localDateTime, resolveScheduledTime } from "./time";
import { ReaderStore, type ReaderTrace } from "./store";

export interface EditorialArticle extends ArticleSummary {
  paragraphs?: string[] | null;
  bodyHash?: string;
}

export interface EditorialTraceInput {
  queries: string[];
  candidates: Array<{
    url: string;
    publication?: string;
    outcome?: "DISCOVERED" | "ACCEPTED" | "REJECTED" | "DUPLICATE";
    reason?: string;
    statusCode?: number | null;
    articleId?: string | null;
  }>;
  decisions: string[];
  semantic?: ReaderSemanticRuntimeTrace;
}

export interface EditorialCollectionResult {
  status: "COMPLETE" | "PARTIAL" | "NOT_DELIVERED";
  articles: EditorialArticle[];
  candidates: EditorialArticle[];
  actual: {
    count: number;
    topics: string[];
    difficulty: ReaderPreferences["difficulty"] | null;
    readingMinutes: number;
  };
  unmetConstraints: string[];
  trace: EditorialTraceInput;
}

export interface EditorialCollectorOptions {
  fetchArticle: (url: string, signal?: AbortSignal) => Promise<SafeHttpResponse>;
  now?: () => Date;
  maxArticleChecks?: number;
  signal?: AbortSignal;
  semanticClient?: JsonCompletionClient;
  alreadyDelivered?: SemanticExistingArticleInput[];
}

export type EditorialCollector = (
  preferences: ReaderPreferences,
  options: EditorialCollectorOptions,
) => Promise<EditorialCollectionResult>;

export interface ArticleReference {
  id: string;
  title: string;
  originalPublication: string;
  originalUrl: string;
  accessiblePublication: string;
  accessibleUrl: string;
  topics: string[];
}

export type ArticleReopener = (
  reference: ArticleReference,
  fetchArticle: EditorialCollectorOptions["fetchArticle"],
  signal?: AbortSignal,
) => Promise<{ article: EditorialArticle | null; reason: string }>;

export interface ReaderServiceOptions {
  store?: ReaderStore;
  collect?: EditorialCollector;
  reopenArticle?: ArticleReopener;
  now?: () => Date;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  fetchArticle?: EditorialCollectorOptions["fetchArticle"];
  semanticClient?: JsonCompletionClient;
  /**
   * Whether this process owns future scheduled runs.
   *
   * Exactly one owner may exist: the Windows scheduled task. The development
   * server still recovers interrupted runs and catches up an overdue date when
   * it starts, but it must not arm its own timer, or a merely open browser
   * would compete with the scheduled task. When false, `armTimer` never
   * schedules work and a still-due occurrence is picked up by the task instead.
   */
  scheduleRuns?: boolean;
}

export class ReaderServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ReaderServiceError";
  }
}

interface BodyRecord {
  paragraphs: string[];
  bodyHash: string;
}

interface StartedRun {
  attempt: RunAttempt;
  issue: DailyIssue;
  preferences: ReaderPreferences;
}

function createId(prefix: string): string {
  return prefix + ":" + randomUUID();
}

function stableIssueId(localDate: string, timezone: string): string {
  return "issue:" + localDate + ":" + encodeURIComponent(timezone);
}

function sameTopic(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("en-US") === right.trim().toLocaleLowerCase("en-US");
}

function normalizedArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

/** How many preceding days count for the cross-day duplicate check. */
const DUPLICATE_WINDOW_DAYS = 7;

function articleDayNumber(localDate: string): number {
  return Math.floor(Date.parse(`${localDate}T00:00:00.000Z`) / 86_400_000);
}

function withinDays(candidateDate: string, issueDate: string, days: number): boolean {
  const candidate = articleDayNumber(candidateDate);
  const issue = articleDayNumber(issueDate);
  if (!Number.isFinite(candidate) || !Number.isFinite(issue)) return false;
  const gap = issue - candidate;
  return gap > 0 && gap <= days;
}

/** Titles are compared ignoring case, punctuation and spacing noise. */
function normalizedArticleTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function emptyIssue(
  localDate: string,
  preferences: ReaderPreferences,
  now: Date,
  edition = 1,
  priorEditions: number[] = [],
): DailyIssue {  return dailyIssueSchema.parse({
    id: stableIssueId(localDate, preferences.timezone),
    localDate,
    timezone: preferences.timezone,
    edition,
    status: "NOT_DELIVERED",
    target: preferences,
    actual: { count: 0, topics: [], difficulty: null, readingMinutes: 0 },
    unmetConstraints: ["No verified full-text articles have been delivered."],
    articles: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    priorEditions,
  });
}

function currentIssue(
  issues: DailyIssue[],
  localDate: string,
  timezone: string,
): DailyIssue | null {
  return (
    issues
      .filter((issue) => issue.localDate === localDate && issue.timezone === timezone)
      .sort((left, right) => right.edition - left.edition)[0] ?? null
  );
}

function safeErrorText(error: unknown): { message: string; retryable: boolean } {
  if (error && typeof error === "object") {
    const candidate = error as { retryable?: unknown; code?: unknown };
    if (candidate.retryable === true) {
      const retryableMessages: Record<string, string> = {
        reader_discovery_unavailable: "All preference-based discovery searches failed before returning results.",
        reader_source_unavailable: "All discovered source requests failed transiently before returning usable content.",
        reader_semantic_unavailable: "Semantic editorial review was unavailable before any new article could be delivered.",
      };
      if (typeof candidate.code === "string" && retryableMessages[candidate.code]) {
        return { message: retryableMessages[candidate.code]!, retryable: true };
      }
      return { message: "The collection service could not reach a required source.", retryable: true };
    }
    if (candidate.retryable === false) {
      return { message: "The collection could not be completed with verified article content.", retryable: false };
    }
  }
  return { message: "The collection service encountered a temporary error.", retryable: true };
}

function summaryOnly(article: EditorialArticle): ArticleSummary {
  const {
    paragraphs: _paragraphs,
    bodyHash: _bodyHash,
    ...summary
  } = article;
  return articleSummarySchema.parse(summary);
}

function scopeSummary(
  article: EditorialArticle,
  issueId: string,
  edition: number,
): ArticleSummary {
  const summary = summaryOnly(article);
  const scopedId = createHash("sha256")
    .update(issueId + "|" + edition + "|" + normalizedArticleUrl(summary.originalUrl))
    .digest("hex")
    .slice(0, 40);
  return articleSummarySchema.parse({ ...summary, id: "article:" + scopedId });
}

function isFullText(article: ArticleSummary): boolean {
  return article.contentStatus === "FULL_TEXT";
}

function deliveredReadingIssue(issue: DailyIssue): DailyIssue {
  const articles = issue.articles.filter(isFullText);
  if (articles.length === issue.articles.length) return issue;
  return { ...issue, articles };
}

function isFullTextIssue(issue: DailyIssue): boolean {
  return issue.articles.some(isFullText);
}

/**
 * The calendar date before `localDate`, taken from the days the store already
 * knows about so no timezone arithmetic is invented here.
 */
function previousCalendarDate(
  localDate: string,
  state: ReturnType<ReaderStore["snapshot"]>,
): string {
  const known = new Set<string>();
  for (const issue of state.issues) known.add(issue.localDate);
  for (const occurrence of state.occurrences) known.add(occurrence.localDate);
  known.delete(localDate);
  let previous: string | null = null;
  for (const candidate of known) {
    if (candidate >= localDate) continue;
    if (!previous || candidate > previous) previous = candidate;
  }
  // With no earlier day recorded, the previous day is the only sensible answer.
  return previous ?? addLocalDays(localDate, -1);
}

function isSuitable(article: ArticleSummary, preferences: ReaderPreferences): boolean {
  if (!isFullText(article) || article.fkgl === null || article.sentenceCount < 1) return false;
  if (!preferences.topics.some((topic) => article.topics.some((candidate) => sameTopic(topic, candidate)))) {
    return false;
  }
  const measuredDifficulty =
    article.fkgl <= 8 ? "Easy" : article.fkgl <= 12 ? "Intermediate" : "Advanced";
  return measuredDifficulty === preferences.difficulty;
}

function sanitizeTraceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|auth|key|password|session)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().slice(0, 2048);
  } catch {
    return "https://invalid.example/";
  }
}

function safeTraceText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function toStoredTrace(
  input: EditorialTraceInput,
  id: string,
  issue: DailyIssue,
  createdAt: Date,
): ReaderTrace {
  return {
    id,
    issueId: issue.id,
    edition: issue.edition,
    createdAt: createdAt.toISOString(),
    queries: input.queries.slice(0, 50).map((item) => safeTraceText(item, 300)),
    candidates: input.candidates.slice(0, 300).map((item) => ({
      url: sanitizeTraceUrl(item.url),
      publication: safeTraceText(item.publication, 160),
      outcome: item.outcome ?? "DISCOVERED",
      reason: safeTraceText(item.reason, 500),
      statusCode: typeof item.statusCode === "number" ? item.statusCode : null,
      articleId: typeof item.articleId === "string" ? item.articleId.slice(0, 128) : null,
    })),
    decisions: input.decisions.slice(0, 100).map((item) => safeTraceText(item, 500)),
    ...(input.semantic ? { semantic: readerSemanticRuntimeTraceSchema.parse(input.semantic) } : {}),
  };
}

function issueFulfillment(
  target: ReaderPreferences,
  articles: ArticleSummary[],
  editorialUnmet: string[],
): Pick<DailyIssue, "status" | "actual" | "unmetConstraints"> {
  const fullText = articles.filter(isFullText);
  const topics = [...new Set(fullText.flatMap((article) => article.topics))];
  const difficulties = [...new Set(fullText.map((article) => article.difficulty).filter(Boolean))];
  const readingMinutes = fullText.reduce((total, article) => total + article.wordCount / 200, 0);
  const constraints: string[] = [];
  if (fullText.length !== target.dailyArticleCount) {
    constraints.push("Verified full-text article count is " + fullText.length + " of " + target.dailyArticleCount + ".");
  }
  const unsuitableTopics = fullText.some(
    (article) => !target.topics.some((topic) => article.topics.some((candidate) => sameTopic(topic, candidate))),
  );
  if (unsuitableTopics) constraints.push("One or more delivered full-text articles do not match the saved topics.");
  if (fullText.some((article) => !isSuitable(article, target))) {
    constraints.push("One or more delivered full-text articles do not match the saved reading difficulty.");
  }
  const lowMinutes = target.readingBudgetMinutes * 0.7;
  if (fullText.length > 0 && readingMinutes < lowMinutes) {
    constraints.push("Estimated reading time is below 70% of the saved reading budget.");
  }
  if (readingMinutes > target.readingBudgetMinutes) {
    constraints.push("Estimated reading time exceeds the saved reading budget.");
  }
  const complete =
    fullText.length === target.dailyArticleCount &&
    !unsuitableTopics &&
    fullText.every((article) => isSuitable(article, target)) &&
    readingMinutes >= lowMinutes &&
    readingMinutes <= target.readingBudgetMinutes;
  const unmetConstraints = complete
    ? []
    : [...new Set([...editorialUnmet, ...constraints])];
  return {
    status: complete ? "COMPLETE" : fullText.length === 0 ? "NOT_DELIVERED" : "PARTIAL",
    actual: {
      count: fullText.length,
      topics,
      difficulty: difficulties.length === 1 ? difficulties[0] : null,
      readingMinutes,
    },
    unmetConstraints,
  };
}

function isTerminalOccurrence(status: Occurrence["status"]): boolean {
  return status === "COMPLETED" || status === "ALREADY_FULFILLED" || status === "MISSED" || status === "EXHAUSTED";
}

function occurrenceId(localDate: string, timezone: string): string {
  return "occurrence:" + localDate + ":" + encodeURIComponent(timezone);
}

export class ReaderService {
  readonly store: ReaderStore;
  private readonly now: () => Date;
  private readonly setTimer: NonNullable<ReaderServiceOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<ReaderServiceOptions["clearTimer"]>;
  private readonly fetchArticle: EditorialCollectorOptions["fetchArticle"];
  private readonly semanticClient?: JsonCompletionClient;
  private readonly collector?: EditorialCollector;
  private readonly reopenArticle?: ArticleReopener;
  private readonly bodies = new Map<string, BodyRecord>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly scheduleRuns: boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private pulseQueue: Promise<void> = Promise.resolve();

  constructor(options: ReaderServiceOptions = {}) {
    this.store = options.store ?? new ReaderStore();
    this.now = options.now ?? (() => new Date());
    this.scheduleRuns = options.scheduleRuns ?? true;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.fetchArticle = options.fetchArticle ?? ((url) => safeFetchArticle(url));
    this.semanticClient = options.semanticClient;
    this.collector = options.collect ?? collectEditorial;
    this.reopenArticle = options.reopenArticle ?? readArticleFullText;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.store.initialize();
    this.started = true;
    // Any attempt still marked RUNNING belongs to a previous process, because
    // the work itself lived in memory. Clear it before scheduling so a single
    // unexpected restart cannot block today's collection forever.
    await this.recoverInterruptedRuns();
    await this.pulse("catch-up");
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /**
   * Return an occurrence whose run was interrupted to a schedulable state.
   *
   * Recovery must never become a reason to collect early: when the configured
   * time is still ahead, a manual run leaves the occurrence waiting for its
   * original schedule, and a scheduled run only re-arms its own bounded retry.
   * Catch-up happens immediately only once that time has passed.
   */
  private restoreInterruptedOccurrence(
    occurrence: Occurrence,
    options: { now: Date; trigger: RunAttemptTrigger },
  ): void {
    const { now, trigger } = options;
    const scheduledAt = new Date(occurrence.scheduledAt).getTime();
    const isManual = trigger === "manual" || trigger === "regenerate";
    if (Number.isFinite(scheduledAt) && scheduledAt > now.getTime()) {
      if (isManual) {
        occurrence.status = "WAITING";
        occurrence.nextAttemptAt = null;
        occurrence.updatedAt = now.toISOString();
        return;
      }
      this.settleOccurrenceAfterRun(occurrence, {
        now,
        retryable: true,
        retryDelayMs: occurrence.scheduledAttemptCount === 1 ? 5 * 60_000 : 15 * 60_000,
      });
      return;
    }
    // The configured time has passed, so catching up on this startup is the
    // point of recovery and the retry is due immediately.
    this.settleOccurrenceAfterRun(occurrence, {
      now,
      retryable: true,
      retryDelayMs: 0,
    });
  }

  /**
   * Recover runs that an unexpected service restart left behind.
   *
   * Collection tasks live in memory, so after a restart every persisted
   * RUNNING attempt is orphaned by definition: nothing will ever complete it,
   * yet `startManualRun` and `beginScheduledRun` both refuse to start while a
   * RUNNING attempt exists. This marks those attempts failed and returns their
   * occurrence to a schedulable state exactly once, which makes recovery
   * idempotent and keeps today's catch-up available. Existing issues, editions,
   * delivered articles and reading progress are never touched.
   */
  private async recoverInterruptedRuns(): Promise<void> {
    const now = this.now();
    const interrupted = this.store
      .snapshot()
      .attempts.filter((attempt) => attempt.state === "RUNNING" && attempt.completedAt === null);
    if (interrupted.length === 0) return;
    const interruptedIds = new Set(interrupted.map((attempt) => attempt.id));

    await this.store.update((state) => {
      const recoveredAt = now.toISOString();
      for (const attempt of state.attempts) {
        if (!interruptedIds.has(attempt.id)) continue;
        attempt.state = "FAILED";
        attempt.completedAt = recoveredAt;
        attempt.retryable = true;
        attempt.failureReason =
          "The collection was interrupted by a service restart and was recovered automatically.";
      }
      for (const attempt of interrupted) {
        const issue = state.issues.find(
          (candidate) =>
            candidate.id === attempt.issueId && candidate.edition === attempt.edition,
        );
        if (issue?.status === "COMPLETE") continue;
        const occurrence = state.occurrences.find(
          (candidate) =>
            (issue
              ? candidate.localDate === issue.localDate && candidate.timezone === issue.timezone
              : candidate.id === attempt.issueId.replace("issue:", "occurrence:")),
        );
        if (!occurrence || isTerminalOccurrence(occurrence.status)) continue;
        if (occurrence.lastAttemptId === attempt.id) {
          occurrence.lastAttemptId = null;
        }
        this.restoreInterruptedOccurrence(occurrence, { now, trigger: attempt.trigger });
      }
    });
  }

  async waitForIdle(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.all([...this.tasks.values()].map((task) => task.catch(() => undefined)));
    }
  }

  getPreferences(): ReaderPreferences {
    return this.requireStore().snapshot().preferences;
  }

  async setPreferences(input: ReaderPreferences): Promise<ReaderPreferences> {
    const preferences = readerPreferencesSchema.parse(input);
    await this.requireStore().update((state) => {
      state.preferences = preferences;
      state.preferencesConfigured = true;
    });
    await this.pulse("scheduled");
    return preferences;
  }

  today() {
    const state = this.requireStore().snapshot();
    const preferences = state.preferences;
    const now = this.now();
    const calendarDate = localDateTime(now, preferences.timezone).date;
    const date = calendarDate;
    const issue = currentIssue(state.issues, date, preferences.timezone);
    return {
      issue: issue ? deliveredReadingIssue(issue) : null,
      latest: this.latestIssueStatus(state, now),
      calendarDate,
      occurrence:
        state.occurrences.find(
          (item) => item.localDate === date && item.timezone === preferences.timezone,
        ) ?? null,
      attempts: state.attempts
        .filter((attempt) => attempt.issueId === stableIssueId(date, preferences.timezone))
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    };
  }

  /**
   * Which issue the Reader should present as "the latest scheduled issue".
   *
   * That is the most recent date whose configured collection time has already
   * passed. Before today's collection time it is yesterday, so a failed or
   * skipped run is reported honestly instead of showing an older date as if it
   * were current.
   */
  private latestIssueStatus(
    state: ReturnType<ReaderStore["snapshot"]>,
    now: Date,
  ): {
    date: string;
    issue: DailyIssue | null;
    occurrence: Occurrence | null;
    delivered: boolean;
    latestDeliveredDate: string | null;
  } {
    const preferences = state.preferences;
    const today = localDateTime(now, preferences.timezone).date;
    const scheduledToday = resolveScheduledTime(
      today,
      preferences.collectionTime,
      preferences.timezone,
    ).getTime();
    const date =
      now.getTime() >= scheduledToday ? today : previousCalendarDate(today, state);
    const issue = currentIssue(state.issues, date, preferences.timezone);
    const occurrence =
      state.occurrences.find(
        (item) => item.localDate === date && item.timezone === preferences.timezone,
      ) ?? null;
    // The most recent issue that actually delivered readable articles, which may
    // be an older date than the latest scheduled one.
    const latestDelivered =
      this.archive(60).find((candidate) => candidate.articles.some(isFullText)) ?? null;
    return {
      date,
      issue: issue ? deliveredReadingIssue(issue) : null,
      occurrence,
      delivered: Boolean(issue && isFullTextIssue(issue)),
      latestDeliveredDate: latestDelivered?.localDate ?? null,
    };
  }

  archive(limit = 30): DailyIssue[] {
    const state = this.requireStore().snapshot();
    const latestByDate = new Map<string, DailyIssue>();
    for (const issue of state.issues) {
      const key = issue.localDate + "|" + issue.timezone;
      const current = latestByDate.get(key);
      if (!current || current.edition < issue.edition) latestByDate.set(key, issue);
    }
    return [...latestByDate.values()]
      .sort((left, right) => right.localDate.localeCompare(left.localDate))
      .slice(0, limit)
      .map(deliveredReadingIssue);
  }

  /**
   * What one scheduled check decided, for the scheduler's own log.
   *
   * This is the observability the previous setup lacked: a missed or crashed
   * schedule used to leave nothing behind but an unchanged state file.
   */
  todayDecision(): {
    localDate: string;
    occurrenceStatus: string | null;
    occurrenceScheduledAt: string | null;
    nextAttemptAt: string | null;
    scheduledAttemptCount: number | null;
    issueStatus: string | null;
    deliveredCount: number;
    runningAttemptId: string | null;
    lastAttemptState: string | null;
    lastAttemptReason: string | null;
  } {
    const state = this.requireStore().snapshot();
    const preferences = state.preferences;
    const date = localDateTime(this.now(), preferences.timezone).date;
    const issueId = stableIssueId(date, preferences.timezone);
    const issue = currentIssue(state.issues, date, preferences.timezone);
    const occurrence =
      state.occurrences.find(
        (item) => item.localDate === date && item.timezone === preferences.timezone,
      ) ?? null;
    const attempts = state.attempts
      .filter((item) => item.issueId === issueId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    const last = attempts[attempts.length - 1] ?? null;
    return {
      localDate: date,
      occurrenceStatus: occurrence?.status ?? null,
      occurrenceScheduledAt: occurrence?.scheduledAt ?? null,
      nextAttemptAt: occurrence?.nextAttemptAt ?? null,
      scheduledAttemptCount: occurrence?.scheduledAttemptCount ?? null,
      issueStatus: issue?.status ?? null,
      deliveredCount: issue?.actual.count ?? 0,
      runningAttemptId:
        state.attempts.find((item) => item.issueId === issueId && item.state === "RUNNING")
          ?.id ?? null,
      lastAttemptState: last?.state ?? null,
      lastAttemptReason: last?.failureReason ?? null,
    };
  }

  /**
   * Recover one explicitly named historical issue through the normal collection
   * path.
   *
   * Only an unfulfilled day can be recovered, and the recovered articles are
   * discovered now and belong to the issue of the date that is named here, so
   * nothing is misdated and a completed earlier issue is never overwritten.
   */
  async backfillIssue(localDate: string): Promise<{
    localDate: string;
    issueStatus: string | null;
    deliveredCount: number;
    attemptId: string | null;
    refusal: string | null;
  }> {
    this.assertStarted();
    const state = this.store.snapshot();
    const preferences = state.preferences;
    const issue = currentIssue(state.issues, localDate, preferences.timezone);
    if (issue && issue.status === "COMPLETE" && issue.actual.count > 0) {
      return {
        localDate,
        issueStatus: issue.status,
        deliveredCount: issue.actual.count,
        attemptId: null,
        refusal: "This issue is already fulfilled; backfill never replaces it.",
      };
    }

    const trigger: RunAttemptTrigger = "backfill";
    const now = this.now();
    const issueId = stableIssueId(localDate, preferences.timezone);
    const started = await this.store.update((next) => {
      let target = currentIssue(next.issues, localDate, preferences.timezone);
      if (!target) {
        target = emptyIssue(localDate, preferences, now);
        next.issues.push(target);
      }
      let occurrence = next.occurrences.find(
        (item) => item.localDate === localDate && item.timezone === preferences.timezone,
      );
      if (!occurrence) {
        occurrence = occurrenceSchema.parse({
          id: occurrenceId(localDate, preferences.timezone),
          localDate,
          timezone: preferences.timezone,
          localTime: preferences.collectionTime,
          scheduledAt: resolveScheduledTime(
            localDate,
            preferences.collectionTime,
            preferences.timezone,
          ).toISOString(),
          status: "WAITING",
          scheduledAttemptCount: 0,
          maxScheduledAttempts: 3,
          nextAttemptAt: null,
          lastAttemptId: null,
          updatedAt: now.toISOString(),
        });
        next.occurrences.push(occurrence);
      }
      if (
        next.attempts.some(
          (item) => item.issueId === issueId && item.state === "RUNNING",
        )
      ) {
        return null;
      }
      const attempt = runAttemptSchema.parse({
        id: createId("attempt"),
        issueId,
        edition: target.edition,
        trigger,
        state: "RUNNING",
        startedAt: now.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: target.actual.count,
        traceId: createId("trace"),
      });
      next.attempts.push(attempt);
      occurrence.lastAttemptId = attempt.id;
      occurrence.updatedAt = now.toISOString();
      return { attempt, issue: target, preferences: next.preferences };
    });

    if (!started) {
      return {
        localDate,
        issueStatus: issue?.status ?? null,
        deliveredCount: issue?.actual.count ?? 0,
        attemptId: null,
        refusal: "A collection for this issue is already running.",
      };
    }
    await this.collectAndRecord(started);
    const after = currentIssue(
      this.store.snapshot().issues,
      localDate,
      preferences.timezone,
    );
    return {
      localDate,
      issueStatus: after?.status ?? null,
      deliveredCount: after?.actual.count ?? 0,
      attemptId: started.attempt.id,
      refusal: null,
    };
  }

  edition(issueId: string, edition: number): DailyIssue | null {
    const issue =
      this.requireStore().snapshot().issues.find(
        (item) => item.id === issueId && item.edition === edition,
      ) ?? null;
    return issue ? deliveredReadingIssue(issue) : null;
  }

  runStatus(attemptId: string): { attempt: RunAttempt; issue: DailyIssue } | null {
    const state = this.requireStore().snapshot();
    const attempt = state.attempts.find((item) => item.id === attemptId);
    if (!attempt) return null;
    const issue =
      state.issues.find((item) => item.id === attempt.issueId && item.edition === attempt.edition) ??
      currentIssue(state.issues, this.today().issue?.localDate ?? "", this.getPreferences().timezone);
    return issue ? { attempt, issue: deliveredReadingIssue(issue) } : null;
  }

  async startManualRun(
    trigger: "manual" | "regenerate",
    confirmRegenerate = false,
  ): Promise<{ attempt: RunAttempt; issue: DailyIssue }> {
    this.assertStarted();
    const currentState = this.store.snapshot();
    const preferences = currentState.preferences;
    const date = localDateTime(this.now(), preferences.timezone).date;
    const oldIssue = currentIssue(currentState.issues, date, preferences.timezone);
    if (trigger === "regenerate" && !confirmRegenerate) {
      throw new ReaderServiceError("regenerate_confirmation_required", "Confirm before replacing today's issue.", 400);
    }
    if (trigger === "regenerate" && !oldIssue) {
      throw new ReaderServiceError("issue_not_found", "There is no issue to regenerate today.", 409);
    }
    if (trigger === "manual" && oldIssue?.status === "COMPLETE") {
      throw new ReaderServiceError(
        "issue_already_complete",
        "Today's completed issue can only be replaced with confirmed Regenerate.",
        409,
      );
    }
    const issueId = stableIssueId(date, preferences.timezone);
    const issueKey = issueId;
    const existingRunning = currentState.attempts.some(
      (attempt) =>
        attempt.issueId === issueKey &&
        attempt.state === "RUNNING",
    );
    if (existingRunning) {
      throw new ReaderServiceError("run_in_progress", "A collection is already running for today.", 409, true);
    }

    const started = await this.store.update((state) => {
      let issue = currentIssue(state.issues, date, preferences.timezone);
      if (trigger === "regenerate") {
        const editions = state.issues
          .filter((item) => item.id === issueId)
          .map((item) => item.edition);
        issue = emptyIssue(
          date,
          preferences,
          this.now(),
          (Math.max(0, ...editions) + 1),
          editions.sort((left, right) => left - right),
        );
        state.issues.push(issue);
      } else if (!issue) {
        issue = emptyIssue(date, preferences, this.now());
        state.issues.push(issue);
      }
      if (!issue) throw new ReaderServiceError("issue_unavailable", "Today's issue could not be prepared.", 500, true);
      const attempt = runAttemptSchema.parse({
        id: createId("attempt"),
        issueId,
        edition: issue.edition,
        trigger,
        state: "RUNNING",
        startedAt: this.now().toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: issue.actual.count,
        traceId: createId("trace"),
      });
      state.attempts.push(attempt);
      return { attempt, issue, preferences: state.preferences };
    });
    this.launchCollection(started);
    return { attempt: started.attempt, issue: started.issue };
  }

  async article(articleId: string, edition: number) {
    this.assertStarted();
    const state = this.store.snapshot();
    const issue = state.issues.find(
      (item) => item.edition === edition && item.articles.some((article) => article.id === articleId),
    );
    const article = issue?.articles.find((item) => item.id === articleId);
    const progress =
      state.progress.find(
        (item) => item.articleId === articleId && item.edition === edition && item.issueId === issue?.id,
      ) ?? null;
    if (!article || !issue) throw new ReaderServiceError("article_not_found", "This article is not in the saved archive.", 404);
    if (!isFullText(article)) return { article, paragraphs: null, progress };

    const memoryBody = this.bodies.get(articleId + "|" + edition);
    if (memoryBody) return { article, paragraphs: memoryBody.paragraphs, progress };

    const store = this.requireStore();
    const cachedMeta = store.snapshot().cachedBodies.find(
      (item) => item.articleId === articleId && item.edition === edition,
    );
    if (cachedMeta && article.cachePermission === "PERMITTED") {
      const cachedParagraphs = await store.readCache(articleId, edition, cachedMeta.bodyHash);
      if (cachedParagraphs) {
        this.bodies.set(articleId + "|" + edition, { paragraphs: cachedParagraphs, bodyHash: cachedMeta.bodyHash });
        return { article, paragraphs: cachedParagraphs, progress };
      }
    }
    if (!this.reopenArticle) {
      return {
        article: { ...article, contentStatus: "UNAVAILABLE" as const },
        paragraphs: null,
        progress,
      };
    }
    try {
      const result = await this.reopenArticle(
        {
          id: article.id,
          title: article.title,
          originalPublication: article.originalPublication,
          originalUrl: article.originalUrl,
          accessiblePublication: article.accessiblePublication,
          accessibleUrl: article.accessibleUrl,
          topics: article.topics,
        },
        this.fetchArticle,
      );
      if (!result.article?.paragraphs?.length) {
        return { article: { ...article, contentStatus: "UNAVAILABLE" as const }, paragraphs: null, progress };
      }
      const paragraphs = result.article.paragraphs;
      const bodyHash = result.article.bodyHash ?? "";
      this.bodies.set(articleId + "|" + edition, { paragraphs, bodyHash });
      if (article.cachePermission === "PERMITTED" && /^[a-f0-9]{64}$/.test(bodyHash)) {
        await store.saveCache(articleId, edition, bodyHash, paragraphs).catch(() => undefined);
      }
      return { article, paragraphs, progress };
    } catch {
      return { article: { ...article, contentStatus: "UNAVAILABLE" as const }, paragraphs: null, progress };
    }
  }

  async saveProgress(input: Omit<ReadingProgress, "updatedAt" | "readState">) {
    this.assertStarted();
    const state = this.store.snapshot();
    const issue = state.issues.find((item) => item.id === input.issueId && item.edition === input.edition);
    if (!issue || !issue.articles.some((article) => article.id === input.articleId)) {
      throw new ReaderServiceError("article_not_found", "This reading position is not in the saved archive.", 404);
    }
    const readState =
      input.scrollRatio >= 0.98
        ? "READ"
        : input.scrollRatio > 0.01 || input.firstVisibleParagraph > 0
          ? "IN_PROGRESS"
          : "UNREAD";
    const progress = readingProgressSchema.parse({
      ...input,
      updatedAt: this.now().toISOString(),
      readState,
    });
    await this.store.update((next) => {
      next.progress = next.progress.filter(
        (item) =>
          item.issueId !== progress.issueId ||
          item.articleId !== progress.articleId ||
          item.edition !== progress.edition,
      );
      next.progress.push(progress);
      const matchingIssue = next.issues.find(
        (item) => item.id === progress.issueId && item.edition === progress.edition,
      );
      if (matchingIssue) {
        matchingIssue.articles = matchingIssue.articles.map((article) =>
          article.id === progress.articleId ? { ...article, readState } : article,
        );
        matchingIssue.updatedAt = progress.updatedAt;
      }
    });
    return progress;
  }

  async pulse(trigger: "scheduled" | "catch-up" = "scheduled"): Promise<void> {
    if (!this.started) return;
    const run = this.pulseQueue.then(
      () => this.pulseOnce(trigger),
      () => this.pulseOnce(trigger),
    );
    this.pulseQueue = run.catch(() => undefined);
    return run;
  }

  private async pulseOnce(trigger: "scheduled" | "catch-up"): Promise<void> {
    await this.reconcileOccurrences();
    const state = this.store.snapshot();
    const preferences = state.preferences;
    const now = this.now();
    const date = localDateTime(now, preferences.timezone).date;
    const occurrence =
      state.occurrences.find(
        (item) => item.localDate === date && item.timezone === preferences.timezone,
      ) ?? null;
    if (occurrence) {
      const dueAt = occurrence.status === "RETRY_WAIT" && occurrence.nextAttemptAt
        ? new Date(occurrence.nextAttemptAt)
        : new Date(occurrence.scheduledAt);
      const issue = currentIssue(state.issues, date, preferences.timezone);
      if (issue?.status === "COMPLETE" && dueAt.getTime() <= now.getTime() && !isTerminalOccurrence(occurrence.status)) {
        await this.updateOccurrence(occurrence.id, {
          status: "ALREADY_FULFILLED",
          nextAttemptAt: null,
          updatedAt: now.toISOString(),
        });
      } else if (
        !isTerminalOccurrence(occurrence.status) &&
        occurrence.status !== "RUNNING" &&
        dueAt.getTime() <= now.getTime()
      ) {
        await this.beginScheduledRun(occurrence, trigger);
      }
    }
    this.armTimer();
  }

  private async reconcileOccurrences(): Promise<void> {
    const now = this.now();
    await this.store.update((state) => {
      const preferences = state.preferences;
      const today = localDateTime(now, preferences.timezone).date;
      for (const occurrence of state.occurrences) {
        if (
          occurrence.timezone === preferences.timezone &&
          occurrence.localDate < today &&
          !isTerminalOccurrence(occurrence.status)
        ) {
          occurrence.status = "MISSED";
          occurrence.nextAttemptAt = null;
          occurrence.updatedAt = now.toISOString();
        }
      }
      let occurrence = state.occurrences.find(
        (item) => item.localDate === today && item.timezone === preferences.timezone,
      );
      if (!occurrence) {
        occurrence = occurrenceSchema.parse({
          id: occurrenceId(today, preferences.timezone),
          localDate: today,
          timezone: preferences.timezone,
          localTime: preferences.collectionTime,
          scheduledAt: resolveScheduledTime(today, preferences.collectionTime, preferences.timezone).toISOString(),
          status: "WAITING",
          scheduledAttemptCount: 0,
          maxScheduledAttempts: 3,
          nextAttemptAt: null,
          lastAttemptId: null,
          updatedAt: now.toISOString(),
        });
        state.occurrences.push(occurrence);
      } else if (occurrence.status === "WAITING" && occurrence.scheduledAttemptCount === 0) {
        occurrence.localTime = preferences.collectionTime;
        occurrence.scheduledAt = resolveScheduledTime(today, preferences.collectionTime, preferences.timezone).toISOString();
        occurrence.updatedAt = now.toISOString();
      } else if (
        occurrence.status === "RUNNING" &&
        !state.attempts.some(
          (attempt) => attempt.id === occurrence!.lastAttemptId && attempt.state === "RUNNING",
        )
      ) {
        // Reconciliation must never leave an occurrence RUNNING without a live
        // attempt: that state blocks scheduling and, before restart recovery
        // existed, survived forever. The schedule decides what happens next.
        const trigger = state.attempts.find(
          (attempt) => attempt.id === occurrence!.lastAttemptId,
        )?.trigger;
        this.restoreInterruptedOccurrence(occurrence, {
          now,
          trigger: trigger ?? "scheduled",
        });
      }
      const issue = currentIssue(state.issues, today, preferences.timezone);
      if (
        issue?.status === "COMPLETE" &&
        new Date(occurrence.scheduledAt).getTime() <= now.getTime() &&
        !isTerminalOccurrence(occurrence.status)
      ) {
        occurrence.status = "ALREADY_FULFILLED";
        occurrence.nextAttemptAt = null;
        occurrence.updatedAt = now.toISOString();
      }
    });
  }

  private async beginScheduledRun(
    occurrence: Occurrence,
    trigger: "scheduled" | "catch-up",
  ): Promise<void> {
    const now = this.now();
    const preferences = this.getPreferences();
    const date = occurrence.localDate;
    const issueId = stableIssueId(date, occurrence.timezone);
    const state = this.store.snapshot();
    const issue = currentIssue(state.issues, date, occurrence.timezone);
    if (issue?.status === "COMPLETE") {
      await this.updateOccurrence(occurrence.id, {
        status: "ALREADY_FULFILLED",
        nextAttemptAt: null,
        updatedAt: now.toISOString(),
      });
      return;
    }
    if (occurrence.scheduledAttemptCount >= occurrence.maxScheduledAttempts) {
      await this.updateOccurrence(occurrence.id, {
        status: "EXHAUSTED",
        nextAttemptAt: null,
        updatedAt: now.toISOString(),
      });
      return;
    }
    const started = await this.store.update((next) => {
      const liveOccurrence = next.occurrences.find((item) => item.id === occurrence.id);
      if (!liveOccurrence || liveOccurrence.status === "RUNNING" || isTerminalOccurrence(liveOccurrence.status)) {
        return null;
      }
      if (next.attempts.some((item) => item.issueId === issueId && item.state === "RUNNING")) return null;
      let dailyIssue = currentIssue(next.issues, date, occurrence.timezone);
      if (!dailyIssue) {
        dailyIssue = emptyIssue(date, preferences, now);
        next.issues.push(dailyIssue);
      }
      const attempt = runAttemptSchema.parse({
        id: createId("attempt"),
        issueId,
        edition: dailyIssue.edition,
        trigger,
        state: "RUNNING",
        startedAt: now.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: dailyIssue.actual.count,
        traceId: createId("trace"),
      });
      next.attempts.push(attempt);
      liveOccurrence.status = "RUNNING";
      liveOccurrence.scheduledAttemptCount += 1;
      liveOccurrence.nextAttemptAt = null;
      liveOccurrence.lastAttemptId = attempt.id;
      liveOccurrence.updatedAt = now.toISOString();
      return { attempt, issue: dailyIssue, preferences: next.preferences };
    });
    if (started) this.launchCollection(started);
  }

  private launchCollection(started: StartedRun): void {
    const task = this.collectAndRecord(started).then(async () => {
      if (this.started) await this.pulse("scheduled");
    });
    this.tasks.set(started.attempt.id, task);
    void task.then(
      () => {
        this.tasks.delete(started.attempt.id);
      },
      () => {
        this.tasks.delete(started.attempt.id);
      },
    );
  }

  private async collectAndRecord(started: StartedRun): Promise<void> {
    const controller = new AbortController();
    try {
      if (!this.collector) {
        throw new ReaderServiceError("editorial_unavailable", "Article discovery is not configured.", 503, true);
      }
      const result = await this.collector(started.preferences, {
        fetchArticle: (url, signal) => this.fetchArticle(url, signal),
        now: this.now,
        signal: controller.signal,
        semanticClient: this.semanticClient,
        alreadyDelivered: this.alreadyDeliveredContext(started.issue),
      });
      const now = this.now();
      const trace = toStoredTrace(
        result.trace,
        started.attempt.traceId,
        started.issue,
        now,
      );
      const bodyRecords: Array<{ summary: ArticleSummary; body: BodyRecord }> = [];
      const saved = await this.store.update((state) => {
        const issueIndex = state.issues.findIndex(
          (item) => item.id === started.issue.id && item.edition === started.issue.edition,
        );
        const attempt = state.attempts.find((item) => item.id === started.attempt.id);
        if (issueIndex < 0 || !attempt) return null;
        const issue = state.issues[issueIndex];
        const currentFullText = issue.articles.filter(isFullText);
        const selected = [...currentFullText];
        const selectedUrls = new Set(
          currentFullText.flatMap((article) => [
            normalizedArticleUrl(article.originalUrl),
            normalizedArticleUrl(article.accessibleUrl),
          ]),
        );
        // Bounded cross-day duplicate check: today's issue should not re-deliver
        // an article an earlier Daily Issue already used, even when the readable
        // title changed or the URL gained tracking parameters.
        const recentArticleIds = new Set<string>();
        const recentTitles = new Set<string>();
        const recentlyRead = new Set(
          [...state.issues]
            .filter(
              (candidate) =>
                candidate.id !== issue.id &&
                candidate.localDate < issue.localDate &&
                withinDays(candidate.localDate, issue.localDate, DUPLICATE_WINDOW_DAYS),
            )
            .map((candidate) => candidate.localDate),
        );
        for (const candidate of state.issues) {
          if (!recentlyRead.has(candidate.localDate)) continue;
          for (const delivered of candidate.articles) {
            if (!isFullText(delivered)) continue;
            recentArticleIds.add(delivered.id);
            selectedUrls.add(normalizedArticleUrl(delivered.originalUrl));
            selectedUrls.add(normalizedArticleUrl(delivered.accessibleUrl));
            const title = normalizedArticleTitle(delivered.title);
            if (title) recentTitles.add(title);
          }
        }
        for (const candidate of result.articles) {
          const summary = scopeSummary(candidate, issue.id, issue.edition);
          if (!isSuitable(summary, started.preferences)) continue;
          const urlKeys = [
            normalizedArticleUrl(summary.originalUrl),
            normalizedArticleUrl(summary.accessibleUrl),
          ];
          if (urlKeys.some((key) => selectedUrls.has(key))) continue;
          if (recentArticleIds.has(summary.id)) continue;
          const title = normalizedArticleTitle(summary.title);
          if (title && recentTitles.has(title)) continue;
          if (selected.length >= started.preferences.dailyArticleCount) break;
          const elapsed = selected.reduce((total, article) => total + article.wordCount / 200, 0);
          const duration = summary.wordCount / 200;
          if (elapsed + duration > started.preferences.readingBudgetMinutes) continue;
          selected.push(summary);
          urlKeys.forEach((key) => selectedUrls.add(key));
          if (title) recentTitles.add(title);
          recentArticleIds.add(summary.id);
          if (candidate.paragraphs?.length && candidate.bodyHash) {
            bodyRecords.push({ summary, body: { paragraphs: candidate.paragraphs, bodyHash: candidate.bodyHash } });
          }
        }
        const fulfillment = issueFulfillment(
          started.preferences,
          selected,
          result.unmetConstraints ?? [],
        );
        const replacement = dailyIssueSchema.parse({
          ...issue,
          target: started.preferences,
          ...fulfillment,
          articles: selected,
          updatedAt: now.toISOString(),
        });
        state.issues[issueIndex] = replacement;
        attempt.state = "SUCCEEDED";
        attempt.completedAt = now.toISOString();
        attempt.retryable = false;
        attempt.failureReason = null;
        if (result.trace.semantic) {
          attempt.semanticRuntimeStatus = result.trace.semantic.status;
          attempt.semanticFailureReason = result.trace.semantic.reason;
        }
        attempt.deliveredCount = replacement.actual.count;
        state.traces.push(trace);
        if (state.traces.length > 1000) state.traces.splice(0, state.traces.length - 1000);

        if (started.attempt.trigger === "scheduled" || started.attempt.trigger === "catch-up") {
          const occurrence = state.occurrences.find(
            (item) =>
              item.localDate === replacement.localDate &&
              item.timezone === replacement.timezone,
          );
          if (occurrence) {
            if (replacement.status === "COMPLETE") {
              occurrence.status = "COMPLETED";
              occurrence.nextAttemptAt = null;
              occurrence.updatedAt = now.toISOString();
            } else {
              // The run finished but the Issue was not fulfilled, so the
              // occurrence must not claim success.
              this.settleOccurrenceAfterRun(occurrence, {
                now,
                retryable: true,
                retryDelayMs: occurrence.scheduledAttemptCount === 1 ? 5 * 60_000 : 15 * 60_000,
              });
            }
          }
        } else {
          const occurrence = state.occurrences.find(
            (item) =>
              item.localDate === replacement.localDate &&
              item.timezone === replacement.timezone,
          );
          if (
            occurrence &&
            replacement.status === "COMPLETE" &&
            new Date(occurrence.scheduledAt).getTime() <= now.getTime() &&
            !isTerminalOccurrence(occurrence.status)
          ) {
            occurrence.status = "ALREADY_FULFILLED";
            occurrence.nextAttemptAt = null;
            occurrence.updatedAt = now.toISOString();
          }
        }
        if (started.attempt.trigger === "regenerate") {
          this.carryProgress(state, replacement, started.issue.edition - 1);
        }
        return replacement;
      });
      if (!saved) return;
      for (const { summary, body } of bodyRecords) {
        this.bodies.set(summary.id + "|" + saved.edition, body);
        if (summary.cachePermission === "PERMITTED" && /^[a-f0-9]{64}$/.test(body.bodyHash)) {
          await this.store.saveCache(summary.id, saved.edition, body.bodyHash, body.paragraphs).catch(() => undefined);
        }
      }
    } catch (error) {
      await this.recordFailure(started, error);
    }
  }

  private async recordFailure(started: StartedRun, error: unknown): Promise<void> {
    const now = this.now();
    const reason = safeErrorText(error);
    await this.store.update((state) => {
      const attempt = state.attempts.find((item) => item.id === started.attempt.id);
      if (!attempt) return;
      attempt.state = "FAILED";
      attempt.completedAt = now.toISOString();
      attempt.retryable = reason.retryable;
      attempt.failureReason = reason.message;
      if (error instanceof EditorialCollectionError && error.trace?.semantic) {
        attempt.semanticRuntimeStatus = error.trace.semantic.status;
        attempt.semanticFailureReason = error.trace.semantic.reason;
        state.traces.push(toStoredTrace(
          error.trace,
          started.attempt.traceId,
          started.issue,
          now,
        ));
        if (state.traces.length > 1000) state.traces.splice(0, state.traces.length - 1000);
      }
      const occurrence = state.occurrences.find(
        (item) =>
          item.localDate === started.issue.localDate &&
          item.timezone === started.issue.timezone,
      );
      if (
        occurrence &&
        (attempt.trigger === "scheduled" || attempt.trigger === "catch-up")
      ) {
        if (reason.retryable && occurrence.scheduledAttemptCount < occurrence.maxScheduledAttempts) {
          const delayMinutes = occurrence.scheduledAttemptCount === 1 ? 5 : 15;
          occurrence.status = "RETRY_WAIT";
          occurrence.nextAttemptAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
        } else {
          occurrence.status = "EXHAUSTED";
          occurrence.nextAttemptAt = null;
        }
        occurrence.updatedAt = now.toISOString();
      }
    });
  }

  /**
   * Settle an occurrence whose run finished without fulfilling the issue.
   *
   * Completion of an attempt is not delivery: an occurrence may only become
   * COMPLETED once the Daily Issue actually reached COMPLETE. Anything else
   * stays inside the bounded retry budget, and is only exhausted when the
   * budget is spent or the failure cannot be retried.
   */
  private settleOccurrenceAfterRun(
    occurrence: Occurrence | undefined,
    options: { now: Date; retryable: boolean; retryDelayMs: number },
  ): void {
    if (!occurrence) return;
    const { now, retryable, retryDelayMs } = options;
    if (retryable && occurrence.scheduledAttemptCount < occurrence.maxScheduledAttempts) {
      occurrence.status = "RETRY_WAIT";
      occurrence.nextAttemptAt = new Date(now.getTime() + retryDelayMs).toISOString();
    } else {
      occurrence.status = "EXHAUSTED";
      occurrence.nextAttemptAt = null;
    }
    occurrence.updatedAt = now.toISOString();
  }

  private alreadyDeliveredContext(issue: DailyIssue): SemanticExistingArticleInput[] {
    const current = this.store.snapshot().issues.find(
      (candidate) => candidate.id === issue.id && candidate.edition === issue.edition,
    ) ?? issue;
    return current.articles
      .filter((article) => isFullText(article))
      .slice(0, 12)
      .map((article) => ({
        title: article.title,
        publication: article.originalPublication,
        topics: article.topics.slice(0, 12),
        wordCount: article.wordCount,
        readingMinutes: article.readingMinutes,
        difficulty: article.difficulty,
        ...(article.editorial ? { contributionType: article.editorial.contributionType } : {}),
      }));
  }

  private carryProgress(
    state: ReturnType<ReaderStore["snapshot"]>,
    replacement: DailyIssue,
    oldEdition: number,
  ): void {
    if (oldEdition < 1) return;
    const oldIssue = state.issues.find(
      (issue) => issue.id === replacement.id && issue.edition === oldEdition,
    );
    if (!oldIssue) return;
    for (const article of replacement.articles) {
      const previous = oldIssue.articles.find(
        (candidate) =>
          normalizedArticleUrl(candidate.originalUrl) === normalizedArticleUrl(article.originalUrl) ||
          normalizedArticleUrl(candidate.accessibleUrl) === normalizedArticleUrl(article.accessibleUrl),
      );
      if (!previous) continue;
      const progress = state.progress.find(
        (item) =>
          item.issueId === oldIssue.id &&
          item.articleId === previous.id &&
          item.edition === oldEdition,
      );
      if (!progress) continue;
      state.progress = state.progress.filter(
        (item) =>
          item.issueId !== replacement.id ||
          item.articleId !== article.id ||
          item.edition !== replacement.edition,
      );
      state.progress.push({
        ...progress,
        issueId: replacement.id,
        articleId: article.id,
        edition: replacement.edition,
        updatedAt: this.now().toISOString(),
      });
      article.readState = progress.readState;
    }
  }

  private async updateOccurrence(id: string, patch: Partial<Occurrence>): Promise<void> {
    await this.store.update((state) => {
      const occurrence = state.occurrences.find((item) => item.id === id);
      if (occurrence) Object.assign(occurrence, patch);
    });
  }

  private armTimer(): void {
    if (!this.started) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = undefined;
    // A process that does not own scheduling still serves the UI and still
    // recovers on startup, but it never arms a competing timer.
    if (!this.scheduleRuns) return;
    const state = this.store.snapshot();
    const preferences = state.preferences;
    const now = this.now();
    const today = localDateTime(now, preferences.timezone).date;
    const occurrence =
      state.occurrences.find(
        (item) => item.localDate === today && item.timezone === preferences.timezone,
      ) ?? null;
    let nextTime: Date;
    if (occurrence && occurrence.status === "WAITING") {
      nextTime = new Date(occurrence.scheduledAt);
    } else if (occurrence && occurrence.status === "RETRY_WAIT" && occurrence.nextAttemptAt) {
      nextTime = new Date(occurrence.nextAttemptAt);
    } else {
      nextTime = resolveScheduledTime(addLocalDays(today, 1), "00:00", preferences.timezone);
    }
    const delay = Math.max(0, Math.min(2_147_000_000, nextTime.getTime() - now.getTime()));
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.pulse("scheduled");
    }, delay);
  }

  private requireStore(): ReaderStore {
    if (!this.started) throw new ReaderServiceError("reader_service_not_ready", "The Reader service is starting.", 503, true);
    return this.store;
  }

  private assertStarted(): void {
    this.requireStore();
  }
}

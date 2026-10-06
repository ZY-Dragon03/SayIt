import { createHash, randomUUID } from "node:crypto";
import {
  articleSummarySchema,
  dailyIssueSchema,
  occurrenceSchema,
  readerPreferencesSchema,
  readingProgressSchema,
  runAttemptSchema,
  type ArticleSummary,
  type DailyIssue,
  type Occurrence,
  type ReaderPreferences,
  type ReadingProgress,
  type RunAttempt,
  type RunAttemptTrigger,
} from "../../src/shared/reader-contract";
import { safeFetchArticle, type SafeHttpResponse } from "./safe-fetch";
import { collectEditorial, readArticleFullText } from "./editorial";
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

function emptyIssue(
  localDate: string,
  preferences: ReaderPreferences,
  now: Date,
  edition = 1,
  priorEditions: number[] = [],
): DailyIssue {
  return dailyIssueSchema.parse({
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
  private readonly collector?: EditorialCollector;
  private readonly reopenArticle?: ArticleReopener;
  private readonly bodies = new Map<string, BodyRecord>();
  private readonly tasks = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private pulseQueue: Promise<void> = Promise.resolve();

  constructor(options: ReaderServiceOptions = {}) {
    this.store = options.store ?? new ReaderStore();
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.fetchArticle = options.fetchArticle ?? ((url) => safeFetchArticle(url));
    this.collector = options.collect ?? collectEditorial;
    this.reopenArticle = options.reopenArticle ?? readArticleFullText;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.store.initialize();
    this.started = true;
    await this.pulse("catch-up");
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = undefined;
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
    const date = localDateTime(this.now(), state.preferences.timezone).date;
    return {
      issue: currentIssue(state.issues, date, state.preferences.timezone),
      occurrence:
        state.occurrences.find(
          (item) => item.localDate === date && item.timezone === state.preferences.timezone,
        ) ?? null,
      attempts: state.attempts
        .filter((attempt) => attempt.issueId === stableIssueId(date, state.preferences.timezone))
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
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
      .slice(0, limit);
  }

  edition(issueId: string, edition: number): DailyIssue | null {
    return (
      this.requireStore().snapshot().issues.find(
        (issue) => issue.id === issueId && issue.edition === edition,
      ) ?? null
    );
  }

  runStatus(attemptId: string): { attempt: RunAttempt; issue: DailyIssue } | null {
    const state = this.requireStore().snapshot();
    const attempt = state.attempts.find((item) => item.id === attemptId);
    if (!attempt) return null;
    const issue =
      state.issues.find((item) => item.id === attempt.issueId && item.edition === attempt.edition) ??
      currentIssue(state.issues, this.today().issue?.localDate ?? "", this.getPreferences().timezone);
    return issue ? { attempt, issue } : null;
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
        for (const candidate of result.articles) {
          const summary = scopeSummary(candidate, issue.id, issue.edition);
          if (!isSuitable(summary, started.preferences)) continue;
          const urlKeys = [
            normalizedArticleUrl(summary.originalUrl),
            normalizedArticleUrl(summary.accessibleUrl),
          ];
          if (urlKeys.some((key) => selectedUrls.has(key))) continue;
          if (selected.length >= started.preferences.dailyArticleCount) break;
          const elapsed = selected.reduce((total, article) => total + article.wordCount / 200, 0);
          const duration = summary.wordCount / 200;
          if (elapsed + duration > started.preferences.readingBudgetMinutes) continue;
          selected.push(summary);
          urlKeys.forEach((key) => selectedUrls.add(key));
          if (candidate.paragraphs?.length && candidate.bodyHash) {
            bodyRecords.push({ summary, body: { paragraphs: candidate.paragraphs, bodyHash: candidate.bodyHash } });
          }
        }
        const nonFullText = result.candidates
          .filter((article) => !isFullText(article))
          .slice(0, 20)
          .map((article) => scopeSummary(article, issue.id, issue.edition));
        const allArticles = [...selected, ...nonFullText];
        const fulfillment = issueFulfillment(
          started.preferences,
          allArticles,
          result.unmetConstraints ?? [],
        );
        const replacement = dailyIssueSchema.parse({
          ...issue,
          target: started.preferences,
          ...fulfillment,
          articles: allArticles,
          updatedAt: now.toISOString(),
        });
        state.issues[issueIndex] = replacement;
        attempt.state = "SUCCEEDED";
        attempt.completedAt = now.toISOString();
        attempt.retryable = false;
        attempt.failureReason = null;
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
            occurrence.status = "COMPLETED";
            occurrence.nextAttemptAt = null;
            occurrence.updatedAt = now.toISOString();
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

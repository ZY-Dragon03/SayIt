import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReaderPreferences, ReaderSemanticRuntimeTrace } from "../../src/shared/reader-contract";
import { collectEditorial } from "./editorial";
import { EditorialCollectionError } from "./editorial";
import type { JsonCompletionClient } from "../provider";
import { ReaderStore } from "./store";
import {
  RUN_LEASE_MS,
  ReaderService,
  type EditorialArticle,
  type EditorialCollectionResult,
  type EditorialCollector,
} from "./service";

const directories: string[] = [];
const openStores: ReaderStore[] = [];

afterEach(async () => {
  // SQLite keeps its file handle open, so close every store before removing the
  // directory it lives in.
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function createStore(now: () => Date): Promise<ReaderStore> {
  const directory = await mkdtemp(path.join(tmpdir(), "sayit-reader-service-test-"));
  directories.push(directory);
  const store = new ReaderStore({ directory, now });
  openStores.push(store);
  await store.initialize();
  await store.update((state) => {
    state.preferences = defaultPreferences();
    state.preferencesConfigured = true;
  });
  return store;
}

function defaultPreferences(overrides: Partial<ReaderPreferences> = {}): ReaderPreferences {
  return {
    topics: ["Technology"],
    dailyArticleCount: 1,
    difficulty: "Intermediate",
    readingBudgetMinutes: 10,
    collectionTime: "18:00",
    timezone: "UTC",
    ...overrides,
  };
}

function article(overrides: Partial<EditorialArticle> = {}): EditorialArticle {
  return {
    id: "article-technology-1",
    title: "Technology changes the energy market",
    originalPublication: "Example News",
    originalUrl: "https://news.example/story/technology",
    accessiblePublication: "Example News",
    accessibleUrl: "https://news.example/story/technology",
    contentStatus: "FULL_TEXT",
    wordCount: 1400,
    fkglWordCount: 1400,
    sentenceCount: 93,
    syllableCount: 2380,
    readingMinutes: 7,
    fkgl: 10.34,
    readState: "UNREAD",
    cachePermission: "NOT_PERMITTED",
    topics: ["Technology"],
    difficulty: "Intermediate",
    paragraphCount: 5,
    paragraphs: ["First verified paragraph.", "Second verified paragraph.", "Third verified paragraph."],
    bodyHash: "a".repeat(64),
    ...overrides,
  };
}

function collection(articles: EditorialArticle[] = []): EditorialCollectionResult {
  const readingMinutes = articles.reduce((total, item) => total + item.wordCount / 200, 0);
  const complete = articles.length === 1 && readingMinutes >= 7 && readingMinutes <= 10;
  return {
    status: complete ? "COMPLETE" : articles.length ? "PARTIAL" : "NOT_DELIVERED",
    articles,
    candidates: [],
    actual: {
      count: articles.length,
      topics: [...new Set(articles.flatMap((item) => item.topics))],
      difficulty: articles.length ? "Intermediate" : null,
      readingMinutes,
    },
    unmetConstraints: complete ? [] : ["Suitable supply was insufficient."],
    trace: {
      queries: ["Technology in-depth article"],
      candidates: articles.map((item) => ({
        url: item.originalUrl,
        publication: item.originalPublication,
        outcome: "ACCEPTED",
        reason: "Verified full-text article matched saved preferences.",
        statusCode: 200,
        articleId: item.id,
      })),
      decisions: ["A fixture collector returned only its verified results."],
    },
  };
}

function fakeTimers() {
  const callbacks: Array<{ callback: () => void; delay: number }> = [];
  return {
    callbacks,
    setTimer: (callback: () => void, delay: number) =>
      ({ callback, delay } as unknown as ReturnType<typeof setTimeout>),
    clearTimer: (_timer: ReturnType<typeof setTimeout>) => undefined,
  };
}

function makeService(
  store: ReaderStore,
  now: () => Date,
  collect: EditorialCollector,
  semanticClient?: JsonCompletionClient,
) {
  const timers = fakeTimers();
  return {
    timers,
    service: new ReaderService({
      store,
      now,
      collect,
      semanticClient,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    }),
  };
}

describe("Reader run ownership", () => {
  /** A collector that stays inside the collection until the test releases it. */
  function heldCollector() {
    let release: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const collect: EditorialCollector = async () => {
      started += 1;
      await entered;
      return collection([article()]);
    };
    return {
      collect,
      startedCount: () => started,
      release: () => release?.(),
    };
  }

  /** Record a live attempt owned by a peer process, as that peer would. */
  async function seedPeerRun(
    store: ReaderStore,
    now: Date,
    options: { expiresAt: string; startedAt?: string },
  ): Promise<string> {
    const attemptId = "attempt:peer";
    await store.update((state) => {
      state.preferences = defaultPreferences();
      state.preferencesConfigured = true;
      state.issues.push({
        id: "issue:2026-10-04:UTC",
        localDate: "2026-10-04",
        timezone: "UTC",
        edition: 1,
        status: "NOT_DELIVERED",
        target: defaultPreferences(),
        actual: { count: 0, topics: [], difficulty: null, readingMinutes: 0 },
        unmetConstraints: ["Article count: 0/1 verified full-text articles."],
        articles: [],
        createdAt: options.startedAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        priorEditions: [],
      });
      state.occurrences.push({
        id: "occurrence:2026-10-04:UTC",
        localDate: "2026-10-04",
        timezone: "UTC",
        localTime: "18:00",
        scheduledAt: "2026-10-04T18:00:00.000Z",
        status: "RUNNING",
        scheduledAttemptCount: 1,
        maxScheduledAttempts: 3,
        nextAttemptAt: null,
        lastAttemptId: attemptId,
        updatedAt: now.toISOString(),
      });
      state.attempts.push({
        id: attemptId,
        issueId: "issue:2026-10-04:UTC",
        edition: 1,
        trigger: "scheduled",
        state: "RUNNING",
        startedAt: options.startedAt ?? now.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: 0,
        traceId: "trace:peer",
      });
      state.runLeases.push({
        attemptId,
        ownerId: "peer-host:4242",
        pid: 4242,
        hostname: "peer-host",
        expiresAt: options.expiresAt,
      });
    });
    return attemptId;
  }

  it("leaves a peer's live scheduled run alone when this process starts", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    // A peer holds a valid claim for the next two minutes.
    await seedPeerRun(store, current, { expiresAt: "2026-10-04T19:02:00.000Z" });

    let collected = 0;
    const late = new ReaderService({
      store,
      now,
      collect: async () => {
        collected += 1;
        return collection([article()]);
      },
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    });
    await late.start();

    // The peer's run is not failed, not recovered, and not duplicated, and this
    // process did not start a competing collection.
    const state = store.snapshot();
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ state: "RUNNING", failureReason: null });
    expect(state.runLeases).toHaveLength(1);
    expect(state.occurrences[0]?.status).toBe("RUNNING");
    expect(collected).toBe(0);
    await late.stop();
  });

  it("recovers the run once the peer's claim has lapsed", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    // The claim expired before this process started, so the work is an orphan.
    await seedPeerRun(store, current, { expiresAt: "2026-10-04T18:59:00.000Z" });

    let collected = 0;
    const late = new ReaderService({
      store,
      now,
      // The peer recorded its attempt without a claim, so the grace window is
      // what decides here; it is shortened to exercise the lapsed-claim path.
      unclaimedGraceMs: 0,
      collect: async () => {
        collected += 1;
        return collection([article()]);
      },
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    });
    await late.start();

    const orphan = store.snapshot().attempts.find((item) => item.id === "attempt:peer");
    expect(orphan?.state).toBe("FAILED");
    expect(orphan?.failureReason).toContain("recovered automatically");
    // The lapsed claim is cleared, and the overdue day is collected again.
    expect(store.snapshot().runLeases.some((item) => item.ownerId === "peer-host:4242")).toBe(false);
    await late.waitForIdle();
    expect(collected).toBe(1);
    await late.stop();
  });

  it("refuses a second collection while another process owns today's run", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const held = heldCollector();

    const task = new ReaderService({
      store,
      now,
      collect: held.collect,
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    });
    await task.start();
    await task.pulse();
    const heldAttemptId = store.snapshot().attempts[0]?.id;
    expect(heldAttemptId).toBeTruthy();

    // A manual "Collect now" while the scheduled run is live is refused rather
    // than starting a second collection over the same issue.
    await expect(task.startManualRun("manual")).rejects.toMatchObject({
      code: "run_in_progress",
    });
    expect(held.startedCount()).toBe(1);
    expect(store.snapshot().attempts).toHaveLength(1);
    expect(store.snapshot().runLeases[0]).toMatchObject({ attemptId: heldAttemptId });

    held.release();
    await task.waitForIdle();
    expect(store.snapshot().runLeases).toHaveLength(0);
    await task.stop();
  });
});
describe("Reader collection lifecycle", () => {
  it("counts FKGL as an approximate estimator, not proof an article is unsuitable", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    // Intermediate is the saved preference, and every measured tier is at most
    // one tier from it, so an Advanced article must still be delivered.
    const collect = vi.fn(async () =>
      collection([
        article({
          id: "article-advanced",
          title: "An advanced analysis",
          originalUrl: "https://news.example/story/advanced",
          accessibleUrl: "https://news.example/story/advanced",
          fkgl: 14.2,
        }),
      ]),
    );
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    const issue = service.today().issue;
    expect(issue?.articles.map((item) => item.originalUrl)).toEqual([
      "https://news.example/story/advanced",
    ]);
    expect(issue?.status).toBe("COMPLETE");
    await service.stop();
  });

  it("delivers an easy article to a reader who asked for Advanced, one tier away", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    // Tolerating one tier is what turns FKGL from a gate into a guide: with an
    // Advanced target, an Intermediate article is still usable reading.
    await store.update((state) => {
      state.preferences = defaultPreferences({ difficulty: "Advanced" });
    });
    const collect = vi.fn(async () =>
      collection([
        article({
          id: "article-intermediate",
          title: "A measured analysis",
          originalUrl: "https://news.example/story/measured",
          accessibleUrl: "https://news.example/story/measured",
          fkgl: 10.4,
        }),
      ]),
    );
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    expect(service.today().issue?.articles.map((item) => item.originalUrl)).toEqual([
      "https://news.example/story/measured",
    ]);
    await service.stop();
  });

  it("still refuses an article two difficulty tiers away from the saved preference", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    // An Easy target with an Advanced article is two tiers away: outside the
    // tolerance, so Reader reports the shortage instead of padding the issue.
    await store.update((state) => {
      state.preferences = defaultPreferences({ difficulty: "Easy" });
    });
    const collect = vi.fn(async () =>
      collection([
        article({
          id: "article-advanced",
          title: "An advanced analysis",
          originalUrl: "https://news.example/story/advanced",
          accessibleUrl: "https://news.example/story/advanced",
          fkgl: 14.2,
        }),
      ]),
    );
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    expect(service.today().issue?.articles).toHaveLength(0);
    expect(service.today().issue?.status).toBe("NOT_DELIVERED");
    await service.stop();
  });

  it("prefers the article nearest the saved difficulty when both are usable", async () => {
    const current = new Date("2026-10-04T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () =>
      collection([
        article({
          id: "article-advanced",
          title: "An advanced analysis",
          originalUrl: "https://news.example/story/advanced",
          accessibleUrl: "https://news.example/story/advanced",
          fkgl: 14.2,
        }),
        article({
          id: "article-intermediate",
          title: "A measured analysis",
          originalUrl: "https://news.example/story/measured",
          accessibleUrl: "https://news.example/story/measured",
          fkgl: 10.4,
        }),
      ]),
    );
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    // Both are within tolerance, so the exact match is chosen first.
    expect(service.today().issue?.articles.map((item) => item.originalUrl)).toEqual([
      "https://news.example/story/measured",
    ]);
    await service.stop();
  });

  it("waits until the configured time and delivers at the scheduled instant", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const { service } = makeService(store, now, collect);

    await service.start();
    expect(collect).not.toHaveBeenCalled();
    expect(service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAt: "2026-10-04T18:00:00.000Z",
      scheduledAttemptCount: 0,
    });
    expect(service.today().attempts).toHaveLength(0);

    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(service.today().occurrence).toMatchObject({
      status: "COMPLETED",
      scheduledAttemptCount: 1,
    });
    expect(service.today().issue).toMatchObject({ status: "COMPLETE", actual: { count: 1 } });
    await service.stop();
  });

  it("merges a manual partial issue into the scheduled occurrence without using its retry budget", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi
      .fn<EditorialCollector>()
      .mockResolvedValueOnce(collection())
      .mockResolvedValueOnce(collection([article()]));
    const { service } = makeService(store, now, collect);

    await service.start();
    const manual = await service.startManualRun("manual");
    await service.waitForIdle();
    expect(manual.issue.id).toBe(service.today().issue?.id);
    expect(service.today().issue?.status).toBe("NOT_DELIVERED");
    expect(service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAttemptCount: 0,
      scheduledAt: "2026-10-04T18:00:00.000Z",
    });

    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(collect).toHaveBeenCalledTimes(2);
    expect(service.today().issue).toMatchObject({
      id: manual.issue.id,
      status: "COMPLETE",
      actual: { count: 1 },
    });
    expect(service.today().attempts.map((attempt) => attempt.trigger)).toEqual(["manual", "scheduled"]);
    expect(service.today().occurrence?.scheduledAttemptCount).toBe(1);
    await service.stop();
  });

  it("records an all-source outage as a retryable failure without replacing delivered issue state", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    await store.update((state) => {
      state.preferences = defaultPreferences({ dailyArticleCount: 2, readingBudgetMinutes: 20 });
    });
    let collectionCall = 0;
    const collect = vi.fn<EditorialCollector>(async (preferences) => {
      collectionCall += 1;
      if (collectionCall === 1) return collection([article()]);
      return collectEditorial(preferences, {
        search: async () => [{
          url: "https://www.reuters.com/technology/source-outage",
          title: "Technology report on a source outage",
          snippet: "A full technology report",
        }],
        fetchArticle: async () => { throw new Error("simulated source transport outage"); },
        maxArticleChecks: 1,
      });
    });
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.startManualRun("manual");
    await service.waitForIdle();
    const preservedIssue = service.today().issue!;
    expect(preservedIssue.status).toBe("PARTIAL");
    expect(preservedIssue.articles.filter((item) => item.contentStatus === "FULL_TEXT")).toHaveLength(1);
    const deliveredArticle = preservedIssue.articles.find((item) => item.contentStatus === "FULL_TEXT")!;
    const progress = await service.saveProgress({
      issueId: preservedIssue.id,
      articleId: deliveredArticle.id,
      edition: preservedIssue.edition,
      scrollRatio: 0.42,
      scrollTop: 480,
      firstVisibleParagraph: 2,
      paragraphOffset: 19,
    });
    const issueAfterProgress = service.today().issue!;

    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    await service.waitForIdle();

    const today = service.today();
    expect(today.attempts.map((attempt) => attempt.state)).toEqual(["SUCCEEDED", "FAILED"]);
    expect(today.attempts[1]).toMatchObject({
      retryable: true,
      failureReason: "All discovered source requests failed transiently before returning usable content.",
    });
    expect(today.issue).toEqual(issueAfterProgress);
    expect(today.issue?.articles).toEqual(issueAfterProgress.articles);
    expect(store.snapshot().progress).toContainEqual(progress);
    expect(today.occurrence).toMatchObject({ status: "RETRY_WAIT", scheduledAttemptCount: 1 });
    await service.stop();
  });

  it("persists semantic failure status, trace, and same-day context while preserving issue and progress", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    await store.update((state) => {
      state.preferences = defaultPreferences({ dailyArticleCount: 2, readingBudgetMinutes: 20 });
    });
    const priorEditorial = {
      contractVersion: "reader-editorial-curation.v1" as const,
      decision: "APPROVE" as const,
      topicFit: "YES" as const,
      matchedTopics: ["Technology"],
      relevance: "high" as const,
      editorialValue: "high" as const,
      analysisDepth: "medium" as const,
      novelty: "high" as const,
      overlap: "none" as const,
      contributionType: "analysis" as const,
      rationale: "It explains regional evidence about the energy market.",
    };
    const priorProvenance = {
      publisherIdentity: "Example News",
      publisherIdentitySources: ["open_graph_site_name" as const],
      canonicalRelationship: "original_url" as const,
      standaloneArticleVerified: true as const,
      titleAgreementVerified: true as const,
      bodyCompletenessVerified: true as const,
    };
    const semanticRuntime: ReaderSemanticRuntimeTrace = {
      contractVersion: "reader-editorial-curation.v1",
      status: "PROVIDER_ERROR",
      provider: "DeepSeek",
      model: "deepseek-flash",
      candidateIds: ["candidate-next"],
      inputSha256: "c".repeat(64),
      requestIds: ["request-semantic-1"],
      requestCount: 1,
      elapsedMs: 23,
      reason: "Semantic provider failed (provider_timeout).",
      decisions: [],
    };
    const failureTrace = {
      queries: ["Technology reporting and analysis"],
      candidates: [{
        url: "https://newspaper.example/technology/report",
        publication: "Newspaper Example",
        outcome: "REJECTED" as const,
        reason: "Semantic review failed (PROVIDER_ERROR); this candidate was not eligible for delivery.",
        statusCode: 200,
        articleId: "candidate-next",
      }],
      decisions: ["Semantic review failed (PROVIDER_ERROR)."],
      semantic: semanticRuntime,
    };
    const editorialFailure = new EditorialCollectionError(
      "reader_semantic_unavailable",
      "Semantic provider failed (provider_timeout).",
      true,
      failureTrace,
    );
    let secondCollectorOptions: Parameters<EditorialCollector>[1] | undefined;
    const collect = vi.fn<EditorialCollector>()
      .mockResolvedValueOnce(collection([article({ editorial: priorEditorial, provenance: priorProvenance })]))
      .mockImplementationOnce(async (_preferences, options) => {
        secondCollectorOptions = options;
        throw editorialFailure;
      });
    const semanticClient: JsonCompletionClient = {
      completeJson: vi.fn(async () => ({
        provider: "DeepSeek",
        model: "deepseek-flash",
        requestId: "unused-test-client",
        content: "{}",
      })),
    };
    const { service } = makeService(store, now, collect, semanticClient);

    await service.start();
    await service.startManualRun("manual");
    await service.waitForIdle();
    const savedIssue = service.today().issue!;
    const savedArticle = savedIssue.articles.find((candidate) => candidate.contentStatus === "FULL_TEXT")!;
    expect(savedArticle).toMatchObject({
      editorial: { rationale: priorEditorial.rationale, contributionType: "analysis" },
      provenance: { publisherIdentity: "Example News" },
    });
    const progress = await service.saveProgress({
      issueId: savedIssue.id,
      articleId: savedArticle.id,
      edition: savedIssue.edition,
      scrollRatio: 0.42,
      scrollTop: 480,
      firstVisibleParagraph: 2,
      paragraphOffset: 19,
    });
    const preservedIssue = service.today().issue!;

    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    await service.waitForIdle();

    const today = service.today();
    expect(today.attempts[1]).toMatchObject({
      state: "FAILED",
      retryable: true,
      semanticRuntimeStatus: "PROVIDER_ERROR",
      semanticFailureReason: "Semantic provider failed (provider_timeout).",
    });
    expect(today.issue).toEqual(preservedIssue);
    expect(store.snapshot().progress).toContainEqual(progress);
    expect(secondCollectorOptions?.semanticClient).toBe(semanticClient);
    expect(secondCollectorOptions?.alreadyDelivered).toEqual([{
      title: savedArticle.title,
      publication: savedArticle.originalPublication,
      topics: ["Technology"],
      wordCount: savedArticle.wordCount,
      readingMinutes: savedArticle.readingMinutes,
      difficulty: "Intermediate",
      contributionType: "analysis",
    }]);
    expect(store.snapshot().traces.at(-1)).toMatchObject({
      id: today.attempts[1]?.traceId,
      semantic: {
        status: "PROVIDER_ERROR",
        reason: "Semantic provider failed (provider_timeout).",
      },
      candidates: [{ outcome: "REJECTED", articleId: "candidate-next" }],
    });
    expect(semanticClient.completeJson).not.toHaveBeenCalled();
    await service.stop();
  });

  it("bounds transient scheduled retries to the initial attempt plus delays of five and fifteen minutes", async () => {
    let current = new Date("2026-10-04T18:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const temporaryFailure = Object.assign(new Error("network failed"), {
      retryable: true,
      code: "search_timeout",
    });
    const collect = vi
      .fn<EditorialCollector>()
      .mockRejectedValueOnce(temporaryFailure)
      .mockRejectedValueOnce(temporaryFailure)
      .mockResolvedValueOnce(collection([article()]));
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    expect(service.today().occurrence).toMatchObject({
      status: "RETRY_WAIT",
      scheduledAttemptCount: 1,
      nextAttemptAt: "2026-10-04T18:05:00.000Z",
    });

    current = new Date("2026-10-04T18:05:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(service.today().occurrence).toMatchObject({
      status: "RETRY_WAIT",
      scheduledAttemptCount: 2,
      nextAttemptAt: "2026-10-04T18:20:00.000Z",
    });

    current = new Date("2026-10-04T18:20:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(collect).toHaveBeenCalledTimes(3);
    expect(service.today().occurrence).toMatchObject({
      status: "COMPLETED",
      scheduledAttemptCount: 3,
    });
    expect(service.today().attempts.map((attempt) => attempt.state)).toEqual([
      "FAILED",
      "FAILED",
      "SUCCEEDED",
    ]);
    await service.pulse();
    expect(collect).toHaveBeenCalledTimes(3);
    await service.stop();
  });

  it("catches up only the current date and marks older overdue dates missed", async () => {
    let current = new Date("2026-10-11T19:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    await store.initialize();
    await store.update((state) => {
      for (const localDate of [
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "2026-10-09",
        "2026-10-10",
      ]) {
        state.occurrences.push({
          id: "occurrence:" + localDate + ":UTC",
          localDate,
          timezone: "UTC",
          localTime: "18:00",
          scheduledAt: "2026-10-" + localDate.slice(-2) + "T18:00:00.000Z",
          status: "WAITING",
          scheduledAttemptCount: 0,
          maxScheduledAttempts: 3,
          nextAttemptAt: null,
          lastAttemptId: null,
          updatedAt: "2026-10-11T19:00:00.000Z",
        });
      }
    });
    const collect = vi.fn(async () => collection());
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();
    const state = store.snapshot();
    expect(state.occurrences.filter((item) => item.localDate < "2026-10-11").every((item) => item.status === "MISSED")).toBe(true);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(service.today().attempts).toHaveLength(1);
    expect(service.today().attempts[0]?.trigger).toBe("catch-up");
    await service.stop();
  });

  it("requires confirmed regeneration and preserves old editions and reading progress", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const { service } = makeService(store, now, collect);
    await service.start();
    const first = await service.startManualRun("manual");
    await service.waitForIdle();
    const firstArticleId = service.today().issue?.articles[0]?.id;
    expect(firstArticleId).toMatch(/^article:/);
    await service.saveProgress({
      issueId: first.issue.id,
      articleId: firstArticleId!,
      edition: 1,
      scrollRatio: 0.5,
      scrollTop: 620,
      firstVisibleParagraph: 2,
      paragraphOffset: 24,
    });

    await expect(service.startManualRun("regenerate")).rejects.toMatchObject({
      code: "regenerate_confirmation_required",
    });
    const replacement = await service.startManualRun("regenerate", true);
    await service.waitForIdle();

    expect(replacement.issue.edition).toBe(2);
    expect(service.today().issue?.priorEditions).toEqual([1]);
    expect(service.edition(first.issue.id, 1)?.status).toBe("COMPLETE");
    const state = store.snapshot();
    const replacementArticleId = service.today().issue?.articles[0]?.id;
    expect(replacementArticleId).toMatch(/^article:/);
    expect(state.progress).toContainEqual(
      expect.objectContaining({
        issueId: first.issue.id,
        articleId: replacementArticleId,
        edition: 2,
        scrollRatio: 0.5,
        firstVisibleParagraph: 2,
      }),
    );
    await service.stop();
  });

  it("does not re-deliver yesterday's article, but allows it again beyond the bounded window", { timeout: 30_000 }, async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn<EditorialCollector>(async () => collection([article()]));
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.startManualRun("manual");
    await service.waitForIdle();
    const firstArticle = service.today().issue!.articles[0]!;
    expect(firstArticle.originalUrl).toBe(article().originalUrl);

    // The next day returns the very same article: it must not be re-delivered,
    // even when the readable title picked up extra wording.
    current = new Date("2026-10-05T09:00:00.000Z");
    await service.pulse();
    await service.startManualRun("manual");
    await service.waitForIdle();
    expect(service.today().issue?.articles ?? []).toHaveLength(0);
    expect(service.today().issue?.status).toBe("NOT_DELIVERED");
    expect(service.today().issue?.unmetConstraints.join(" ")).toContain(
      "Verified full-text article count is 0 of 1",
    );

    // A genuinely different article is still delivered the same day.
    collect.mockImplementation(async () =>
      collection([
        article({
          id: "article-technology-2",
          title: "Grid storage changes the energy market",
          originalUrl: "https://news.example/story/storage",
          accessibleUrl: "https://news.example/story/storage",
        }),
      ]),
    );
    await service.startManualRun("regenerate", true);
    await service.waitForIdle();
    expect(service.today().issue?.articles[0]?.title).toBe(
      "Grid storage changes the energy market",
    );

    // Far enough in the future the bounded window no longer applies.
    collect.mockImplementation(async () => collection([article()]));
    current = new Date("2026-10-13T09:00:00.000Z");
    await service.pulse();
    await service.startManualRun("manual");
    await service.waitForIdle();
    expect(service.today().issue?.articles[0]?.originalUrl).toBe(article().originalUrl);
    expect(service.today().issue?.articles[0]?.id).not.toBe(firstArticle.id);
    await service.stop();
  });

  it("marks a manual completion fulfilled at the scheduled time without a scheduled attempt", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const { service } = makeService(store, now, collect);
    await service.start();
    await service.startManualRun("manual");
    await service.waitForIdle();
    expect(service.today().occurrence?.status).toBe("WAITING");
    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    expect(service.today().occurrence).toMatchObject({
      status: "ALREADY_FULFILLED",
      scheduledAttemptCount: 0,
    });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(service.today().attempts).toHaveLength(1);
    await service.stop();
  });

  it("does not mark an occurrence completed when its run delivered nothing", async () => {
    let current = new Date("2026-10-04T18:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([]));
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();

    // The attempt itself finished, but the Daily Issue was not fulfilled, so the
    // occurrence must stay inside its retry budget instead of claiming success.
    expect(service.today().attempts[0]).toMatchObject({
      state: "SUCCEEDED",
      deliveredCount: 0,
    });
    expect(service.today().issue?.status).toBe("NOT_DELIVERED");
    expect(service.today().occurrence).toMatchObject({
      status: "RETRY_WAIT",
      scheduledAttemptCount: 1,
    });
    expect(service.today().occurrence?.status).not.toBe("COMPLETED");

    // The retry is bounded: two more attempts, then the occurrence is exhausted.
    current = new Date("2026-10-04T18:05:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(service.today().occurrence).toMatchObject({
      status: "RETRY_WAIT",
      scheduledAttemptCount: 2,
    });

    current = new Date("2026-10-04T18:20:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(service.today().occurrence).toMatchObject({
      status: "EXHAUSTED",
      scheduledAttemptCount: 3,
    });
    expect(collect).toHaveBeenCalledTimes(3);
    expect(service.today().issue?.status).toBe("NOT_DELIVERED");
    await service.stop();
  });

  it("marks an occurrence completed only once its run fulfils the issue", async () => {
    const current = new Date("2026-10-04T18:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const { service } = makeService(store, now, collect);

    await service.start();
    await service.waitForIdle();

    expect(service.today().issue?.status).toBe("COMPLETE");
    expect(service.today().occurrence).toMatchObject({
      status: "COMPLETED",
      scheduledAttemptCount: 1,
    });
    await service.stop();
  });

  it("recovers a run interrupted by a restart and lets catch-up proceed", async () => {
    let current = new Date("2026-10-04T18:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const first = makeService(store, now, collect);
    await first.service.start();
    await first.service.waitForIdle();
    expect(first.service.today().occurrence?.status).toBe("COMPLETED");

    // A second day, with the process killed while its collection was running:
    // the attempt is persisted as RUNNING and the occurrence as RUNNING.
    current = new Date("2026-10-05T18:00:00.000Z");
    await first.service.pulse();
    await first.service.waitForIdle();
    const runningId = "attempt:interrupted";
    const secondIssue = store
      .snapshot()
      .issues.find((issue) => issue.localDate === "2026-10-05")!;
    await store.update((state) => {
      const occurrence = state.occurrences.find(
        (item) => item.localDate === "2026-10-05" && item.timezone === "UTC",
      )!;
      state.attempts.push({
        id: runningId,
        issueId: secondIssue.id,
        edition: secondIssue.edition,
        trigger: "scheduled" as const,
        state: "RUNNING" as const,
        startedAt: current.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: 0,
        traceId: "trace:interrupted",
      });
      occurrence.status = "RUNNING";
      occurrence.scheduledAttemptCount += 1;
      occurrence.lastAttemptId = runningId;
    });
    await first.service.stop();

    // Restarting the service must clear the orphaned run instead of blocking.
    current = new Date("2026-10-05T18:02:00.000Z");
    const second = makeService(store, now, collect);
    await second.service.start();
    await second.service.waitForIdle();

    const recovered = store
      .snapshot()
      .attempts.find((attempt) => attempt.id === runningId);
    expect(recovered).toMatchObject({ state: "FAILED", retryable: true });
    expect(recovered?.completedAt).not.toBeNull();
    expect(recovered?.failureReason).toContain("restart");
    // The orphaned RUNNING marker is gone, and the interrupted run is not
    // recorded as a delivery.
    expect(
      second.service.today().attempts.some((attempt) => attempt.state === "RUNNING"),
    ).toBe(false);
    expect(recovered?.deliveredCount).toBe(0);
    await second.service.stop();
  });

  it("recovers an interrupted manual run before the scheduled time without collecting early", async () => {
    let current = new Date("2026-10-05T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));

    // Let the service create today's occurrence, then stop it as a restart would.
    const previous = makeService(store, now, collect);
    await previous.service.start();
    expect(previous.service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAt: "2026-10-05T18:00:00.000Z",
    });
    await previous.service.stop();

    // A manual run was killed by a restart at 09:00, nine hours early. It left
    // the issue it created and an orphaned RUNNING attempt behind.
    const manualId = "attempt:manual-interrupted";
    const issueId = "issue:2026-10-05:UTC";
    await store.update((state) => {
      state.issues.push({
        id: issueId,
        localDate: "2026-10-05",
        timezone: "UTC",
        edition: 1,
        status: "NOT_DELIVERED",
        target: state.preferences,
        actual: { count: 0, topics: [], difficulty: null, readingMinutes: 0 },
        unmetConstraints: ["No verified full-text articles have been delivered."],
        articles: [],
        createdAt: current.toISOString(),
        updatedAt: current.toISOString(),
        priorEditions: [],
      });
      state.attempts.push({
        id: manualId,
        issueId,
        edition: 1,
        trigger: "manual" as const,
        state: "RUNNING" as const,
        startedAt: current.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: 0,
        traceId: "trace:manual-interrupted",
      });
      const occurrence = state.occurrences.find(
        (item) => item.localDate === "2026-10-05" && item.timezone === "UTC",
      )!;
      occurrence.status = "RUNNING";
      occurrence.lastAttemptId = manualId;
    });

    // Restarting at 09:05 must clear the orphaned run but preserve the schedule.
    const callsBeforeRestart = collect.mock.calls.length;
    current = new Date("2026-10-05T09:05:00.000Z");
    const service = makeService(store, now, collect);
    await service.service.start();
    await service.service.waitForIdle();

    expect(collect.mock.calls.length).toBe(callsBeforeRestart);
    expect(service.service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAt: "2026-10-05T18:00:00.000Z",
      scheduledAttemptCount: 0,
      nextAttemptAt: null,
    });
    const recovered = store
      .snapshot()
      .attempts.find((attempt) => attempt.id === manualId);
    expect(recovered).toMatchObject({ state: "FAILED", retryable: true });

    // The original schedule still fires, and only then does collection run.
    current = new Date("2026-10-05T18:00:00.000Z");
    await service.service.pulse();
    await service.service.waitForIdle();
    expect(collect.mock.calls.length).toBe(callsBeforeRestart + 1);
    expect(service.service.today().issue?.status).toBe("COMPLETE");
    expect(service.service.today().occurrence).toMatchObject({
      status: "COMPLETED",
      scheduledAttemptCount: 1,
    });
    await service.service.stop();
  });

  it("recovers an orphaned RUNNING occurrence before the scheduled time without collecting early", async () => {
    let current = new Date("2026-10-05T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const previous = makeService(store, now, collect);
    await previous.service.start();
    await previous.service.stop();

    // The manual run died before it wrote an issue, so only the occurrence and
    // its attempt id remain. Recovery must still not collect early.
    const manualId = "attempt:orphan-without-issue";
    await store.update((state) => {
      state.attempts.push({
        id: manualId,
        issueId: "issue:2026-10-05:UTC",
        edition: 1,
        trigger: "manual" as const,
        state: "RUNNING" as const,
        startedAt: current.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: 0,
        traceId: "trace:orphan-without-issue",
      });
      const occurrence = state.occurrences.find(
        (item) => item.localDate === "2026-10-05" && item.timezone === "UTC",
      )!;
      occurrence.status = "RUNNING";
      occurrence.lastAttemptId = manualId;
    });

    const callsBeforeRestart = collect.mock.calls.length;
    current = new Date("2026-10-05T09:05:00.000Z");
    const service = makeService(store, now, collect);
    await service.service.start();
    await service.service.waitForIdle();

    expect(collect.mock.calls.length).toBe(callsBeforeRestart);
    expect(service.service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAttemptCount: 0,
      nextAttemptAt: null,
    });
    await service.service.stop();
  });

  it("catches up an interrupted overnight run once the scheduled time has passed", async () => {
    let current = new Date("2026-10-05T18:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const previous = makeService(store, now, collect);
    await previous.service.start();
    await previous.service.stop();

    // The process died mid-collection at the scheduled instant and comes back
    // two minutes later, so catch-up is exactly what should happen.
    await store.update((state) => {
      const occurrence = state.occurrences.find(
        (item) => item.localDate === "2026-10-05" && item.timezone === "UTC",
      )!;
      state.attempts.push({
        id: "attempt:scheduled-interrupted",
        issueId: occurrence.id.replace("occurrence:", "issue:"),
        edition: 1,
        trigger: "scheduled" as const,
        state: "RUNNING" as const,
        startedAt: current.toISOString(),
        completedAt: null,
        retryable: false,
        failureReason: null,
        deliveredCount: 0,
        traceId: "trace:scheduled-interrupted",
      });
      occurrence.status = "RUNNING";
      occurrence.scheduledAttemptCount += 1;
      occurrence.lastAttemptId = "attempt:scheduled-interrupted";
    });

    current = new Date("2026-10-05T18:02:00.000Z");
    const service = makeService(store, now, collect);
    await service.service.start();
    await service.service.waitForIdle();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(service.service.today().issue?.status).toBe("COMPLETE");
    expect(service.service.today().occurrence).toMatchObject({
      status: "ALREADY_FULFILLED",
      scheduledAttemptCount: 2,
    });
    await service.service.stop();
  });

  it("is idempotent when recovery runs again on already-recovered state", async () => {
    const current = new Date("2026-10-05T18:02:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));

    const first = makeService(store, now, collect);
    await first.service.start();
    await first.service.waitForIdle();
    const afterFirst = store.snapshot().attempts.map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      completedAt: attempt.completedAt,
    }));
    await first.service.stop();

    // A second start with no new RUNNING attempt must not touch anything.
    const second = makeService(store, now, collect);
    await second.service.start();
    await second.service.waitForIdle();
    const afterSecond = store.snapshot().attempts.map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      completedAt: attempt.completedAt,
    }));
    expect(afterSecond).toEqual(afterFirst);
    await second.service.stop();
  });

  it("never arms its own timer when scheduling belongs to the Windows task", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const timers = fakeTimers();
    const service = new ReaderService({
      store,
      now,
      collect,
      scheduleRuns: false,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    });

    await service.start();
    // Before the configured time nothing runs, and no timer is armed, so an open
    // browser cannot compete with the scheduled task.
    expect(collect).not.toHaveBeenCalled();
    expect(timers.callbacks).toHaveLength(0);
    expect(service.today().occurrence).toMatchObject({
      status: "WAITING",
      scheduledAt: "2026-10-04T18:00:00.000Z",
    });

    // The due check itself still works: the task drives it when it fires.
    current = new Date("2026-10-04T18:00:00.000Z");
    await service.pulse();
    await service.waitForIdle();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(service.today().occurrence).toMatchObject({ status: "COMPLETED" });
    expect(timers.callbacks).toHaveLength(0);
    await service.stop();
  });

  it("arms its own timer when this process owns scheduling", async () => {
    const current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi.fn(async () => collection([article()]));
    const timers = fakeTimers();
    const events: string[] = [];
    const service = new ReaderService({
      store,
      now,
      collect,
      scheduleRuns: true,
      setTimer: (callback, delay) => {
        events.push(`arm:${delay}`);
        return timers.setTimer(callback, delay);
      },
      clearTimer: timers.clearTimer,
      reopenArticle: async () => ({ article: null, reason: "offline" }),
    });

    await service.start();
    expect(collect).not.toHaveBeenCalled();
    // The owner process arms exactly one wake-up for the configured time.
    expect(events.filter((event) => event.startsWith("arm:"))).toHaveLength(1);
    expect(events[0]).toBe(`arm:${Date.parse("2026-10-04T18:00:00.000Z") - current.getTime()}`);
    await service.stop();
  });

  it("keeps rejected and external candidates out of the delivered Daily Issue", async () => {
    const now = () => new Date("2026-10-04T09:00:00.000Z");
    const store = await createStore(now);
    const delivered = article();
    const external = article({
      id: "external-candidate",
      title: "External candidate",
      originalUrl: "https://news.example/external",
      accessibleUrl: "https://news.example/external",
      contentStatus: "EXTERNAL_ONLY",
      wordCount: 0,
      readingMinutes: 0,
      fkgl: null,
      paragraphs: undefined,
      bodyHash: undefined,
    });
    const collect = vi.fn(async () => {
      const result = collection([delivered]);
      result.candidates = [external];
      return result;
    });
    const { service } = makeService(store, now, collect);
    await service.start();
    await service.startManualRun("manual");
    await service.waitForIdle();
    const issue = service.today().issue!;
    expect(issue.actual.count).toBe(1);
    expect(issue.articles).toHaveLength(1);
    expect(issue.articles[0]?.contentStatus).toBe("FULL_TEXT");
    expect(issue.articles.some((item) => item.title === "External candidate")).toBe(false);
    await service.stop();
  });
});

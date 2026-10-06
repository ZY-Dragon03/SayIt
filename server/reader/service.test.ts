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
  ReaderService,
  type EditorialArticle,
  type EditorialCollectionResult,
  type EditorialCollector,
} from "./service";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore(now: () => Date): Promise<ReaderStore> {
  const directory = await mkdtemp(path.join(tmpdir(), "sayit-reader-service-test-"));
  directories.push(directory);
  const store = new ReaderStore({ directory, now });
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

describe("Reader collection lifecycle", () => {
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

  it("scopes article identity across dates when the same original URL is delivered again", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const now = () => new Date(current);
    const store = await createStore(now);
    const collect = vi
      .fn<EditorialCollector>()
      .mockResolvedValueOnce(collection([article({ paragraphs: ["Day one body."], bodyHash: "1".repeat(64) })]))
      .mockResolvedValueOnce(collection([article({ paragraphs: ["Day two body."], bodyHash: "2".repeat(64) })]));
    const { service } = makeService(store, now, collect);

    await service.start();
    const firstRun = await service.startManualRun("manual");
    await service.waitForIdle();
    const firstArticle = service.today().issue!.articles[0]!;

    current = new Date("2026-10-05T09:00:00.000Z");
    await service.pulse();
    const secondRun = await service.startManualRun("manual");
    await service.waitForIdle();
    const secondArticle = service.today().issue!.articles[0]!;

    expect(secondRun.issue.id).not.toBe(firstRun.issue.id);
    expect(firstArticle.originalUrl).toBe(secondArticle.originalUrl);
    expect(firstArticle.id).not.toBe(secondArticle.id);
    await expect(service.article(firstArticle.id, 1)).resolves.toMatchObject({
      article: { id: firstArticle.id },
      paragraphs: ["Day one body."],
    });
    await expect(service.article(secondArticle.id, 1)).resolves.toMatchObject({
      article: { id: secondArticle.id },
      paragraphs: ["Day two body."],
    });
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
});

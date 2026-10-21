import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReaderPreferences } from "../../src/shared/reader-contract";
import { articleBodyHash } from "./article-body";
import { createReaderHandler } from "./api";
import { ReaderService, type EditorialArticle, type EditorialCollector } from "./service";
import { ReaderStore } from "./store";

interface Harness {
  service: ReaderService;
  server: Server;
  baseUrl: string;
  directory: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map(async (harness) => {
      await harness.service.stop();
      // SQLite keeps the state file open until the store is closed.
      harness.service.close();
      await new Promise<void>((resolve, reject) => {
        harness.server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(harness.directory, { recursive: true, force: true, maxRetries: 5 });
    }),
  );
});

function prefs(overrides: Partial<ReaderPreferences> = {}): ReaderPreferences {
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

function fullArticle(id = "editorial-id-1", overrides: Partial<EditorialArticle> = {}): EditorialArticle {
  const wordCount = overrides.wordCount ?? 1400;
  const paragraphCount = overrides.paragraphCount ?? 5;
  const paragraphs = overrides.paragraphs ?? Array.from(
    { length: paragraphCount },
    (_, paragraphIndex) => {
      const count = Math.floor(wordCount / paragraphCount) + (paragraphIndex < wordCount % paragraphCount ? 1 : 0);
      return Array.from({ length: count }, (_, wordIndex) => `article${paragraphIndex}_${wordIndex}`).join(" ");
    },
  );
  return {
    id,
    title: "Technology changes the energy market",
    originalPublication: "Example News",
    originalUrl: "https://news.example/story/technology",
    accessiblePublication: "Example News",
    accessibleUrl: "https://news.example/story/technology",
    contentStatus: "FULL_TEXT",
    wordCount,
    fkglWordCount: 1400,
    sentenceCount: 93,
    syllableCount: 2380,
    readingMinutes: 7,
    fkgl: 10.34,
    readState: "UNREAD",
    cachePermission: "NOT_PERMITTED",
    topics: ["Technology"],
    difficulty: "Intermediate",
    paragraphCount,
    paragraphs,
    bodyHash: articleBodyHash(paragraphs),
    ...overrides,
  };
}

const emptyCollection = {
  status: "NOT_DELIVERED" as const,
  articles: [],
  candidates: [],
  actual: { count: 0, topics: [], difficulty: null, readingMinutes: 0 },
  unmetConstraints: ["Suitable supply was insufficient."],
  trace: { queries: ["Technology in-depth article"], candidates: [], decisions: [] },
};

async function createHarness(
  now: () => Date,
  collect: EditorialCollector,
  reopen?: NonNullable<ConstructorParameters<typeof ReaderService>[0]>["reopenArticle"],
): Promise<Harness> {
  const directory = await mkdtemp(path.join(tmpdir(), "sayit-reader-api-test-"));
  const store = new ReaderStore({ directory, now });
  await store.initialize();
  await store.update((state) => {
    state.preferences = prefs();
    state.preferencesConfigured = true;
  });
  const service = new ReaderService({
    store,
    now,
    collect,
    reopenArticle: reopen ?? (async () => ({ article: null, reason: "source unavailable" })),
    setTimer: (callback, delay) =>
      ({ callback, delay } as unknown as ReturnType<typeof setTimeout>),
    clearTimer: () => undefined,
  });
  await service.start();
  const server = createServer((request, response) => {
    void createReaderHandler(service)(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const harness = { service, server, baseUrl: "http://127.0.0.1:" + address.port, directory };
  harnesses.push(harness);
  return harness;
}

async function json(
  harness: Harness,
  route: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(harness.baseUrl + "/api/reader" + route, init);
  return { response, body: await response.json() };
}

describe("Reader local API", () => {
  it("persists preferences and returns today and bounded archive envelopes", async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const harness = await createHarness(() => new Date(current), async () => emptyCollection);
    const put = await json(harness, "/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: prefs({ collectionTime: "19:15", readingBudgetMinutes: 30 }) }),
    });
    expect(put.response.status).toBe(200);
    expect(put.body.schema_version).toBe("1");
    expect(put.body.preferences).toMatchObject({ collectionTime: "19:15", readingBudgetMinutes: 30 });

    const today = await json(harness, "/issues/today");
    expect(today.response.status).toBe(200);
    expect(today.body.schema_version).toBe("1");
    expect(today.body).toMatchObject({
      issue: null,
      occurrence: { status: "WAITING", localTime: "19:15", scheduledAttemptCount: 0 },
      attempts: [],
    });
    expect((await json(harness, "/issues/archive?limit=0")).response.status).toBe(400);
    expect((await json(harness, "/issues/archive?limit=1000")).response.status).toBe(400);
    expect((await json(harness, "/issues/archive?limit=20")).body.issues).toEqual([]);
    current = new Date("2026-10-04T10:00:00.000Z");
    await harness.service.pulse();
  });

  it("accepts only manual/regenerate run fields and returns a pollable attempt", async () => {
    const collect = vi.fn(async () => emptyCollection);
    const harness = await createHarness(() => new Date("2026-10-04T09:00:00.000Z"), collect);
    const rejected = await json(harness, "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "manual", candidateUrls: ["https://news.example/story"] }),
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.schema_version).toBe("1");

    const started = await json(harness, "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    });
    expect(started.response.status).toBe(202);
    expect(started.body.attempt).toMatchObject({ trigger: "manual", state: "RUNNING" });
    await harness.service.waitForIdle();
    const polled = await json(harness, "/runs/" + encodeURIComponent(started.body.attempt.id));
    expect(polled.response.status).toBe(200);
    expect(polled.body.attempt).toMatchObject({ state: "SUCCEEDED", deliveredCount: 0 });
    expect(polled.body.issue).toMatchObject({ id: started.body.issue.id, status: "NOT_DELIVERED" });
  });

  it("serves selected article text, progress, and immutable earlier editions", { timeout: 30_000 }, async () => {
    let current = new Date("2026-10-04T09:00:00.000Z");
    const collect = vi
      .fn<EditorialCollector>()
      .mockResolvedValueOnce({
        ...emptyCollection,
        status: "COMPLETE",
        articles: [fullArticle("editorial-id-1", {
          provenance: {
            publisherIdentity: "Example News",
            publisherIdentitySources: ["open_graph_site_name"],
            canonicalRelationship: "original_url",
            standaloneArticleVerified: true,
            titleAgreementVerified: true,
            bodyCompletenessVerified: true,
          },
          editorial: {
            contractVersion: "reader-editorial-curation.v1",
            decision: "APPROVE",
            topicFit: "YES",
            matchedTopics: ["Technology"],
            relevance: "high",
            editorialValue: "high",
            analysisDepth: "high",
            novelty: "medium",
            overlap: "none",
            contributionType: "analysis",
            rationale: "It explains how regional evidence changes the energy market.",
          },
        })],
        actual: { count: 1, topics: ["Technology"], difficulty: "Intermediate", readingMinutes: 7 },
        unmetConstraints: [],
        trace: {
          queries: ["Technology article"],
          candidates: [{
            url: "https://news.example/story/technology",
            publication: "Example News",
            outcome: "ACCEPTED",
            reason: "Full text verified.",
            statusCode: 200,
            articleId: "editorial-id-1",
          }],
          decisions: [],
        },
      })
      .mockResolvedValueOnce({
        ...emptyCollection,
        status: "COMPLETE",
        articles: [fullArticle("editorial-id-2")],
        actual: { count: 1, topics: ["Technology"], difficulty: "Intermediate", readingMinutes: 7 },
        unmetConstraints: [],
      });
    const reopen = vi.fn(async (reference) => ({ article: fullArticle(reference.id), reason: "" }));
    const harness = await createHarness(() => new Date(current), collect, reopen);
    const firstRun = await json(harness, "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    });
    await harness.service.waitForIdle();
    const firstIssue = harness.service.today().issue!;
    const oldArticleId = firstIssue.articles[0]!.id;
    expect(oldArticleId).not.toBe("editorial-id-1");

    const articleResponse = await json(
      harness,
      "/articles/" + encodeURIComponent(oldArticleId) + "?edition=1",
    );
    expect(articleResponse.response.status).toBe(200);
    expect(articleResponse.body.article).toMatchObject({ id: oldArticleId, contentStatus: "FULL_TEXT" });
    expect(articleResponse.body.article).toMatchObject({
      provenance: { publisherIdentity: "Example News", bodyCompletenessVerified: true },
      editorial: {
        contractVersion: "reader-editorial-curation.v1",
        rationale: "It explains how regional evidence changes the energy market.",
        contributionType: "analysis",
      },
    });
    expect(articleResponse.body.paragraphs).toEqual(fullArticle().paragraphs);

    const progress = await json(harness, "/progress", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issueId: firstIssue.id,
        articleId: oldArticleId,
        edition: 1,
        scrollRatio: 0.4,
        scrollTop: 420,
        firstVisibleParagraph: 1,
        paragraphOffset: 8,
      }),
    });
    expect(progress.response.status).toBe(200);
    expect(progress.body.progress.readState).toBe("IN_PROGRESS");

    const regenerated = await json(harness, "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "regenerate", confirmRegenerate: true }),
    });
    expect(regenerated.response.status).toBe(202);
    await harness.service.waitForIdle();
    const newIssue = harness.service.today().issue!;
    expect(newIssue.edition).toBe(2);
    expect(newIssue.priorEditions).toEqual([1]);
    expect(newIssue.articles[0]!.id).not.toBe(oldArticleId);
    expect(harness.service.edition(firstIssue.id, 1)?.articles[0]?.id).toBe(oldArticleId);
    const oldEdition = await json(
      harness,
      "/issues/" + encodeURIComponent(firstIssue.id) + "/editions/1",
    );
    expect(oldEdition.response.status).toBe(200);
    expect(oldEdition.body.issue.articles[0].id).toBe(oldArticleId);
    const newArticle = await json(
      harness,
      "/articles/" + encodeURIComponent(newIssue.articles[0]!.id) + "?edition=2",
    );
    expect(newArticle.body.progress).toMatchObject({ scrollRatio: 0.4, firstVisibleParagraph: 1 });
    expect(firstRun.response.status).toBe(202);

    const reloadedStore = new ReaderStore({ directory: harness.directory, now: () => new Date(current) });
    await reloadedStore.initialize();
    expect(await reloadedStore.readCache(oldArticleId, 1)).toEqual(fullArticle(oldArticleId).paragraphs);
    await reloadedStore.removeCache(oldArticleId, 1);
    const restarted = new ReaderService({
      store: reloadedStore,
      now: () => new Date(current),
      collect,
      reopenArticle: reopen,
      setTimer: (callback, delay) =>
        ({ callback, delay } as unknown as ReturnType<typeof setTimeout>),
      clearTimer: () => undefined,
    });
    await restarted.start();
    const restoredBody = await restarted.article(oldArticleId, 1);
    expect(restoredBody.paragraphs).toEqual(fullArticle(oldArticleId).paragraphs);
    expect(restoredBody.article).toMatchObject({
      editorial: {
        contractVersion: "reader-editorial-curation.v1",
        rationale: "It explains how regional evidence changes the energy market.",
      },
      provenance: { canonicalRelationship: "original_url" },
    });
    expect(reopen).toHaveBeenCalledWith(
      expect.objectContaining({ id: oldArticleId, originalUrl: "https://news.example/story/technology" }),
      expect.any(Function),
    );
    expect(await reloadedStore.readCache(oldArticleId, 1)).toEqual(fullArticle(oldArticleId).paragraphs);
    await restarted.stop();
    // A second store on the same directory holds its own SQLite handle.
    restarted.close();
    current = new Date("2026-10-05T09:00:00.000Z");
  });

  it("rejects malformed JSON, wrong methods, and non-loopback callers", async () => {
    const harness = await createHarness(() => new Date("2026-10-04T09:00:00.000Z"), async () => emptyCollection);
    const malformed = await fetch(harness.baseUrl + "/api/reader/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_json" } });
    const wrongMethod = await json(harness, "/preferences", { method: "POST" });
    expect(wrongMethod.response.status).toBe(405);

    const service = harness.service;
    const fakeResponse = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      headersSent: false,
      destroyed: false,
    };
    await createReaderHandler(service)(
      { method: "GET", url: "/api/reader/preferences", socket: { remoteAddress: "192.168.1.2" } } as never,
      fakeResponse as never,
    );
    expect(fakeResponse.statusCode).toBe(403);
  });
});

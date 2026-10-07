import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonCompletionClient, JsonCompletionRequest, JsonCompletionResponse } from "../../../server/provider";
import {
  collectEditorial,
  readingMetrics,
  type EditorialPreferences,
  type FetchedArticlePage,
} from "../../../server/reader/editorial";
import {
  ReaderService,
  type EditorialArticle,
  type EditorialCollectionResult,
  type EditorialCollector,
} from "../../../server/reader/service";
import { ReaderStore } from "../../../server/reader/store";
import type { ReaderPreferences, ReaderSemanticRuntimeTrace } from "../../../src/shared/reader-contract";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function evidencePath(observation: string, identity: { commit: string; tree: string }): string {
  const runId = new Date().toISOString().replace(/[:.]/gu, "-");
  return path.join(
    acceptanceDirectory,
    `${observation.toLowerCase()}-${identity.commit.slice(0, 8)}-${identity.tree.slice(0, 8)}-${runId}.json`,
  );
}

function semanticInput(request: JsonCompletionRequest): {
  alreadyDelivered: Array<{ title: string; publication: string; topics: string[]; wordCount: number; readingMinutes: number; difficulty: string; contributionType?: string }>;
  candidates: Array<{ id: string; title: string }>;
} {
  const match = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent);
  if (!match) throw new Error("The controlled semantic request did not use the bounded application envelope.");
  const payload = JSON.parse(match[1]!) as {
    already_delivered: ReturnType<typeof semanticInput>["alreadyDelivered"];
    candidates: ReturnType<typeof semanticInput>["candidates"];
  };
  return { alreadyDelivered: payload.already_delivered, candidates: payload.candidates };
}

function page(url: string, title: string, publisher: string, paragraphs: string[]): FetchedArticlePage {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(`<!doctype html><html lang="en"><head>
      <title>${title} | ${publisher}</title>
      <link rel="canonical" href="${url}">
      <meta property="og:type" content="article">
      <meta property="og:title" content="${title}">
      <meta name="citation_title" content="${title}">
      <meta name="citation_publication_title" content="${publisher}">
      <meta property="article:publisher" content="${publisher}">
      <meta property="og:site_name" content="${publisher}">
      </head><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`),
    finalUrl: url,
  };
}

function repeatedParagraph(phase: string): string {
  return `In the ${phase} review, technology teams compare service costs and customer needs across small towns. Finance staff record changes in monthly bills and repair hours before expanding a regional network. Managers explain each result with public evidence so readers can assess what improved and which questions remain.`;
}

const initialParagraphs = Array.from({ length: 7 }, (_, index) => repeatedParagraph(`early ${index + 1}`));
const overlapParagraphs = Array.from({ length: 7 }, (_, index) =>
  `In the ${index + 1} grid review, utility leaders report the same queue delays for technology projects. The report repeats transformer orders, local upgrade costs, and study schedules already described in the earlier connection queue coverage. It offers no new evidence about the timing or responsibility for the work.`,
);
const newParagraphs = Array.from({ length: 24 }, (_, index) =>
  `During the ${index + 1} service review, small firms compare software support costs with the time needed to repair network equipment. Local buyers record monthly charges, response times, and service interruptions before renewing a contract. Public records show which towns received faster repairs and which routes still need investment. The comparison helps readers judge how a technology plan affects daily work, customer access, and operating costs.`,
);

function preferences(overrides: Partial<ReaderPreferences> = {}): ReaderPreferences {
  return {
    topics: ["Technology"],
    dailyArticleCount: 2,
    difficulty: "Intermediate",
    readingBudgetMinutes: 10,
    collectionTime: "18:00",
    timezone: "UTC",
    ...overrides,
  };
}

function decision(
  candidateId: string,
  options: { approve: boolean; rationale: string; overlap: "none" | "substantial" },
) {
  return {
    candidate_id: candidateId,
    decision: options.approve ? "APPROVE" : "REJECT",
    topic_fit: "YES",
    matched_topics: ["Technology"],
    relevance: options.approve ? "high" : "medium",
    editorial_value: options.approve ? "high" : "low",
    analysis_depth: options.approve ? "high" : "low",
    novelty: options.approve ? "high" : "low",
    overlap: options.overlap,
    contribution_type: options.approve ? "analysis" : "reporting",
    rationale: options.rationale,
  };
}

function metricSummary(paragraphs: string[]) {
  const metrics = readingMetrics(paragraphs.join("\n\n"));
  return {
    wordCount: metrics.wordCount,
    readingMinutes: metrics.readingMinutes,
    fkgl: metrics.fkgl,
    difficulty: metrics.difficulty,
    bodySha256: createHash("sha256").update(paragraphs.join("\n\n")).digest("hex"),
  };
}

describe("PAT-V11-09 / PAT-RC-18 persistence and scheduled overlap acceptance", () => {
  it("retrieves the actual PAT-V11-03 rationale, version, contribution, and legacy records after restart", async () => {
    const identity = assertFrozenCandidate();
    const runReceiptPath = evidencePath("pat-v11-09", identity);
    const providerReceiptRelativePath = "artifacts/sayit-reader-v11/acceptance/pat-v11-03-a33e7ff1-bb917540-2026-10-06T15-44-50-606Z.json";
    const providerReceiptRaw = await readFile(path.resolve(acceptanceDirectory, "pat-v11-03-a33e7ff1-bb917540-2026-10-06T15-44-50-606Z.json"));
    const providerReceipt = JSON.parse(providerReceiptRaw.toString("utf8")) as {
      semanticRuntime: ReaderSemanticRuntimeTrace;
      selected: Array<{
        id: string;
        articleId: string;
        url: string;
        publication: string;
        title: string;
        wordCount: number;
        readingMinutes: number;
        difficulty: "Advanced";
        bodyHash: string;
        provenance: NonNullable<EditorialArticle["provenance"]>;
        editorial: NonNullable<EditorialArticle["editorial"]>;
      }>;
      candidateTrace: EditorialCollectionResult["trace"]["candidates"];
      decisionSummary: string[];
    };
    expect(providerReceipt.semanticRuntime.status).toBe("SUCCEEDED");
    expect(providerReceipt.semanticRuntime.provider).toBe("DeepSeek");
    expect(providerReceipt.selected).toHaveLength(2);

    const persistedArticles: EditorialArticle[] = providerReceipt.selected.map((selected) => ({
      id: selected.articleId,
      title: selected.title,
      originalPublication: selected.publication,
      originalUrl: selected.url,
      accessiblePublication: selected.publication,
      accessibleUrl: selected.url,
      contentStatus: "FULL_TEXT",
      wordCount: selected.wordCount,
      fkglWordCount: selected.wordCount,
      sentenceCount: 30,
      syllableCount: Math.round(selected.wordCount * 1.45),
      readingMinutes: selected.readingMinutes,
      fkgl: selected.difficulty === "Advanced" ? 13 : 10,
      readState: "UNREAD",
      cachePermission: "NOT_PERMITTED",
      topics: selected.editorial.matchedTopics,
      difficulty: selected.difficulty,
      paragraphCount: 6,
      bodyHash: selected.bodyHash,
      provenance: selected.provenance,
      editorial: selected.editorial,
    }));
    const receiptCollection: EditorialCollectionResult = {
      status: "PARTIAL",
      articles: persistedArticles,
      candidates: [],
      actual: {
        count: persistedArticles.length,
        topics: ["Environment", "Economy"],
        difficulty: "Advanced",
        readingMinutes: persistedArticles.reduce((sum, item) => sum + item.readingMinutes, 0),
      },
      unmetConstraints: ["Reading time is below the 70% target in the original provider observation."],
      trace: {
        queries: ["PAT-V11-03 controlled semantic comparison receipt replay"],
        candidates: providerReceipt.candidateTrace,
        decisions: providerReceipt.decisionSummary,
        semantic: providerReceipt.semanticRuntime,
      },
    };

    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-ae-v11-09-"));
    temporaryDirectories.push(directory);
    const now = () => new Date("2026-10-07T09:00:00.000Z");
    const savedPreferences = preferences({
      topics: ["Environment", "Economy"],
      dailyArticleCount: 2,
      difficulty: "Advanced",
      readingBudgetMinutes: 5,
      collectionTime: "23:59",
      timezone: "UTC",
    });
    const firstStore = new ReaderStore({ directory, now });
    await firstStore.initialize();
    await firstStore.update((state) => {
      state.preferences = savedPreferences;
      state.preferencesConfigured = true;
    });
    const firstService = new ReaderService({
      store: firstStore,
      now,
      collect: async () => receiptCollection,
      setTimer: () => ({}) as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
      reopenArticle: async () => ({ article: null, reason: "external-only" }),
    });
    await firstService.start();
    await firstService.startManualRun("manual");
    await firstService.waitForIdle();
    const storedIssue = firstService.today().issue;
    expect(
      storedIssue?.articles.filter((item) => item.contentStatus === "FULL_TEXT"),
      JSON.stringify({ today: firstService.today(), attempts: firstStore.snapshot().attempts, traces: firstStore.snapshot().traces }, null, 2),
    ).toHaveLength(2);
    const storedArticleIdentity = storedIssue!.articles
      .filter((item) => item.contentStatus === "FULL_TEXT")
      .map((item) => ({ id: item.id, title: item.title, originalUrl: item.originalUrl }));
    await firstService.stop();

    const reopenedStore = new ReaderStore({ directory, now });
    const reopenedService = new ReaderService({
      store: reopenedStore,
      now,
      collect: async () => receiptCollection,
      setTimer: () => ({}) as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
      reopenArticle: async () => ({ article: null, reason: "external-only" }),
    });
    await reopenedService.start();
    const reopenedIssue = reopenedService.today().issue!;
    const retrievedEdition = reopenedService.edition(reopenedIssue.id, reopenedIssue.edition)!;
    const retrieved = retrievedEdition.articles
      .filter((article) => article.contentStatus === "FULL_TEXT")
      .map((article) => ({
        id: article.id,
        title: article.title,
        originalUrl: article.originalUrl,
        editorial: article.editorial,
        provenance: article.provenance,
      }));
    expect(retrieved.map(({ id, title, originalUrl }) => ({ id, title, originalUrl }))).toEqual(storedArticleIdentity);
    expect(retrieved).toEqual(expect.arrayContaining(providerReceipt.selected.map((item) => expect.objectContaining({
      title: item.title,
      editorial: item.editorial,
      provenance: item.provenance,
    }))));
    expect(reopenedStore.snapshot().traces.at(-1)?.semantic).toEqual(providerReceipt.semanticRuntime);
    await reopenedService.stop();

    const historicalStatePath = path.join(directory, "reader-state.json");
    const historicalState = JSON.parse(await readFile(historicalStatePath, "utf8")) as {
      state: { issues: Array<{ articles: Array<Record<string, unknown>> }>; traces: Array<Record<string, unknown>> };
    };
    for (const issue of historicalState.state.issues) {
      for (const article of issue.articles) {
        delete article.editorial;
        delete article.provenance;
      }
    }
    for (const trace of historicalState.state.traces) delete trace.semantic;
    await writeFile(historicalStatePath, `${JSON.stringify(historicalState)}\n`, "utf8");
    const historicalStore = new ReaderStore({ directory, now });
    await historicalStore.initialize();
    expect(historicalStore.snapshot().issues[0]?.articles.filter((item) => item.contentStatus === "FULL_TEXT")).toHaveLength(2);
    expect(historicalStore.snapshot().traces.at(-1)).not.toHaveProperty("semantic");
    expect(historicalStore.snapshot().issues[0]?.articles.every((item) => !item.editorial && !item.provenance)).toBe(true);

    const evidence = {
      observations: ["PAT-V11-09"],
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      contract: "sayit-reader-v1.1-product-contract-r1",
      method: "candidate ReaderService/ReaderStore persistence replay using metadata and semantic trace from the successful real PAT-V11-03 receipt; no second provider call or article body persistence",
      providerReceipt: {
        path: providerReceiptRelativePath,
        sha256: createHash("sha256").update(providerReceiptRaw).digest("hex"),
        provider: providerReceipt.semanticRuntime.provider,
        model: providerReceipt.semanticRuntime.model,
        requestCount: providerReceipt.semanticRuntime.requestCount,
        selected: providerReceipt.selected.map((item) => ({
          candidateId: item.articleId,
          url: item.url,
          title: item.title,
          bodySha256: item.bodyHash,
          editorial: item.editorial,
          provenance: item.provenance,
        })),
      },
      retrievalPath: "ReaderService.start() -> today() / edition() after constructing a new ReaderStore over the same isolated directory",
      sameReaderArticleIdentityBeforeAndAfterRestart: storedArticleIdentity,
      retrieved,
      persistedSemanticTrace: reopenedStore.snapshot().traces.at(-1)?.semantic,
      historicalCompatibility: {
        editorialAndProvenanceRemoved: true,
        semanticTraceRemoved: true,
        recordsLoaded: historicalStore.snapshot().issues[0]?.articles.length,
        legacyFullTextRecords: historicalStore.snapshot().issues[0]?.articles.filter((item) => item.contentStatus === "FULL_TEXT").length,
      },
      issueStatus: reopenedIssue.status,
      isolatedDirectory: "OS temp; removed after test",
    };
    await writeFile(runReceiptPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  });

  it("uses saved-issue semantic context on the scheduled run, rejects overlap, and completes with a new article", async () => {
    const identity = assertFrozenCandidate();
    const runReceiptPath = evidencePath("pat-rc-18", identity);
    const priorUrl = "https://north-valley-technology.example/energy/grid-queue-overview";
    const overlapUrl = "https://west-ridge-technology.example/energy/queue-update";
    const newUrl = "https://community-network-review.example/technology/small-town-service-costs";
    const titles = new Map([
      [priorUrl, "How grid connection queues delay new technology projects"],
      [overlapUrl, "Grid queue update repeats project delay findings"],
      [newUrl, "Small firms compare technology support costs across towns"],
    ]);
    const publishers = new Map([
      [priorUrl, "North Valley Technology Review"],
      [overlapUrl, "West Ridge Technology Journal"],
      [newUrl, "Community Network Review"],
    ]);
    const bodies = new Map([
      [priorUrl, initialParagraphs],
      [overlapUrl, overlapParagraphs],
      [newUrl, newParagraphs],
    ]);
    const metrics = Object.fromEntries([...bodies].map(([url, paragraphs]) => [url, metricSummary(paragraphs)]));
    const newMetrics = metrics[newUrl]!;
    const priorMetrics = metrics[priorUrl]!;
    console.info("PAT-RC-18 controlled fixture metrics:", JSON.stringify(metrics));
    expect(priorMetrics.wordCount).toBeGreaterThanOrEqual(200);
    expect(priorMetrics.difficulty).toBe("Intermediate");
    expect(newMetrics.difficulty).toBe("Intermediate");
    expect(priorMetrics.readingMinutes + newMetrics.readingMinutes).toBeGreaterThanOrEqual(7);
    expect(priorMetrics.readingMinutes + newMetrics.readingMinutes).toBeLessThanOrEqual(10);

    const semanticInputs: Array<ReturnType<typeof semanticInput>> = [];
    const semanticClient: JsonCompletionClient = {
      async completeJson(request) {
        const input = semanticInput(request);
        semanticInputs.push(input);
        const decisions = input.candidates.map((candidate) => {
          const isOverlap = candidate.title === titles.get(overlapUrl);
          return isOverlap
            ? decision(candidate.id, {
              approve: false,
              overlap: "substantial",
              rationale: "Repeats the grid queue delays and project findings already delivered in this issue.",
            })
            : decision(candidate.id, {
              approve: true,
              overlap: "none",
              rationale: "Adds a technology support cost comparison from small firms across towns.",
            });
        });
        const response: JsonCompletionResponse = {
          provider: "controlled-acceptance-fixture",
          model: "scheduled-overlap-decision-control",
          requestId: `acceptance-rc18-${semanticInputs.length}`,
          content: JSON.stringify({ contract_version: "reader-editorial-curation.v1", decisions }),
        };
        return response;
      },
    };

    let collectionCall = 0;
    const collector: EditorialCollector = async (saved, options) => {
      const thisCall = collectionCall++;
      const urls = thisCall === 0 ? [priorUrl] : [overlapUrl, newUrl];
      return collectEditorial(saved as EditorialPreferences, {
        ...options,
        search: async () => urls.map((url) => ({
          url,
          title: titles.get(url)!,
          snippet: "Technology market evidence and reporting",
        })),
        fetchArticle: async (url) => {
          const body = bodies.get(url);
          if (!body) throw new Error("Unexpected controlled scheduled candidate URL.");
          return page(url, titles.get(url)!, publishers.get(url)!, body);
        },
        semanticClient,
        maxArticleChecks: 2,
      });
    };

    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-ae-rc18-"));
    temporaryDirectories.push(directory);
    let current = new Date("2026-10-07T09:00:00.000Z");
    const now = () => new Date(current);
    const savedPreferences = preferences();
    const store = new ReaderStore({ directory, now });
    await store.initialize();
    await store.update((state) => {
      state.preferences = savedPreferences;
      state.preferencesConfigured = true;
    });
    const service = new ReaderService({
      store,
      now,
      collect: collector,
      setTimer: () => ({}) as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
      reopenArticle: async () => ({ article: null, reason: "external-only" }),
    });
    await service.start();
    const initialAttempt = await service.startManualRun("manual");
    await service.waitForIdle();
    const initialIssue = service.today().issue!;
    expect(initialAttempt.attempt.trigger).toBe("manual");
    expect(initialIssue.articles.filter((item) => item.contentStatus === "FULL_TEXT")).toHaveLength(1);
    expect(initialIssue.status).toBe("PARTIAL");
    const priorArticle = initialIssue.articles.find((item) => item.originalUrl === priorUrl)!;
    expect(priorArticle.editorial?.decision).toBe("APPROVE");

    current = new Date("2026-10-07T18:00:00.000Z");
    await service.pulse("scheduled");
    await service.waitForIdle();
    const completed = service.today();
    const fullTextArticles = completed.issue?.articles.filter((item) => item.contentStatus === "FULL_TEXT") ?? [];
    const overlapTrace = completed.issue && store.snapshot().traces.find((trace) =>
      trace.issueId === completed.issue!.id &&
      trace.edition === completed.issue!.edition &&
      trace.candidates.some((candidate) => candidate.url === overlapUrl),
    );
    const overlapCandidateTrace = overlapTrace?.candidates.find((candidate) => candidate.url === overlapUrl && candidate.statusCode === 200);
    const scheduledInput = semanticInputs[1];
    expect(semanticInputs).toHaveLength(2);
    expect(scheduledInput?.alreadyDelivered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: priorArticle.title,
        publication: priorArticle.originalPublication,
        contributionType: priorArticle.editorial?.contributionType,
      }),
    ]));
    expect(overlapCandidateTrace).toMatchObject({ outcome: "REJECTED", statusCode: 200 });
    expect(overlapCandidateTrace?.reason).toContain("overlap substantial");
    expect(overlapCandidateTrace?.reason).toContain("already delivered in this issue");
    expect(fullTextArticles.map((article) => article.originalUrl).sort()).toEqual([priorUrl, newUrl].sort());
    expect(fullTextArticles).toHaveLength(2);
    expect(completed.issue).toMatchObject({
      status: "COMPLETE",
      actual: { count: 2, readingMinutes: expect.any(Number) },
    });
    expect(completed.issue!.actual.readingMinutes).toBeGreaterThanOrEqual(7);
    expect(completed.issue!.actual.readingMinutes).toBeLessThanOrEqual(10);
    expect(completed.occurrence).toMatchObject({ status: "COMPLETED", scheduledAttemptCount: 1 });
    expect(completed.attempts.map((attempt) => attempt.trigger)).toEqual(["manual", "scheduled"]);
    expect(completed.attempts.every((attempt) => attempt.state === "SUCCEEDED")).toBe(true);
    await service.stop();

    const evidence = {
      observations: ["PAT-RC-18"],
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      contract: "sayit-reader-v1.1-product-contract-r1",
      fixtureKind: "controlled synthetic verified article pages and semantic response through candidate collector and scheduled ReaderService lifecycle",
      savedPreferences,
      controlledClock: {
        manualAt: "2026-10-07T09:00:00.000Z",
        scheduledAt: "2026-10-07T18:00:00.000Z",
        method: "injected clock and explicit pulse; no calendar waiting",
      },
      fixtureMetrics: Object.fromEntries(Object.entries(metrics).map(([url, value]) => [url, { ...value, url, title: titles.get(url), publisher: publishers.get(url) }])),
      semanticRuntimeInputs: semanticInputs,
      issueId: completed.issue?.id,
      edition: completed.issue?.edition,
      finalIssue: {
        status: completed.issue?.status,
        articles: fullTextArticles.map((item) => ({
          url: item.originalUrl,
          title: item.title,
          editorial: item.editorial,
          provenance: item.provenance,
        })),
        actual: completed.issue?.actual,
      },
      rejectedOverlapTrace: overlapCandidateTrace,
      scheduledTraceSemantic: overlapTrace?.semantic,
      occurrence: completed.occurrence,
      attempts: completed.attempts.map(({ trigger, state, deliveredCount, semanticRuntimeStatus }) => ({ trigger, state, deliveredCount, semanticRuntimeStatus })),
      isolatedDirectory: "OS temp; removed after test",
    };
    await writeFile(runReceiptPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  });
});

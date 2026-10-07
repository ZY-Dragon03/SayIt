import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { createDeepSeekJsonCompletionClient, type JsonCompletionRequest, type JsonCompletionResponse } from "../../../server/provider";
import { collectEditorial, readingMetrics, type EditorialCollection, type EditorialPreferences, type FetchedArticlePage } from "../../../server/reader/editorial";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
let evidencePath: string | undefined;
const requestRecords: JsonCompletionRequest[] = [];
const responseRecords: JsonCompletionResponse[] = [];
let sanitizedEvidence: Record<string, unknown> | undefined;

function fixturePage(url: string, title: string, publisher: string, paragraphs: string[]): FetchedArticlePage {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head>
    <title>${title} | ${publisher}</title>
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${title}">
    <meta name="citation_title" content="${title}">
    <meta name="citation_publication_title" content="${publisher}">
    <meta property="article:publisher" content="${publisher}">
    <meta property="og:site_name" content="${publisher}">
    </head><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

const preferences: EditorialPreferences = {
  topics: ["Environment", "Economy"],
  dailyArticleCount: 2,
  difficulty: "Advanced",
  readingBudgetMinutes: 5,
};

const articles = [
  {
    id: "keyword-coverage",
    url: "https://energy-briefing.example/reports/weekly-projects",
    title: "Energy briefing repeats solar project announcements",
    publisher: "Energy Briefing Desk",
    paragraphs: [
      "Energy officials announced a solar project this week, and energy managers repeated that the solar project would add renewable energy to the regional energy supply. Solar companies discussed energy plans, renewable energy schedules, solar construction, energy investment, and solar project updates at another energy meeting.",
      "The energy report listed solar projects from several counties and repeated their expected renewable energy capacity. It described solar panels, solar development, energy storage, energy prices, renewable energy purchases, and additional solar plans, but it did not compare how the projects would work together.",
      "Energy representatives said more solar projects could support renewable energy goals, and the report repeated that the region had solar projects under review. It mentioned energy jobs, renewable energy businesses, solar construction, energy policy, and another solar project announcement without explaining the causes of delay.",
      "The briefing returned to energy totals, solar totals, and renewable energy targets. It repeated statements about solar companies, energy development, solar investment, and renewable energy plans, while leaving the practical effect on power delivery and household costs unanswered.",
      "Regional energy leaders also discussed renewable energy goals and solar finance, and the briefing returned to project totals. Energy companies described renewable energy demand, solar supply, and energy policy updates. No section compared the plans with household bills, grid limits, or the timing of new service.",
    ],
  },
  {
    id: "grid-analysis",
    url: "https://systems-analysis.example/energy/grid-queue",
    title: "Why the grid connection queue slows new energy projects",
    publisher: "Systems Analysis Review",
    paragraphs: [
      "A project can have financing and a construction crew yet still wait years for a grid connection. The queue is a sequence of engineering studies, and each proposed plant is checked against the same limited wires and substations.",
      "When many projects enter together, the utility studies them in groups. A change to one project can force new calculations for nearby projects, so a small design revision may restart work that seemed nearly complete.",
      "The largest delay can come from equipment, not from the number of applications. Transformers and transmission upgrades take time to order, and their cost is divided among projects under rules that applicants may not know when they first apply.",
      "This explains why a large queue does not translate directly into new power. Clearer study schedules, shared upgrade plans, and published cost rules could show developers which projects are ready and which depend on unfinished network work.",
      "Applicants can improve a study by sharing a realistic design and accepting changes when the utility finds a constraint. Yet clearer paperwork cannot replace staff or hardware. The queue measures work still to be done, not a promise that every listed project will reach construction and begin delivering power.",
      "Independent grid planners can publish a staged assessment showing which transmission upgrade, transformer delivery, environmental review, and cost allocation is still outstanding, giving investors, utilities, and communities a shared schedule for judging whether a nominally active project can actually reach operation.",
    ],
  },
  {
    id: "rural-perspective",
    url: "https://community-power.example/features/rural-reliability",
    title: "Rural residents weigh local control against power reliability",
    publisher: "Community Power Journal",
    paragraphs: [
      "Residents in small towns often hear about an energy project only after its route and ownership have been chosen. For families served by a local cooperative, the question is not simply how much electricity a new plant can produce.",
      "Some members want local control and a share of the revenue, while others ask who will restore service after a storm. Their meetings connect an energy investment to repair crews, bills, land use, and the future of a community institution.",
      "Cooperative leaders say a regional power plan can bring more stable supply, but members want the contract and reliability measures explained in plain language. Their view adds a practical test for plans described mainly through capacity forecasts.",
      "This perspective does not settle which project should proceed. It shows why public support depends on who makes decisions, who pays for backup service, and whether rural customers can see a benefit beyond a distant generation target.",
      "At open meetings, people also ask how a rate will be set and which office will answer a complaint. Those details shape trust as much as the size of a proposed energy project or its forecast output.",
      "Members often request a transparent account of ownership, representation, emergency restoration, ratepayer liability, and the cooperative's long term responsibilities, because a regional forecast cannot show which local institution will dispatch repair crews or answer customers when extreme weather interrupts service.",
    ],
  },
];

const pages = new Map(articles.map((article) => [
  article.url,
  fixturePage(article.url, article.title, article.publisher, article.paragraphs),
]));

describe("PAT-V11-03 real configured semantic comparison", () => {
  afterAll(() => {
    if (sanitizedEvidence && evidencePath) {
      writeFileSync(evidencePath, `${JSON.stringify(sanitizedEvidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
  });

  it("checks the controlled candidate bodies meet full-text length and one shared difficulty", () => {
    assertFrozenCandidate();
    const metrics = articles.map((article) => readingMetrics(article.paragraphs.join("\n\n")));
    console.info("Controlled PAT-V11-03 fixture metrics:", JSON.stringify(metrics.map(({ wordCount, readingMinutes, fkgl, difficulty }) => ({ wordCount, readingMinutes, fkgl, difficulty }))));
    expect(metrics.every((item) => item.wordCount >= 200)).toBe(true);
    expect(new Set(metrics.map((item) => item.difficulty)).size).toBe(1);
  });

  it("selects substantive analysis and an independent perspective within two fitting slots", async () => {
    const identity = assertFrozenCandidate();
    const runId = new Date().toISOString().replace(/[:.]/gu, "-");
    evidencePath = path.join(
      acceptanceDirectory,
      `pat-v11-03-${identity.commit.slice(0, 8)}-${identity.tree.slice(0, 8)}-${runId}.json`,
    );
    // Match the application's existing Vite env-loading path. Only this loader reads the
    // ignored main-checkout config; every application import and collector/provider call
    // below resolves to the fixed V1.1 candidate worktree.
    const env = loadEnv("development", "F:/AI_PROJECTS/SayIt", "");
    if (!env.DEEPSEEK_API_KEY) throw new Error("The existing local DeepSeek configuration is unavailable.");
    const configuredModel = env.DEEPSEEK_MODEL;
    const actualClient = createDeepSeekJsonCompletionClient({
      apiKey: env.DEEPSEEK_API_KEY,
      model: configuredModel,
      baseUrl: env.DEEPSEEK_BASE_URL,
    });
    const realRecordingClient = {
      async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResponse> {
        requestRecords.push(request);
        const response = await actualClient.completeJson(request);
        responseRecords.push(response);
        return response;
      },
    };
    let searchInvocations = 0;

    const baseEvidence = {
      observation: "PAT-V11-03",
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      contract: "sayit-reader-v1.1-product-contract-r1",
      fixtureKind: "controlled synthetic HTML pages passed through candidate full-text and provenance verification",
      providerConfigSource: "existing ignored local config, loaded in memory through Vite loadEnv development mode; secret fields omitted",
      processRoot: process.cwd(),
      preferences,
      candidateFixtures: articles.map((article) => ({
        fixtureId: article.id,
        url: article.url,
        title: article.title,
        publisher: article.publisher,
        bodyParagraphCount: article.paragraphs.length,
        bodyWordCount: readingMetrics(article.paragraphs.join("\n\n")).wordCount,
        bodySha256: createHash("sha256").update(article.paragraphs.join("\n\n")).digest("hex"),
      })),
    };
    sanitizedEvidence = { ...baseEvidence, completionCalls: [] };
    let result: EditorialCollection;
    try {
      result = await collectEditorial(preferences, {
        search: async () => searchInvocations++ === 0
          ? articles.map(({ url, title }) => ({ url, title, snippet: "Energy system reporting and analysis" }))
          : [],
        fetchArticle: async (url) => {
          const page = pages.get(url);
          if (!page) throw new Error("The controlled verified candidate fixture was not found.");
          return page;
        },
        semanticClient: realRecordingClient,
        maxArticleChecks: 3,
      });
    } catch (error) {
      const details = error as { code?: string; retryable?: boolean; trace?: unknown };
      sanitizedEvidence = {
        ...baseEvidence,
        completionCalls: requestRecords.map((request, index) => ({
          request,
          response: responseRecords[index] ?? null,
        })),
        failure: {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
          code: details.code ?? null,
          retryable: details.retryable ?? null,
          candidateFailureTrace: details.trace ?? null,
        },
      };
      throw error;
    }

    const decisions = result.trace.semantic?.decisions ?? [];
    const reviewEnvelope = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(requestRecords[0]?.userContent ?? "");
    if (!reviewEnvelope) throw new Error("The actual provider request lacked the bounded semantic review input.");
    const submittedCandidates = (JSON.parse(reviewEnvelope[1]!) as { candidates: Array<{ id: string }> }).candidates;
    const submittedCandidateIds = submittedCandidates.map((candidate) => candidate.id);
    const fixtureUrls = new Set(articles.map((article) => article.url));
    const verifiedFullTextCandidateIds = result.trace.candidates
      .filter((candidate) => fixtureUrls.has(candidate.url) && candidate.statusCode === 200 && candidate.articleId !== null)
      .map((candidate) => candidate.articleId!);
    const selected = result.articles.map((article) => ({
      id: articles.find((fixture) => fixture.url === article.originalUrl)?.id ?? article.id,
      articleId: article.id,
      url: article.originalUrl,
      publication: article.originalPublication,
      title: article.title,
      wordCount: article.wordCount,
      readingMinutes: article.readingMinutes,
      difficulty: article.difficulty,
      bodyHash: article.bodyHash,
      provenance: article.provenance,
      editorial: article.editorial,
    }));
    const preparedEvidence = {
      ...baseEvidence,
      semanticRuntime: result.trace.semantic,
      semanticInputCandidateIds: submittedCandidateIds,
      verifiedFullTextCandidateIds,
      completionCalls: requestRecords.map((request, index) => ({
        request,
        response: responseRecords[index] ?? null,
      })),
      selected,
      candidateTrace: result.trace.candidates,
      finalStatus: result.status,
      actual: result.actual,
      unmetConstraints: result.unmetConstraints,
      outputEvidence: result.trace.decisions,
      decisionSummary: decisions.map(({ candidateId, editorial }) => ({
        candidateId,
        decision: editorial.decision,
        topicFit: editorial.topicFit,
        relevance: editorial.relevance,
        editorialValue: editorial.editorialValue,
        analysisDepth: editorial.analysisDepth,
        novelty: editorial.novelty,
        overlap: editorial.overlap,
        contributionType: editorial.contributionType,
        rationale: editorial.rationale,
      })),
    };
    sanitizedEvidence = preparedEvidence;

    expect(result.trace.semantic?.status).toBe("SUCCEEDED");
    expect(result.trace.semantic?.provider).toBe("DeepSeek");
    expect(requestRecords.length).toBeGreaterThanOrEqual(1);
    expect(requestRecords.length).toBeLessThanOrEqual(2);
    expect(responseRecords.length).toBe(requestRecords.length);
    expect(submittedCandidateIds).toHaveLength(3);
    expect(result.trace.semantic?.candidateIds.slice().sort()).toEqual(submittedCandidateIds.slice().sort());
    expect(new Set(verifiedFullTextCandidateIds).size).toBe(3);
    expect(verifiedFullTextCandidateIds.slice().sort()).toEqual(submittedCandidateIds.slice().sort());
    const selectedFixtureIds = result.articles
      .map((article) => articles.find((fixture) => fixture.url === article.originalUrl)?.id)
      .sort();
    expect(selectedFixtureIds).toEqual(["grid-analysis", "rural-perspective"].sort());
    expect(result.actual.count).toBe(2);
    expect(result.actual.readingMinutes).toBeLessThanOrEqual(preferences.readingBudgetMinutes);
    expect(result.articles.every((article) => article.editorial?.rationale.length >= 8)).toBe(true);
    expect(result.articles.every((article) => article.difficulty === "Advanced")).toBe(true);
    const analysisArticle = result.articles.find((article) => article.originalUrl === articles.find((fixture) => fixture.id === "grid-analysis")?.url);
    const perspectiveArticle = result.articles.find((article) => article.originalUrl === articles.find((fixture) => fixture.id === "rural-perspective")?.url);
    expect(analysisArticle?.editorial?.rationale.toLowerCase()).toMatch(/queue|transformer|cost|study|connection/u);
    expect(perspectiveArticle?.editorial?.rationale.toLowerCase()).toMatch(/rural|cooperative|member|reliability|community/u);
    expect(result.trace.candidates.find((candidate) => candidate.url === articles[0]?.url)?.outcome).toBe("REJECTED");
  }, 90_000);
});

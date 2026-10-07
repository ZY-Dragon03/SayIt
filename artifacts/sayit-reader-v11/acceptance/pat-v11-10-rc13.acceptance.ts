import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonCompletionClient, JsonCompletionRequest, JsonCompletionResponse } from "../../../server/provider";
import { collectEditorial, readingMetrics, type EditorialPreferences, type FetchedArticlePage } from "../../../server/reader/editorial";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));

const preferences: EditorialPreferences = {
  topics: ["Technology", "Economy"],
  dailyArticleCount: 4,
  difficulty: "Intermediate",
  readingBudgetMinutes: 20,
};

const phases = [
  "early", "second", "third", "fourth", "spring", "summer", "autumn", "winter", "pilot",
  "regional", "annual", "current", "midyear", "late", "launch", "review", "closing", "final",
];

interface ArticleFixture {
  id: string;
  url: string;
  title: string;
  publisher: string;
  kind: "software" | "semiconductor" | "broadband" | "battery" | "datacenter" | "robotics" | "fintech";
  paragraphCount: number;
  deny?: boolean;
  difficultyOverride?: "Advanced";
}

const articleFixtures: ArticleFixture[] = [
  { id: "software", url: "https://software-ledger.example/technology/workflow-costs", title: "Software tools and market costs for small firms", publisher: "Software Ledger", kind: "software", paragraphCount: 18 },
  { id: "semiconductor", url: "https://chip-market.example/economy/packaging-capacity", title: "Chip plants adjust equipment and export plans", publisher: "Chip Market Review", kind: "semiconductor", paragraphCount: 18 },
  { id: "broadband", url: "https://regional-network.example/technology/rural-investment", title: "Broadband investment and service costs in rural towns", publisher: "Regional Network Journal", kind: "broadband", paragraphCount: 18 },
  { id: "battery", url: "https://storage-industry.example/economy/cell-manufacturing", title: "Battery technology contracts shape factory output", publisher: "Storage Industry Report", kind: "battery", paragraphCount: 18 },
  { id: "over-budget", url: "https://compute-power.example/technology/cooling-spend", title: "Data center technology costs exceed an issue budget", publisher: "Compute Power Journal", kind: "datacenter", paragraphCount: 42 },
  { id: "wrong-difficulty", url: "https://automation-lab.example/economy/robotics-forecast", title: "Advanced robotics technology changes factory forecasts", publisher: "Automation Lab Report", kind: "robotics", paragraphCount: 18, difficultyOverride: "Advanced" },
  { id: "semantic-denial", url: "https://payment-market.example/technology/checkout-plan", title: "Payment software and online market plans", publisher: "Payment Market Notes", kind: "fintech", paragraphCount: 18, deny: true },
];

function paragraph(kind: ArticleFixture["kind"], phase: string): string {
  switch (kind) {
    case "software":
      return `In the ${phase} review, software firms revise cloud tools when customer demand and support tickets change. Finance leads compare subscription revenue, staffing needs, and service costs before extending a renewal offer. Managers track each release so buyers can distinguish a lasting productivity gain from a temporary sales shift.`;
    case "semiconductor":
      return `The ${phase} output plan at chip plants changes when packaging capacity or equipment delivery slips. Finance teams model wafer prices, export contracts, and line use before approving new factory spending. Plant leaders report yield and delivery steps so customers can tell a real supply change from a short hold.`;
    case "broadband":
      return `During the ${phase} network review, broadband providers map repair needs across rural routes and town exchanges. Planners compare tower leases, cable replacement, and local subscriber income before setting the next build schedule. Cooperative boards publish work orders so residents can judge access gains against monthly service charges. Town boards check each step monthly and tell residents when a supplier must act.`;
    case "battery":
      return `In the ${phase} procurement cycle, battery makers compare storage cell designs against factory power needs. Buyers review mineral contracts, charging tests, and shipping charges before increasing assembly volume. Managers track material recovery and defect rates so customers can judge whether a new line saves cost or moves waste. Plant leads check each step monthly and tell buyers when a supplier must act.`;
    case "datacenter":
      return `The ${phase} data center plan changes when a customer needs more server space and local power rates move. Finance workers compare rent, staff hours, cooling bills, and supply contracts before adding another server hall. Site managers log use and repair times so buyers can see whether the new plan saves enough money.`;
    case "robotics":
      return `The ${phase} automation consortium evaluates interoperability, mechanization, calibration, and international procurement across a manufacturing architecture. Econometric projections estimate depreciation, configuration, and productivity under alternative operational assumptions. Executives assess jurisdictional restrictions, reliability certification, and capital allocation before restructuring the organization’s technical infrastructure.`;
    case "fintech":
      return `In the ${phase} checkout trial, payment teams compare screen layouts, merchant calls, and buyer exits. Product staff review licensing, service fees, and support hours before adding a new step. Store owners record missed purchases and customer questions so the market can judge whether a software change earns its cost.`;
  }
}

function articleBody(fixture: ArticleFixture): string[] {
  return Array.from({ length: fixture.paragraphCount }, (_, index) => paragraph(fixture.kind, phases[index % phases.length]!));
}

function page(fixture: ArticleFixture, paragraphs: string[]): FetchedArticlePage {
  const htmlBody = paragraphs.map((text) => `<p>${text}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head>
    <title>${fixture.title} | ${fixture.publisher}</title>
    <link rel="canonical" href="${fixture.url}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${fixture.title}">
    <meta name="citation_title" content="${fixture.title}">
    <meta name="citation_publication_title" content="${fixture.publisher}">
    <meta property="article:publisher" content="${fixture.publisher}">
    <meta property="og:site_name" content="${fixture.publisher}">
  </head><body><main><article><h1>${fixture.title}</h1>${htmlBody}</article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: fixture.url,
  };
}

function semanticInput(userContent: string): { candidates: Array<{ id: string; title: string; topicalEvidence: string[] }> } {
  const match = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(userContent);
  if (!match) throw new Error("The controlled semantic request was not bounded with the expected envelope.");
  return JSON.parse(match[1]!) as { candidates: Array<{ id: string; title: string; topicalEvidence: string[] }> };
}

describe("PAT-V11-10 / PAT-RC-13 exact final fulfillment constraints", () => {
  it("keeps exact Technology + Economy, four Intermediate articles, and 14-20 of 20 minutes", async () => {
    const identity = assertFrozenCandidate();
    const runId = new Date().toISOString().replace(/[:.]/gu, "-");
    const evidencePath = path.join(acceptanceDirectory, `pat-v11-10-rc13-${identity.commit.slice(0, 8)}-${identity.tree.slice(0, 8)}-${runId}.json`);
    const bodies = new Map(articleFixtures.map((fixture) => [fixture.url, articleBody(fixture)]));
    const metrics = articleFixtures.map((fixture) => ({ fixture, ...readingMetrics(bodies.get(fixture.url)!.join("\n\n")) }));

    console.info("PAT-V11-10 / RC-13 fixture metrics:", JSON.stringify(metrics.map(({ fixture, wordCount, readingMinutes, fkgl, difficulty }) => ({ id: fixture.id, wordCount, readingMinutes, fkgl, difficulty }))));
    expect(metrics.slice(0, 4).every((item) => item.wordCount >= 200 && item.difficulty === "Intermediate")).toBe(true);
    expect(metrics.slice(0, 4).reduce((sum, item) => sum + item.readingMinutes, 0)).toBeGreaterThanOrEqual(14);
    expect(metrics.slice(0, 4).reduce((sum, item) => sum + item.readingMinutes, 0)).toBeLessThanOrEqual(20);
    expect(metrics.find((item) => item.fixture.id === "over-budget")?.readingMinutes).toBeGreaterThan(8);
    expect(metrics.find((item) => item.fixture.id === "wrong-difficulty")?.difficulty).toBe("Advanced");

    const completionRequests: Array<{ request: JsonCompletionRequest; response: JsonCompletionResponse }> = [];
    const semanticClient: JsonCompletionClient = {
      async completeJson(request) {
        const input = semanticInput(request.userContent);
        const response: JsonCompletionResponse = {
          provider: "controlled-acceptance-fixture",
          model: "explicit-final-selector-control",
          requestId: "acceptance-v11-10-1",
          content: JSON.stringify({
            contract_version: "reader-editorial-curation.v1",
            decisions: input.candidates.map((candidate) => ({
              candidate_id: candidate.id,
              decision: articleFixtures.find((fixture) => fixture.title === candidate.title)?.deny ? "REJECT" : "APPROVE",
              topic_fit: "YES",
              matched_topics: ["Technology", "Economy"],
              relevance: "high",
              editorial_value: "high",
              analysis_depth: "high",
              novelty: "high",
              overlap: "none",
              contribution_type: "analysis",
              rationale: `This controlled article explains a concrete ${candidate.topicalEvidence.join(" and ")} planning tradeoff with evidence in its verified body.`,
            })),
          }),
        };
        completionRequests.push({
          request,
          response,
        });
        return response;
      },
    };

    let searchCalls = 0;
    const collection = await collectEditorial(preferences, {
      search: async () => searchCalls++ === 0
        ? articleFixtures.map(({ url, title }) => ({ url, title, snippet: "Technology and economy article" }))
        : [],
      fetchArticle: async (url) => {
        const fixture = articleFixtures.find((item) => item.url === url);
        if (!fixture) throw new Error("The controlled RC-13 article fixture was not found.");
        return page(fixture, bodies.get(url)!);
      },
      semanticClient,
      maxArticleChecks: articleFixtures.length,
    });

    const selected = collection.articles.map((article) => ({
      fixtureId: articleFixtures.find((fixture) => fixture.url === article.originalUrl)?.id,
      articleId: article.id,
      title: article.title,
      publication: article.originalPublication,
      wordCount: article.wordCount,
      readingMinutes: article.readingMinutes,
      difficulty: article.difficulty,
      topics: article.topics,
      bodyHash: article.bodyHash,
      editorial: article.editorial,
    }));
    const evidence = {
      observation: ["PAT-V11-10", "PAT-RC-13"],
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      contract: "sayit-reader-v1.1-product-contract-r1",
      fixtureKind: "synthetic controlled article pages; semantic response is a selector-only control",
      preferences,
      candidateMetrics: metrics.map(({ fixture, wordCount, readingMinutes, fkgl, difficulty }) => ({ fixtureId: fixture.id, url: fixture.url, title: fixture.title, wordCount, readingMinutes, fkgl, difficulty, bodySha256: createHash("sha256").update(bodies.get(fixture.url)!.join("\n\n")).digest("hex") })),
      semanticRuntime: collection.trace.semantic,
      completionRequests,
      selected,
      trace: collection.trace.candidates,
      decisions: collection.trace.decisions,
      status: collection.status,
      actual: collection.actual,
      unmetConstraints: collection.unmetConstraints,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    expect(collection.status).toBe("COMPLETE");
    expect(collection.actual.count).toBe(4);
    expect(collection.actual.topics).toEqual(expect.arrayContaining(["Technology", "Economy"]));
    expect(collection.actual.difficulty).toBe("Intermediate");
    expect(collection.actual.readingMinutes).toBeGreaterThanOrEqual(14);
    expect(collection.actual.readingMinutes).toBeLessThanOrEqual(20);
    expect(selected.map((item) => item.fixtureId).sort()).toEqual(["software", "semiconductor", "broadband", "battery"].sort());
    expect(collection.trace.candidates.find((candidate) => candidate.url === articleFixtures.find((item) => item.id === "semantic-denial")?.url && candidate.outcome === "REJECTED")).toBeDefined();
    expect(collection.trace.candidates.find((candidate) => candidate.url === articleFixtures.find((item) => item.id === "wrong-difficulty")?.url)?.reason).toContain("Semantic approval did not override measured difficulty Advanced");
    expect(selected.some((item) => item.fixtureId === "over-budget")).toBe(false);
  });
});

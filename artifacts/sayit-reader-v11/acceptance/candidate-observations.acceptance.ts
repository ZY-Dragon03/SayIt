import { describe, expect, it, vi } from "vitest";
import { collectEditorial, shingleJaccard, type EditorialPreferences, type FetchedArticlePage } from "../../../server/reader/editorial";
import type { JsonCompletionClient } from "../../../server/provider";
import { assertFrozenCandidate } from "./candidate-guard";

function preferences(overrides: Partial<EditorialPreferences> = {}): EditorialPreferences {
  return {
    topics: ["Technology"],
    dailyArticleCount: 1,
    difficulty: "Intermediate",
    readingBudgetMinutes: 10,
    ...overrides,
  };
}

function page(
  url: string,
  publisher: string,
  siteName: string,
  options: { title?: string; body?: string } = {},
): FetchedArticlePage {
  const title = options.title ?? "Unknown technology publisher conflict observation";
  const body = options.body ?? Array.from({ length: 8 }, (_, index) =>
    `<p>Technology teams reported new evidence about the regional software market. The article explains how public research, product changes, and local business plans affect users over time. Independent analysts compared the published results with earlier studies and described the limits of the current data. The report separates confirmed findings from forecasts and identifies questions that future work may answer. Section ${index + 1} gives readers more detail about the research method and its public impact.</p>`,
  ).join("");
  const html = `<!doctype html><html lang="en"><head>
    <title>${title} | ${publisher}</title>
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${title}">
    <meta name="citation_title" content="${title}">
    <meta name="citation_publication_title" content="${publisher}">
    <meta property="article:publisher" content="${publisher}">
    <meta property="og:site_name" content="${siteName}">
    </head><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

const approvingSemanticClient: JsonCompletionClient = {
  async completeJson(request) {
    const match = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent);
    if (!match) throw new Error("The bounded semantic input was missing.");
    const input = JSON.parse(match[1]!) as { preferences: { topics: string[] }; candidates: Array<{ id: string }> };
    return {
      provider: "controlled-acceptance-fixture",
      model: "explicit-dedupe-only-decision",
      requestId: "acceptance-dedupe-1",
      content: JSON.stringify({
        contract_version: "reader-editorial-curation.v1",
        decisions: input.candidates.map((candidate) => ({
          candidate_id: candidate.id,
          decision: "APPROVE",
          topic_fit: "YES",
          matched_topics: input.preferences.topics.slice(0, 1),
          relevance: "high",
          editorial_value: "medium",
          analysis_depth: "medium",
          novelty: "medium",
          overlap: "none",
          contribution_type: "reporting",
          rationale: "This verified report contributes technology coverage beyond the copied article.",
        })),
      }),
    };
  },
};

describe("SayIt Reader V1.1 candidate-bound acceptance observations", () => {
  it("PAT-V11-02 rejects an unknown publisher versus og:site_name conflict before semantic review", async () => {
    assertFrozenCandidate();
    const url = "https://unlisted-editorial-source.example/technology/report";
    const semanticClient: JsonCompletionClient = {
      completeJson: vi.fn(async () => ({
        provider: "acceptance-spy",
        model: "must-not-run",
        requestId: "must-not-run",
        content: "{}",
      })),
    };

    const result = await collectEditorial(preferences(), {
      search: async () => [{ url, title: "Unknown technology publisher conflict observation", snippet: "Technology report" }],
      fetchArticle: async () => page(url, "Riverland Technology Journal", "North Coast Market News"),
      semanticClient,
      maxArticleChecks: 1,
    });

    expect(result.articles).toEqual([]);
    expect(result.actual.count).toBe(0);
    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ contentStatus: "EXTERNAL_ONLY" });
    expect(result.trace.candidates).toContainEqual(expect.objectContaining({
      url,
      outcome: "REJECTED",
      reason: "Publisher identity metadata conflicts.",
      statusCode: 200,
    }));
    expect(result.trace.semantic).toBeUndefined();
    expect(semanticClient.completeJson).not.toHaveBeenCalled();
  });

  it("PAT-RC-27 rejects a nonidentical near-copy at the frozen shingle threshold", async () => {
    assertFrozenCandidate();
    const firstUrl = "https://unlisted-desk-one.example/technology/report";
    const nearCopyUrl = "https://unlisted-desk-two.example/technology/report-rewrite";
    const title = "Technology research report explains a regional software market";
    const firstBody = Array.from({ length: 8 }, (_, index) =>
      `<p>Technology teams reported new evidence about the regional software market. The article explains how public research, product changes, and local business plans affect users over time. Independent analysts compared the published results with earlier studies and described the limits of the current data. The report separates confirmed findings from forecasts and identifies questions that future work may answer. Section ${index + 1} gives readers more detail about the research method and its public impact.</p>`,
    ).join("");
    const nearCopyBody = firstBody.replace(
      "The report separates confirmed findings from forecasts",
      "The report divides confirmed findings from forecasts",
    );
    const plainText = (html: string) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
    const similarity = shingleJaccard(plainText(firstBody), plainText(nearCopyBody));
    expect(nearCopyBody).not.toBe(firstBody);
    expect(similarity).toBeGreaterThanOrEqual(0.85);

    const result = await collectEditorial(preferences({ difficulty: "Advanced" }), {
      search: async () => [
        { url: firstUrl, title, snippet: "Technology evidence and research" },
        { url: nearCopyUrl, title: "Technology evidence from new research", snippet: "Software market update" },
      ],
      fetchArticle: async (url) => url === firstUrl
        ? page(firstUrl, "North Valley Technology Review", "North Valley Technology Review", { title, body: firstBody })
        : page(nearCopyUrl, "West Ridge Technology Review", "West Ridge Technology Review", { title: "Technology evidence from new research", body: nearCopyBody }),
      semanticClient: approvingSemanticClient,
      maxArticleChecks: 2,
    });

    expect(result.articles, JSON.stringify({
      status: result.status,
      candidates: result.trace.candidates,
      decisions: result.trace.decisions,
      summaries: result.candidates.map((candidate) => ({ contentStatus: candidate.contentStatus, reason: candidate.provenance })),
    })).toHaveLength(1);
    expect(result.articles[0]?.originalUrl).toBe(firstUrl);
    expect(result.trace.candidates).toContainEqual(expect.objectContaining({
      url: nearCopyUrl,
      outcome: "DUPLICATE",
      reason: expect.stringMatching(/Near-duplicate body; 5-word shingle Jaccard .* ≥ 0\.850 with no meaningful independent addition\./u),
    }));
    expect(result.trace.semantic?.candidateIds).toEqual([result.articles[0]?.id]);
  });
});

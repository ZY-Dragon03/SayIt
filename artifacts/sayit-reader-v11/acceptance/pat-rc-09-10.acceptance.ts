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
  topics: ["Finance"],
  dailyArticleCount: 1,
  difficulty: "Intermediate",
  readingBudgetMinutes: 5,
};

const inaccessibleOriginal = {
  url: "https://unlisted-origin-finance.example/research/credit-report",
  title: "Credit market report from North Coast Finance Research",
  publisher: "North Coast Finance Research",
};
const independentAlternative = {
  url: "https://independent-river-economics.example/analysis/local-credit-costs",
  title: "Independent analysis of local credit costs and lender access",
  publisher: "River Economics Journal",
};

const paragraphs = Array.from({ length: 15 }, (_, index) =>
  `In the ${index + 1} annual review, local lenders compare credit costs with the needs of small businesses. Researchers record loan rates, approval times, and repayment terms before describing how different towns receive service. The analysis separates public records from estimates and explains how fees affect each borrower. Readers can compare the evidence and see which questions remain unanswered.`,
);
const bodyText = paragraphs.join("\n\n");

function htmlPage(url: string, title: string, publisher: string): FetchedArticlePage {
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

function candidateInput(request: JsonCompletionRequest): { candidates: Array<{ id: string; title: string }> } {
  const match = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent);
  if (!match) throw new Error("Expected the bounded semantic input envelope.");
  return JSON.parse(match[1]!) as { candidates: Array<{ id: string; title: string }> };
}

describe("PAT-RC-09 / PAT-RC-10 source attribution recovery acceptance", () => {
  it("keeps an inaccessible original external-only and attributes a verified independent alternative to its own source", async () => {
    const identity = assertFrozenCandidate();
    const runId = new Date().toISOString().replace(/[:.]/gu, "-");
    const output = path.join(
      acceptanceDirectory,
      `pat-rc-09-10-${identity.commit.slice(0, 8)}-${identity.tree.slice(0, 8)}-${runId}.json`,
    );
    const metrics = readingMetrics(bodyText);
    console.info("PAT-RC-09/10 alternative fixture metrics:", JSON.stringify(metrics));
    expect(metrics.wordCount).toBeGreaterThanOrEqual(200);
    expect(metrics.difficulty).toBe("Intermediate");
    expect(metrics.readingMinutes).toBeGreaterThanOrEqual(3.5);
    expect(metrics.readingMinutes).toBeLessThanOrEqual(5);

    const semanticRequests: JsonCompletionRequest[] = [];
    const semanticClient: JsonCompletionClient = {
      async completeJson(request) {
        semanticRequests.push(request);
        const input = candidateInput(request);
        const response: JsonCompletionResponse = {
          provider: "controlled-acceptance-fixture",
          model: "source-attribution-path-control",
          requestId: "acceptance-source-recovery-1",
          content: JSON.stringify({
            contract_version: "reader-editorial-curation.v1",
            decisions: input.candidates.map((candidate) => ({
              candidate_id: candidate.id,
              decision: "APPROVE",
              topic_fit: "YES",
              matched_topics: ["Finance"],
              relevance: "high",
              editorial_value: "high",
              analysis_depth: "high",
              novelty: "high",
              overlap: "none",
              contribution_type: "analysis",
              rationale: "Compares local credit costs and lender access using rate, approval-time, and repayment evidence.",
            })),
          }),
        };
        return response;
      },
    };

    const result = await collectEditorial(preferences, {
      search: async () => [
        { url: inaccessibleOriginal.url, title: inaccessibleOriginal.title, publication: inaccessibleOriginal.publisher, snippet: "Finance research report" },
        { url: independentAlternative.url, title: independentAlternative.title, publication: independentAlternative.publisher, snippet: "Independent Finance analysis" },
      ],
      fetchArticle: async (url) => {
        if (url === inaccessibleOriginal.url) {
          return {
            statusCode: 403,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: Buffer.from("Access restricted"),
            finalUrl: url,
          };
        }
        if (url === independentAlternative.url) {
          return htmlPage(url, independentAlternative.title, independentAlternative.publisher);
        }
        throw new Error("Unexpected URL in the controlled source attribution flow.");
      },
      semanticClient,
      maxArticleChecks: 2,
    });

    const originalFailure = result.trace.candidates.find((candidate) =>
      candidate.url === inaccessibleOriginal.url && candidate.statusCode === 403,
    );
    const externalOriginal = result.candidates.find((candidate) => candidate.originalUrl === inaccessibleOriginal.url);
    const selectedAlternative = result.articles.find((article) => article.originalUrl === independentAlternative.url);
    expect(originalFailure).toMatchObject({
      outcome: "REJECTED",
      publication: inaccessibleOriginal.publisher,
      reason: "Source returned HTTP 403.",
      statusCode: 403,
    });
    expect(externalOriginal).toMatchObject({
      title: inaccessibleOriginal.title,
      originalPublication: inaccessibleOriginal.publisher,
      originalUrl: inaccessibleOriginal.url,
      accessiblePublication: inaccessibleOriginal.publisher,
      accessibleUrl: inaccessibleOriginal.url,
      contentStatus: "EXTERNAL_ONLY",
    });
    expect(result.articles).toHaveLength(1);
    expect(result.actual.count).toBe(1);
    expect(result.status).toBe("COMPLETE");
    expect(selectedAlternative).toMatchObject({
      title: independentAlternative.title,
      originalPublication: "Independent River Economics",
      originalUrl: independentAlternative.url,
      accessiblePublication: independentAlternative.publisher,
      accessibleUrl: independentAlternative.url,
      contentStatus: "FULL_TEXT",
      editorial: { decision: "APPROVE", contributionType: "analysis" },
      provenance: {
        publisherIdentity: independentAlternative.publisher,
        standaloneArticleVerified: true,
        titleAgreementVerified: true,
        bodyCompletenessVerified: true,
      },
    });
    expect(semanticRequests).toHaveLength(1);
    expect(candidateInput(semanticRequests[0]!).candidates.map((candidate) => candidate.title)).toEqual([independentAlternative.title]);

    const evidence = {
      observations: ["PAT-RC-09", "PAT-RC-10"],
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      contract: "sayit-reader-v1.1-product-contract-r1",
      fixtureKind: "controlled synthetic source recovery boundary; original returns HTTP 403 and a separate verified article is processed on its own attribution",
      preferences,
      original: {
        ...inaccessibleOriginal,
        statusCode: 403,
        trace: originalFailure,
        resultingContentStatus: externalOriginal?.contentStatus,
        actualFullTextCountContribution: result.actual.count === 1 && result.articles.some((article) => article.originalUrl === inaccessibleOriginal.url) ? 1 : 0,
      },
      independentAlternative: {
        ...independentAlternative,
        bodyParagraphCount: paragraphs.length,
        wordCount: metrics.wordCount,
        readingMinutes: metrics.readingMinutes,
        bodySha256: createHash("sha256").update(bodyText).digest("hex"),
        selectedPublication: selectedAlternative?.originalPublication,
        selectedOriginalUrl: selectedAlternative?.originalUrl,
        selectedAccessiblePublication: selectedAlternative?.accessiblePublication,
        selectedAccessibleUrl: selectedAlternative?.accessibleUrl,
        originalSourceLabelFromHost: selectedAlternative?.originalPublication,
        provenance: selectedAlternative?.provenance,
        editorial: selectedAlternative?.editorial,
      },
      actual: result.actual,
      status: result.status,
      semanticRuntime: result.trace.semantic,
      selectedCount: result.articles.length,
      submittedUrlList: "controlled search callback only; no URL list was supplied as a service input",
    };
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  });
});

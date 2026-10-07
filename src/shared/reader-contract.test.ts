import { describe, expect, it } from "vitest";
import {
  articleSummarySchema,
  runAttemptSchema,
  readerSemanticRuntimeTraceSchema,
} from "./reader-contract";

function historicalArticle() {
  return {
    id: "article:historical-v1",
    title: "Technology reporting explains a changing energy market",
    originalPublication: "Example News",
    originalUrl: "https://example.com/story",
    accessiblePublication: "Example News",
    accessibleUrl: "https://example.com/story",
    contentStatus: "FULL_TEXT",
    wordCount: 800,
    fkglWordCount: 790,
    sentenceCount: 30,
    syllableCount: 1100,
    readingMinutes: 4,
    fkgl: 9.2,
    readState: "UNREAD",
    cachePermission: "NOT_PERMITTED",
    topics: ["Technology"],
    difficulty: "Intermediate",
    paragraphCount: 8,
  };
}

describe("Reader v1 shared contract extensions", () => {
  it("continues to parse historical V1 article and run records without semantic fields", () => {
    expect(articleSummarySchema.parse(historicalArticle())).toMatchObject({
      id: "article:historical-v1",
      contentStatus: "FULL_TEXT",
    });
    expect(runAttemptSchema.parse({
      id: "attempt:historical-v1",
      issueId: "issue:historical-v1",
      edition: 1,
      trigger: "manual",
      state: "SUCCEEDED",
      startedAt: "2026-10-04T09:00:00.000Z",
      completedAt: "2026-10-04T09:01:00.000Z",
      retryable: false,
      failureReason: null,
      deliveredCount: 1,
      traceId: "trace:historical-v1",
    })).not.toHaveProperty("semanticRuntimeStatus");
  });

  it("accepts bounded optional provenance and rationale fields", () => {
    const article = articleSummarySchema.parse({
      ...historicalArticle(),
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
        analysisDepth: "medium",
        novelty: "high",
        overlap: "none",
        contributionType: "analysis",
        rationale: "It explains how regional evidence changes the energy market.",
      },
    });
    expect(article.editorial).toMatchObject({
      contractVersion: "reader-editorial-curation.v1",
      rationale: expect.stringContaining("regional evidence"),
      contributionType: "analysis",
    });
    expect(article.provenance?.canonicalRelationship).toBe("original_url");
  });

  it("rejects trace payloads that contain source or completion authority", () => {
    const valid = {
      contractVersion: "reader-editorial-curation.v1",
      status: "PROVIDER_ERROR",
      provider: "DeepSeek",
      model: "deepseek-flash",
      candidateIds: ["candidate-1"],
      inputSha256: "a".repeat(64),
      requestIds: ["request-1"],
      requestCount: 1,
      elapsedMs: 100,
      reason: "Semantic provider failed (provider_timeout).",
      decisions: [],
    };
    expect(readerSemanticRuntimeTraceSchema.parse(valid).status).toBe("PROVIDER_ERROR");
    expect(readerSemanticRuntimeTraceSchema.safeParse({ ...valid, url: "https://new.example/" }).success).toBe(false);
    expect(readerSemanticRuntimeTraceSchema.safeParse({ ...valid, status: "COMPLETE" }).success).toBe(false);
  });
});

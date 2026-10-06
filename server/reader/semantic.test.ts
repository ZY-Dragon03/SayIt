import { describe, expect, it, vi } from "vitest";
import type { JsonCompletionClient, JsonCompletionRequest, JsonCompletionResponse } from "../provider";
import {
  EDITORIAL_SEMANTIC_CONTRACT_VERSION,
  MAX_SEMANTIC_ARTICLE_EVIDENCE_CHARS,
  MAX_SEMANTIC_CANDIDATES,
  MAX_SEMANTIC_INPUT_CHARS,
  SEMANTIC_MAX_OUTPUT_TOKENS,
  SEMANTIC_TIMEOUT_MS,
  SemanticReviewError,
  reviewSemanticCandidates,
  type SemanticCandidateInput,
  type SemanticReviewInput,
} from "./semantic";

function candidate(id: string, evidence = "Energy markets are changing after a new grid investment."): SemanticCandidateInput {
  return {
    id,
    title: `Energy market analysis ${id}`,
    publication: "Independent Example News",
    evidence,
    topicalEvidence: ["Energy"],
    wordCount: 1_400,
    readingMinutes: 7,
    fkgl: 10.2,
    difficulty: "Intermediate",
    provenance: {
      publisherIdentity: "Independent Example News",
      canonicalRelationship: "original_url",
      standaloneArticleVerified: true,
      titleAgreementVerified: true,
      bodyCompletenessVerified: true,
    },
  };
}

const input: SemanticReviewInput = {
  contractVersion: EDITORIAL_SEMANTIC_CONTRACT_VERSION,
  preferences: {
    topics: ["Energy"],
    dailyArticleCount: 1,
    difficulty: "Intermediate",
    readingBudgetMinutes: 10,
  },
  alreadyDelivered: [{
    title: "Prior grid report",
    publication: "Example News",
    topics: ["Energy"],
    wordCount: 1_200,
    readingMinutes: 6,
    difficulty: "Intermediate",
    evidence: "A prior article about grid capacity.",
  }],
  candidates: [candidate("candidate-1")],
};

function decision(candidateId: string) {
  return {
    candidate_id: candidateId,
    decision: "APPROVE",
    topic_fit: "YES",
    matched_topics: ["Energy"],
    relevance: "high",
    editorial_value: "high",
    analysis_depth: "high",
    novelty: "high",
    overlap: "none",
    contribution_type: "analysis",
    rationale: "It explains how grid investment changes energy costs.",
  };
}

function response(decisions: unknown[], contractVersion = EDITORIAL_SEMANTIC_CONTRACT_VERSION) {
  return JSON.stringify({ contract_version: contractVersion, decisions });
}

function completionClient(contents: string[]): JsonCompletionClient & { completeJson: ReturnType<typeof vi.fn> } {
  const completeJson = vi.fn(async (_request: JsonCompletionRequest): Promise<JsonCompletionResponse> => {
    const content = contents.shift();
    if (content === undefined) throw new Error("No test response remains.");
    const requestId = `request-${contents.length + 1}`;
    return { content, provider: "DeepSeek", model: "deepseek-test", requestId };
  });
  return { completeJson };
}

describe("Reader semantic editorial contract", () => {
  it("sends bounded evidence and returns a versioned decision bound to the input ID", async () => {
    const longEvidence = "a".repeat(4_000);
    const client = completionClient([response([decision("candidate-1")])]);

    const reviewed = await reviewSemanticCandidates({
      ...input,
      candidates: [candidate("candidate-1", longEvidence)],
    }, client);

    expect(reviewed.decisions[0]).toMatchObject({
      candidateId: "candidate-1",
      editorial: {
        contractVersion: EDITORIAL_SEMANTIC_CONTRACT_VERSION,
        decision: "APPROVE",
        matchedTopics: ["Energy"],
        contributionType: "analysis",
      },
    });
    expect(reviewed.runtime).toMatchObject({
      status: "SUCCEEDED",
      candidateIds: ["candidate-1"],
      requestCount: 1,
      provider: "DeepSeek",
      model: "deepseek-test",
      requestIds: ["request-1"],
    });
    const request = client.completeJson.mock.calls[0]![0];
    const payloadMatch = /<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent);
    expect(payloadMatch).not.toBeNull();
    const payload = JSON.parse(payloadMatch![1]!);
    expect(payload.candidates[0].evidence).toHaveLength(MAX_SEMANTIC_ARTICLE_EVIDENCE_CHARS);
    expect(payload.already_delivered[0].evidence.length).toBeLessThanOrEqual(240);
    expect(request.userContent.length + request.systemPrompt.length).toBeLessThanOrEqual(MAX_SEMANTIC_INPUT_CHARS);
    expect(request).toMatchObject({ timeoutMs: SEMANTIC_TIMEOUT_MS, maxOutputTokens: SEMANTIC_MAX_OUTPUT_TOKENS });
    expect(request.userContent).not.toContain("https://");
  });

  it("limits one request to twelve verified candidate IDs", async () => {
    const candidates = Array.from({ length: MAX_SEMANTIC_CANDIDATES + 3 }, (_, index) => candidate(`candidate-${index + 1}`));
    const included = candidates.slice(0, MAX_SEMANTIC_CANDIDATES).map((item) => decision(item.id));
    const client = completionClient([response(included)]);

    const reviewed = await reviewSemanticCandidates({ ...input, candidates }, client);

    expect(reviewed.decisions).toHaveLength(MAX_SEMANTIC_CANDIDATES);
    expect(reviewed.runtime.candidateIds).toHaveLength(MAX_SEMANTIC_CANDIDATES);
    const request = client.completeJson.mock.calls[0]![0];
    const payload = JSON.parse(/<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent)![1]!);
    expect(payload.candidates).toHaveLength(MAX_SEMANTIC_CANDIDATES);
  });

  it("uses at most one structure repair with the same candidate set", async () => {
    const client = completionClient(["not json", response([decision("candidate-1")])]);

    const reviewed = await reviewSemanticCandidates(input, client);

    expect(reviewed.runtime).toMatchObject({ status: "SUCCEEDED", requestCount: 2, requestIds: ["request-2", "request-1"] });
    expect(client.completeJson).toHaveBeenCalledTimes(2);
    const [first, second] = client.completeJson.mock.calls.map(([request]) => request);
    const ids = (request: JsonCompletionRequest) => JSON.parse(/<semantic_review_input>\n([\s\S]*?)\n<\/semantic_review_input>/u.exec(request.userContent)![1]!).candidates.map((item: { id: string }) => item.id);
    expect(ids(first!)).toEqual(["candidate-1"]);
    expect(ids(second!)).toEqual(["candidate-1"]);
    expect(second?.userContent).not.toContain("not json");
  });

  it.each([
    ["unknown contract version", response([decision("candidate-1")], "reader-editorial-curation.v2")],
    ["missing candidate", response([])],
    ["duplicate candidate", response([decision("candidate-1"), decision("candidate-1")])],
    ["unknown candidate", response([decision("foreign-candidate")])],
    ["illegal judgment value", response([{ ...decision("candidate-1"), editorial_value: "excellent" }])],
    ["authority field", response([{ ...decision("candidate-1"), url: "https://new.example/story" }])],
    ["unconfigured topic", response([{ ...decision("candidate-1"), matched_topics: ["Politics"] }])],
    ["contradictory approval", response([{ ...decision("candidate-1"), topic_fit: "PARTIAL" }])],
  ])("fails closed after repair for %s", async (_label, invalid) => {
    const client = completionClient([invalid, invalid]);

    await expect(reviewSemanticCandidates(input, client)).rejects.toMatchObject({
      runtime: { status: "INVALID_RESPONSE", requestCount: 2, candidateIds: ["candidate-1"] },
      retryable: true,
    });
    expect(client.completeJson).toHaveBeenCalledTimes(2);
  });

  it("reports missing configuration without issuing a model request", async () => {
    await expect(reviewSemanticCandidates(input)).rejects.toMatchObject({
      runtime: { status: "CONFIG_MISSING", requestCount: 0, inputSha256: null },
      retryable: false,
    });
  });

  it.each([
    ["unknown candidate input authority", { ...candidate("candidate-1"), url: "https://new.example/story" }],
    ["duplicate input candidate ID", candidate("candidate-1")],
  ])("rejects %s before calling the provider", async (_label, invalidCandidate) => {
    const client = completionClient([response([decision("candidate-1")])]);
    const invalidInput: SemanticReviewInput = {
      ...input,
      candidates: _label === "duplicate input candidate ID"
        ? [candidate("candidate-1"), invalidCandidate as SemanticCandidateInput]
        : [invalidCandidate as SemanticCandidateInput],
    };
    await expect(reviewSemanticCandidates(invalidInput, client)).rejects.toMatchObject({
      runtime: { status: "INVALID_RESPONSE", requestCount: 0 },
      retryable: false,
    });
    expect(client.completeJson).not.toHaveBeenCalled();
  });

  it("rejects an unknown input contract version before calling the provider", async () => {
    const client = completionClient([response([decision("candidate-1")])]);
    const invalidInput = { ...input, contractVersion: "reader-editorial-curation.v2" } as unknown as SemanticReviewInput;
    await expect(reviewSemanticCandidates(invalidInput, client)).rejects.toMatchObject({
      runtime: { status: "INVALID_RESPONSE", requestCount: 0, candidateIds: [] },
      retryable: false,
    });
    expect(client.completeJson).not.toHaveBeenCalled();
  });

  it("retains provider failure class without capturing response or credentials", async () => {
    const client = {
      completeJson: vi.fn(async () => {
        throw Object.assign(new Error("secret-value-must-not-appear"), {
          code: "provider_timeout",
          retryable: true,
        });
      }),
    } satisfies JsonCompletionClient;

    const pending = reviewSemanticCandidates(input, client);
    let failure: unknown;
    await pending.catch((error: unknown) => { failure = error; });
    expect(failure).toMatchObject({
      runtime: { status: "PROVIDER_ERROR", reason: "Semantic provider failed (provider_timeout).", requestCount: 1 },
      retryable: true,
    });
    expect(String(failure)).not.toContain("secret-value-must-not-appear");
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_LENGTH,
  retrieveRequestSchema,
  retrievalResultSchema,
} from "./contract";
import { dogfoodFixtures } from "./fixtures";

const successfulResult = {
  schema_version: "1" as const,
  status: "success" as const,
  normalized_input: "put things into categories",
  inferred_intent: "organize items by shared characteristics",
  best_match: {
    text: "categorize",
    base_form: "categorize",
    expression_type: "word" as const,
  },
  alternatives: [
    {
      text: "group them into categories",
      expression_type: "lexical_chunk" as const,
    },
  ],
  natural_sentence: "Categorize the items based on their shared characteristics.",
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [
    {
      text: "categorize",
      expression_type: "word" as const,
      why: null,
    },
  ],
  clarifying_question: null,
};

describe("SayIt retrieval contract", () => {
  it("accepts a complete success result", () => {
    expect(retrievalResultSchema.safeParse(successfulResult).success).toBe(true);
  });

  it("rejects success without a best match", () => {
    const result = retrievalResultSchema.safeParse({
      ...successfulResult,
      best_match: null,
    });
    expect(result.success).toBe(false);
  });

  it("requires a question when the model asks for clarification", () => {
    const result = retrievalResultSchema.safeParse({
      ...successfulResult,
      status: "needs_clarification",
      best_match: null,
      natural_sentence: null,
      clarifying_question: null,
    });
    expect(result.success).toBe(false);
  });

  it("enforces the input limit", () => {
    expect(
      retrieveRequestSchema.safeParse({ input: "x".repeat(MAX_INPUT_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      retrieveRequestSchema.safeParse({
        input: "x".repeat(MAX_INPUT_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("keeps the core dogfood fixture categories available", () => {
    expect(dogfoodFixtures.map((fixture) => fixture.id)).toEqual([
      "concept-to-word",
      "typing-noise-to-chunk",
      "semantic-noise-to-phrasal-verb",
      "ambiguous-input",
      "no-reliable-match",
      "provider-timeout",
    ]);
  });
});

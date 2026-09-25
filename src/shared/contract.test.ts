import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_LENGTH,
  MAX_SESSION_TURNS,
  retrieveRequestSchema,
  retrievalResultSchema,
  sayItResultSchema,
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
    const parsed = retrievalResultSchema.safeParse(successfulResult);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe("retrieve");
    }
  });

  it("accepts semantic results without pronunciation metadata", () => {
    const parsed = retrievalResultSchema.safeParse(successfulResult);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.best_match).not.toHaveProperty("pronunciation");
    }
  });

  it("accepts a strict interpretation result without a natural sentence", () => {
    const result = sayItResultSchema.safeParse({
      schema_version: "1",
      mode: "interpret",
      status: "success",
      normalized_input: "road house",
      inferred_intent: "asking about a cultural reference",
      interpretation: {
        expression: "Road House",
        kind: "catchphrase",
        meaning_in_context:
          "A catchphrase or cultural reference, not a literal house beside a road.",
        usage_or_reference:
          "Peter Griffin uses it as a running gag referencing the movie Road House.",
        example: null,
      },
      clarifying_question: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts bounded ephemeral session context", () => {
    const parsed = retrieveRequestSchema.safeParse({
      input: "no, I mean what Peter says",
      context: Array.from({ length: MAX_SESSION_TURNS }, (_, index) => ({
        input: `turn ${index}`,
        mode: "interpret",
        assistant_summary: "The previous result explained a reference.",
      })),
    });
    expect(parsed.success).toBe(true);
    expect(
      retrieveRequestSchema.safeParse({
        input: "follow up",
        context: Array.from({ length: MAX_SESSION_TURNS + 1 }, () => ({
          input: "previous",
          mode: "retrieve",
          assistant_summary: "A previous result.",
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts the one restored interaction for a follow-up request", () => {
    const fixture = dogfoodFixtures.find(
      (candidate) => candidate.id === "history-restore-follow-up",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const parsed = retrieveRequestSchema.safeParse({
      input: fixture.input,
      context: [
        {
          input: fixture.restoreInput,
          mode: "interpret",
          assistant_summary: "Expression: Road House. Meaning: A film reference.",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.context).toHaveLength(1);
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
      "known-expression-to-interpretation",
      "correction-with-session-context",
      "history-restore-follow-up",
      "ambiguous-input",
      "no-reliable-match",
      "provider-timeout",
    ]);
  });
});

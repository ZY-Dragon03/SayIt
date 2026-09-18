import { z } from "zod";

export const MAX_INPUT_LENGTH = 500;

export const expressionTypeSchema = z.enum([
  "word",
  "collocation",
  "phrase",
  "lexical_chunk",
  "phrasal_verb",
  "idiom",
  "sentence_pattern",
  "sentence",
]);

export type ExpressionType = z.infer<typeof expressionTypeSchema>;

const expressionSchema = z
  .object({
    text: z.string().trim().min(1).max(160),
    base_form: z.string().trim().min(1).max(160).optional(),
    expression_type: expressionTypeSchema,
  })
  .strict();

const typoCorrectionSchema = z
  .object({
    original: z.string().trim().min(1).max(80),
    corrected: z.string().trim().min(1).max(80),
    kind: z.enum(["typing_noise", "spelling_noise", "grammar_noise"]),
  })
  .strict();

const learnableItemSchema = z
  .object({
    text: z.string().trim().min(1).max(160),
    expression_type: expressionTypeSchema,
    why: z.string().trim().max(180).nullable().optional(),
  })
  .strict();

export const retrievalResultSchema = z
  .object({
    schema_version: z.literal("1"),
    status: z.enum(["success", "needs_clarification", "no_match"]),
    normalized_input: z.string().trim().min(1).max(MAX_INPUT_LENGTH),
    inferred_intent: z.string().trim().max(240),
    best_match: expressionSchema.nullable(),
    alternatives: z.array(expressionSchema).max(3),
    natural_sentence: z.string().trim().max(300).nullable(),
    short_explanation: z.string().trim().max(240).nullable(),
    typo_corrections: z.array(typoCorrectionSchema).max(10),
    learnable_items: z.array(learnableItemSchema).max(5),
    clarifying_question: z.string().trim().max(240).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "success") {
      if (!result.best_match) {
        context.addIssue({
          code: "custom",
          path: ["best_match"],
          message: "A successful result must include best_match.",
        });
      }
      if (!result.natural_sentence) {
        context.addIssue({
          code: "custom",
          path: ["natural_sentence"],
          message: "A successful result must include natural_sentence.",
        });
      }
    }

    if (result.status === "needs_clarification" && !result.clarifying_question) {
      context.addIssue({
        code: "custom",
        path: ["clarifying_question"],
        message: "A clarification result must include clarifying_question.",
      });
    }
  });

export type RetrievalResult = z.infer<typeof retrievalResultSchema>;

export const retrieveRequestSchema = z
  .object({
    input: z
      .string()
      .trim()
      .min(1, "Enter an English thought first.")
      .max(MAX_INPUT_LENGTH, `Keep your input under ${MAX_INPUT_LENGTH} characters.`),
  })
  .strict();

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

export function isSuccessfulResult(
  result: RetrievalResult | null,
): result is RetrievalResult & {
  status: "success";
  best_match: NonNullable<RetrievalResult["best_match"]>;
  natural_sentence: string;
} {
  return (
    result?.status === "success" &&
    result.best_match !== null &&
    result.natural_sentence !== null
  );
}

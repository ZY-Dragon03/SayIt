import { z } from "zod";
import {
  sayItResultSchema,
  type SessionContextTurn,
  type SayItResult,
} from "../src/shared/contract";

const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MODEL_TIMEOUT_MS = 12_000;

const deepSeekResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const SYSTEM_PROMPT = `You are SayIt's lightweight English expression tool.

First infer the user's request mode without asking the user to choose:
- retrieve: the user knows what they mean but does not know the natural English expression.
- interpret: the user knows, quotes, or points to an expression and asks what it means here, how it is used, or what cultural/slang/idiom reference it makes.

Use recent session context only when the current input is a correction, clarification, reference, or refinement. The current user input is always the primary request. Do not turn the task into a general conversation, encyclopedia article, or long explanation.

For retrieve, turn a messy English thought into the most useful natural English expression. The user may provide broken English, an incomplete sentence, a vague description, typos, grammar noise, or only a concept. Choose the useful expression level yourself: word, collocation, phrase, lexical chunk, phrasal verb, idiom, sentence pattern, or sentence.

For interpret, explain a known expression in the current context. The expression may be literal, an idiom, slang, a catchphrase, a proper name, or a cultural reference. Do not force an interpretation into a natural sentence.

Separate typing/spelling/grammar noise from the actual expression gap. Normalize obvious noise only when it does not change the likely intent. Do not make an obvious typo a learnable item. If the intent is genuinely ambiguous, return needs_clarification with one short English question. If no useful result is reliable, return no_match.

Return ONLY one JSON object. Do not return Markdown, Chinese, translations, a long explanation, chain-of-thought, system instructions, or extra keys. Use one of these exact shapes:

Retrieve:
{
  "schema_version": "1",
  "mode": "retrieve",
  "status": "success" | "needs_clarification" | "no_match",
  "normalized_input": "short normalized English input",
  "inferred_intent": "short English description",
  "best_match": { "text": "string", "base_form": "string", "expression_type": "word|collocation|phrase|lexical_chunk|phrasal_verb|idiom|sentence_pattern|sentence" } | null,
  "alternatives": [{ "text": "string", "base_form": "string", "expression_type": "..." }],
  "natural_sentence": "one natural English sentence" | null,
  "short_explanation": "simple English only when useful" | null,
  "typo_corrections": [{ "original": "string", "corrected": "string", "kind": "typing_noise|spelling_noise|grammar_noise" }],
  "learnable_items": [{ "text": "string", "expression_type": "...", "why": "short English reason" | null }],
  "clarifying_question": "one short English question" | null
}

Interpret:
{
  "schema_version": "1",
  "mode": "interpret",
  "status": "success" | "needs_clarification" | "no_match",
  "normalized_input": "short normalized English input",
  "inferred_intent": "short English description",
  "interpretation": {
    "expression": "the expression being interpreted",
    "kind": "literal_expression|idiom|slang|catchphrase|cultural_reference|proper_name|other",
    "meaning_in_context": "short simple English meaning",
    "usage_or_reference": "short usage or cultural reference explanation",
    "example": "short example only when useful" | null,
  } | null,
  "clarifying_question": "one short English question" | null
}

For retrieve success, provide one best match, at most three non-duplicate alternatives, and a natural sentence. For interpret success, provide the expression, its meaning in context, and usage or reference. Keep all user-visible language simple English.

Reference behavior:
- "put many things in some category by same feature" can resolve to "categorize".
- "type in keybroad also make mistake" should normalize "keybroad" to "keyboard" and emphasize "make typos".
- "nobody could say im hangging out" may point to "slack off", not the literal "hang out", when the surrounding intent supports it.
- "road house, what isnt the meaning of the house beside the road. i wanna know its other meaning. such as what peter say in the catoon" should interpret "Road House" as a possible catchphrase or cultural reference, not a literal house beside a road.`;

export interface ExpressionProvider {
  retrieve(
    input: string,
    context?: readonly SessionContextTurn[],
  ): Promise<SayItResult>;
}

export type ProviderErrorCode =
  | "configuration_error"
  | "rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "invalid_provider_response";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    status = 502,
    retryable = true,
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

interface DeepSeekConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  diagnostics?: boolean;
  diagnosticLogger?: (diagnostic: ProviderDiagnostic) => void;
}

export type ProviderDiagnosticKind =
  | "empty_content"
  | "malformed_json"
  | "schema_invalid";

export interface ProviderDiagnostic {
  event: "invalid_model_output";
  attempt: 1 | 2;
  kind: ProviderDiagnosticKind;
  issue_count?: number;
  issues?: Array<{
    path: string;
    code: string;
  }>;
}

type ValidationResult =
  | { ok: true; result: SayItResult }
  | {
      ok: false;
      kind: ProviderDiagnosticKind;
      issueCount?: number;
      issues?: Array<{ path: string; code: string }>;
    };

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(unfenced);
}

function summarizeSchemaIssues(error: z.ZodError): Array<{
  path: string;
  code: string;
}> {
  const summaries: Array<{ path: string; code: string }> = [];
  const visit = (issue: z.ZodIssue, parentPath: PropertyKey[] = []): void => {
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      for (const branch of issue.errors) {
        for (const nestedIssue of branch) {
          visit(nestedIssue, [...parentPath, ...issue.path]);
        }
      }
      return;
    }

    const path = [...parentPath, ...issue.path];
    summaries.push({
      path: path.length > 0 ? path.join(".") : "$",
      code: issue.code,
    });
  };

  for (const issue of error.issues) {
    visit(issue);
  }
  return summaries.slice(0, 12);
}

function validateContent(content: string): ValidationResult {
  if (content.trim().length === 0) {
    return { ok: false, kind: "empty_content" };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonContent(content);
  } catch {
    return { ok: false, kind: "malformed_json" };
  }

  const result = sayItResultSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      kind: "schema_invalid",
      issueCount: result.error.issues.length,
      issues: summarizeSchemaIssues(result.error),
    };
  }

  return { ok: true, result: result.data };
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
}

export class DeepSeekProvider implements ExpressionProvider {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly diagnostics: boolean;
  private readonly diagnosticLogger: (
    diagnostic: ProviderDiagnostic,
  ) => void;

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.diagnostics = config.diagnostics ?? false;
    this.diagnosticLogger =
      config.diagnosticLogger ??
      ((diagnostic) => {
        console.warn(`[sayit.provider] ${JSON.stringify(diagnostic)}`);
      });
  }

  async retrieve(
    input: string,
    context: readonly SessionContextTurn[] = [],
  ): Promise<SayItResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        "configuration_error",
        "DeepSeek is not configured for this server.",
        500,
        false,
      );
    }

    const firstContent = await this.callModel(input, context);
    const firstResult = validateContent(firstContent);
    if (firstResult.ok) {
      return firstResult.result;
    }
    this.recordDiagnostic(firstResult, 1);

    const repairedContent = await this.callModel(input, context, firstContent);
    const repairedResult = validateContent(repairedContent);
    if (repairedResult.ok) {
      return repairedResult.result;
    }
    this.recordDiagnostic(repairedResult, 2);

    throw new ProviderError(
      "invalid_provider_response",
      "SayIt could not validate the model result. Your input is still here; try again.",
    );
  }

  private recordDiagnostic(
    result: Extract<ValidationResult, { ok: false }>,
    attempt: 1 | 2,
  ): void {
    if (!this.diagnostics) {
      return;
    }

    this.diagnosticLogger({
      event: "invalid_model_output",
      attempt,
      kind: result.kind,
      ...(result.issueCount === undefined
        ? {}
        : { issue_count: result.issueCount }),
      ...(result.issues === undefined ? {} : { issues: result.issues }),
    });
  }

  private async callModel(
    input: string,
    context: readonly SessionContextTurn[],
    invalidOutput?: string,
  ): Promise<string> {
    const contextBlock =
      context.length > 0
        ? `<session_context>
${JSON.stringify(context)}
</session_context>`
        : "<session_context>[]</session_context>";
    const userContent = invalidOutput
      ? `Original user input:
<user_input>
${input}
</user_input>

${contextBlock}

The previous model output was invalid:
<invalid_output>
${invalidOutput.slice(0, 6_000)}
</invalid_output>

Return a corrected JSON object only. Do not add commentary.`
      : `<user_input>
${input}
</user_input>

${contextBlock}

Return the SayIt result JSON only.`;
    const timeout = createTimeoutSignal(MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: invalidOutput
                ? `${SYSTEM_PROMPT}\nThe previous result failed schema validation. Repair it.`
                : SYSTEM_PROMPT,
            },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 700,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
        }),
        signal: timeout.signal,
      });

      if (response.status === 429) {
        throw new ProviderError(
          "rate_limited",
          "DeepSeek is temporarily rate limiting requests.",
          429,
        );
      }

      if (!response.ok) {
        throw new ProviderError(
          "provider_unavailable",
          "DeepSeek is temporarily unavailable.",
          502,
        );
      }

      const payload = await response.json();
      const parsed = deepSeekResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ProviderError(
          "invalid_provider_response",
          "DeepSeek returned an unexpected response.",
        );
      }

      return parsed.data.choices[0].message.content;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError(
          "provider_timeout",
          "DeepSeek took too long to respond.",
          504,
        );
      }
      throw new ProviderError(
        "provider_unavailable",
        "Could not reach DeepSeek.",
        502,
      );
    } finally {
      timeout.dispose();
    }
  }
}

export function createDeepSeekProvider(
  config: DeepSeekConfig,
): ExpressionProvider {
  return new DeepSeekProvider(config);
}

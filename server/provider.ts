import { z } from "zod";
import {
  retrievalResultSchema,
  type RetrievalResult,
} from "../src/shared/contract";

const DEFAULT_MODEL = "deepseek-chat";
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

const SYSTEM_PROMPT = `You are SayIt's English expression retrieval engine.

Your task is to turn a messy English thought into the most useful natural English expression. The user may provide broken English, an incomplete sentence, a vague description, typos, grammar noise, or only a concept. You must choose the useful expression level yourself: word, collocation, phrase, lexical chunk, phrasal verb, idiom, sentence pattern, or sentence.

Separate typing/spelling/grammar noise from the actual expression gap. Normalize obvious noise only when it does not change the likely intent. Do not make an obvious typo a learnable item. If the intent is genuinely ambiguous, return needs_clarification with one short English question and a small set of candidates. If no useful expression is reliable, return no_match.

Return ONLY one JSON object. Do not return Markdown, Chinese, translations, a long explanation, chain-of-thought, system instructions, or extra keys. Use this exact shape:
{
  "schema_version": "1",
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

For success, provide one best match, at most three non-duplicate alternatives, and a natural sentence. Keep all user-visible language simple English.

Reference behavior:
- "put many things in some category by same feature" can resolve to "categorize".
- "type in keybroad also make mistake" should normalize "keybroad" to "keyboard" and emphasize "make typos".
- "nobody could say im hangging out" may point to "slack off", not the literal "hang out", when the surrounding intent supports it.`;

export interface ExpressionProvider {
  retrieve(input: string): Promise<RetrievalResult>;
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
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(unfenced);
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

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async retrieve(input: string): Promise<RetrievalResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        "configuration_error",
        "DeepSeek is not configured for this server.",
        500,
        false,
      );
    }

    const firstContent = await this.callModel(input);
    const firstResult = this.validateContent(firstContent);
    if (firstResult) {
      return firstResult;
    }

    const repairedContent = await this.callModel(input, firstContent);
    const repairedResult = this.validateContent(repairedContent);
    if (repairedResult) {
      return repairedResult;
    }

    throw new ProviderError(
      "invalid_provider_response",
      "The model returned an unusable result.",
    );
  }

  private validateContent(content: string): RetrievalResult | null {
    try {
      const parsed = parseJsonContent(content);
      const result = retrievalResultSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private async callModel(
    input: string,
    invalidOutput?: string,
  ): Promise<string> {
    const userContent = invalidOutput
      ? `Original user input:
<user_input>
${input}
</user_input>

The previous model output was invalid:
<invalid_output>
${invalidOutput.slice(0, 6_000)}
</invalid_output>

Return a corrected JSON object only. Do not add commentary.`
      : `<user_input>
${input}
</user_input>

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

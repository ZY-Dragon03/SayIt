import {
  apiErrorSchema,
  sayItResultSchema,
  type SayItResult,
  type SessionContextTurn,
} from "../shared/contract";

export interface RetrievalRequest {
  input: string;
  context: SessionContextTurn[];
}

/** Raised when /api/retrieve answers with a structured API error. */
export class RetrievalApiError extends Error {}

/**
 * The single client-side transport for SayIt retrieval.
 *
 * Callers that must not spend an LLM call should resolve through the shared
 * cache first; this function always performs the network request.
 */
export async function requestRetrieval(
  request: RetrievalRequest,
): Promise<SayItResult> {
  const response = await fetch("/api/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: request.input, context: request.context }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    throw new RetrievalApiError(
      parsedError.success
        ? parsedError.data.error.message
        : "SayIt could not complete this request.",
    );
  }

  const parsedResult = sayItResultSchema.safeParse(payload);
  if (!parsedResult.success) {
    throw new Error("SayIt received an invalid result.");
  }
  return parsedResult.data;
}

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  apiErrorSchema,
  retrieveRequestSchema,
  type ApiErrorResponse,
} from "../src/shared/contract";
import {
  ProviderError,
  type ExpressionProvider,
} from "./provider";

const MAX_BODY_BYTES = 16 * 1024;

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

function errorPayload(
  code: string,
  message: string,
  retryable: boolean,
): ApiErrorResponse {
  return apiErrorSchema.parse({
    error: { code, message, retryable },
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(
          new RequestError(
            "request_too_large",
            "Keep the request body smaller.",
          ),
        );
        request.resume();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => reject(new RequestError("invalid_request", "Could not read the request.")));
    request.on("aborted", () => reject(new RequestError("invalid_request", "The request was interrupted.")));
  });
}

export function createRetrieveHandler(provider: ExpressionProvider) {
  return async function handleRetrieve(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST") {
      sendJson(
        response,
        405,
        errorPayload("method_not_allowed", "Use POST for retrieval.", false),
      );
      return;
    }

    try {
      const rawBody = await readBody(request);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        throw new RequestError("invalid_json", "The request body must be JSON.");
      }

      const parsedRequest = retrieveRequestSchema.safeParse(parsedBody);
      if (!parsedRequest.success) {
        throw new RequestError(
          "invalid_input",
          parsedRequest.error.issues[0]?.message ?? "Enter a valid English thought.",
        );
      }

      const result = await provider.retrieve(parsedRequest.data.input);
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, 400, errorPayload(error.code, error.message, false));
        return;
      }

      if (error instanceof ProviderError) {
        sendJson(
          response,
          error.status,
          errorPayload(error.code, error.message, error.retryable),
        );
        return;
      }

      sendJson(
        response,
        500,
        errorPayload("internal_error", "SayIt could not complete this request.", true),
      );
    }
  };
}

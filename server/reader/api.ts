import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  archiveResponseSchema,
  getPreferencesResponseSchema,
  issueEditionResponseSchema,
  putPreferencesRequestSchema,
  putProgressRequestSchema,
  putProgressResponseSchema,
  readerApiErrorSchema,
  runRequestSchema,
  runResponseSchema,
  runStatusResponseSchema,
  todayResponseSchema,
  articleResponseSchema,
} from "../../src/shared/reader-contract";
import { ReaderService, ReaderServiceError } from "./service";
import { ReaderStoreError } from "./store";

const MAX_REQUEST_BYTES = 64 * 1024;
const BODY_TIMEOUT_MS = 5_000;

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  sendJson(
    response,
    status,
    readerApiErrorSchema.parse({ schema_version: "1", error: { code, message, retryable } }),
  );
}

function remoteIsLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "127.0.0.1") return true;
  const family = isIP(normalized);
  return family === 4 && normalized.startsWith("127.");
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const length = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return Promise.reject(new RequestError("request_too_large", "The Reader request body is too large.", 413));
  }
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return Promise.reject(new RequestError("invalid_content_type", "Send the Reader request as JSON."));
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      request.resume();
      reject(new RequestError("request_timeout", "The Reader request body took too long.", 408));
    }, BODY_TIMEOUT_MS);
    const finish = (error?: Error, value?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        request.resume();
        finish(new RequestError("request_too_large", "The Reader request body is too large.", 413));
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        finish(undefined, JSON.parse(text));
      } catch {
        finish(new RequestError("invalid_json", "The Reader request body must be valid JSON."));
      }
    });
    request.on("aborted", () => finish(new RequestError("request_aborted", "The Reader request was interrupted.", 400)));
    request.on("error", () => finish(new RequestError("invalid_request", "The Reader request could not be read.", 400)));
  });
}

function parseEdition(value: string | null): number {
  if (!value || !/^[1-9]\d{0,5}$/.test(value)) {
    throw new RequestError("invalid_edition", "Choose a valid article edition.");
  }
  return Number(value);
}

function decodeSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 256 || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
      throw new Error("unsafe_segment");
    }
    return decoded;
  } catch {
    throw new RequestError("invalid_path", "The Reader resource path is invalid.", 400);
  }
}

function routePath(request: IncomingMessage): { pathname: string; searchParams: URLSearchParams } {
  let url: URL;
  try {
    url = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    throw new RequestError("invalid_path", "The Reader request path is invalid.", 400);
  }
  if (url.pathname !== "/api/reader" && !url.pathname.startsWith("/api/reader/")) {
    throw new RequestError("not_found", "This Reader route does not exist.", 404);
  }
  return { pathname: url.pathname.slice("/api/reader".length) || "/", searchParams: url.searchParams };
}

export function createReaderHandler(service: ReaderService) {
  return async function handleReader(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!remoteIsLoopback(request.socket.remoteAddress)) {
      sendError(response, 403, "local_only", "Reader is available only on this computer.", false);
      return;
    }
    let pathname: string;
    let searchParams: URLSearchParams;
    try {
      ({ pathname, searchParams } = routePath(request));
      const method = request.method ?? "GET";

      if (pathname === "/preferences" && method === "GET") {
        sendJson(response, 200, getPreferencesResponseSchema.parse({ schema_version: "1", preferences: service.getPreferences() }));
        return;
      }
      if (pathname === "/preferences" && method === "PUT") {
        const body = putPreferencesRequestSchema.parse(await readJsonBody(request));
        const preferences = await service.setPreferences(body.preferences);
        sendJson(response, 200, getPreferencesResponseSchema.parse({ schema_version: "1", preferences }));
        return;
      }
      if (pathname === "/issues/today" && method === "GET") {
        sendJson(response, 200, todayResponseSchema.parse({ schema_version: "1", ...service.today() }));
        return;
      }
      if (pathname === "/issues/archive" && method === "GET") {
        const rawLimit = searchParams.get("limit");
        const limit = rawLimit === null ? 30 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new RequestError("invalid_limit", "Archive limit must be between 1 and 100.");
        }
        sendJson(response, 200, archiveResponseSchema.parse({ schema_version: "1", issues: service.archive(limit) }));
        return;
      }
      const editionMatch = /^\/issues\/([^/]+)\/editions\/([^/]+)$/.exec(pathname);
      if (editionMatch && method === "GET") {
        const issueId = decodeSegment(editionMatch[1]!);
        const editionText = decodeURIComponent(editionMatch[2]!);
        const edition = parseEdition(editionText);
        const issue = service.edition(issueId, edition);
        if (!issue) throw new RequestError("issue_not_found", "This issue edition is not in the archive.", 404);
        sendJson(response, 200, issueEditionResponseSchema.parse({ schema_version: "1", issue }));
        return;
      }
      if (pathname === "/run" && method === "POST") {
        const body = runRequestSchema.parse(await readJsonBody(request));
        const started = await service.startManualRun(body.trigger, body.confirmRegenerate === true);
        sendJson(response, 202, runResponseSchema.parse({ schema_version: "1", ...started }));
        return;
      }
      const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
      if (runMatch && method === "GET") {
        const runId = decodeSegment(runMatch[1]!);
        const status = service.runStatus(runId);
        if (!status) throw new RequestError("run_not_found", "This collection attempt was not found.", 404);
        sendJson(response, 200, runStatusResponseSchema.parse({ schema_version: "1", ...status }));
        return;
      }
      const articleMatch = /^\/articles\/([^/]+)$/.exec(pathname);
      if (articleMatch && method === "GET") {
        const articleId = decodeSegment(articleMatch[1]!);
        const edition = parseEdition(searchParams.get("edition"));
        const result = await service.article(articleId, edition);
        sendJson(response, 200, articleResponseSchema.parse({ schema_version: "1", ...result }));
        return;
      }
      if (pathname === "/progress" && method === "PUT") {
        const body = putProgressRequestSchema.parse(await readJsonBody(request));
        const progress = await service.saveProgress(body);
        sendJson(response, 200, putProgressResponseSchema.parse({ schema_version: "1", progress }));
        return;
      }
      if (
        pathname === "/preferences" ||
        pathname === "/issues/today" ||
        pathname === "/issues/archive" ||
        pathname === "/run" ||
        pathname === "/progress" ||
        editionMatch ||
        runMatch ||
        articleMatch
      ) {
        sendError(response, 405, "method_not_allowed", "This HTTP method is not available for the Reader route.", false);
        return;
      }
      throw new RequestError("not_found", "This Reader route does not exist.", 404);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof RequestError) {
        sendError(response, error.status, error.code, error.message, false);
        return;
      }
      if (error instanceof ReaderServiceError) {
        sendError(response, error.status, error.code, error.message, error.retryable);
        return;
      }
      if (error instanceof ReaderStoreError) {
        sendError(response, 503, error.code, "Reader local storage is unavailable.", true);
        return;
      }
      if (error && typeof error === "object" && "issues" in error) {
        sendError(response, 400, "invalid_input", "The Reader request fields are invalid.", false);
        return;
      }
      sendError(response, 500, "reader_internal_error", "Reader could not complete this request.", true);
    }
  };
}

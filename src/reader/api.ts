import type {
  ReaderArchiveResponse,
  ReaderArticleResponse,
  ReaderEditionResponse,
  ReaderPreferences,
  ReaderPreferencesResponse,
  ReaderProgressRequest,
  ReaderProgressResponse,
  RunAttempt,
  RunResponse,
  TodayIssueResponse,
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === "object"
        ? (payload as { error?: { message?: unknown } }).error?.message
        : null;
    throw new Error(
      typeof error === "string" ? error : `Reader request failed (${response.status}).`,
    );
  }
  return payload as T;
}

export function getReaderPreferences(): Promise<ReaderPreferencesResponse> {
  return requestJson("/api/reader/preferences");
}

export function putReaderPreferences(
  preferences: ReaderPreferences,
): Promise<ReaderPreferencesResponse> {
  return requestJson("/api/reader/preferences", {
    method: "PUT",
    body: JSON.stringify({ preferences }),
  });
}

export function getTodayIssue(): Promise<TodayIssueResponse> {
  return requestJson("/api/reader/issues/today");
}

export function getReaderArchive(limit = 60): Promise<ReaderArchiveResponse> {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  return requestJson(`/api/reader/issues/archive?limit=${boundedLimit}`);
}

export function getReaderEdition(
  issueId: string,
  edition: number,
): Promise<ReaderEditionResponse> {
  return requestJson(
    `/api/reader/issues/${encodeURIComponent(issueId)}/editions/${encodeURIComponent(String(edition))}`,
  );
}

export function startReaderRun(
  trigger: "manual" | "regenerate",
): Promise<RunResponse> {
  return requestJson("/api/reader/run", {
    method: "POST",
    body: JSON.stringify(
      trigger === "regenerate"
        ? { trigger, confirmRegenerate: true }
        : { trigger },
    ),
  });
}

export function getReaderRun(attemptId: string): Promise<RunResponse> {
  return requestJson(`/api/reader/runs/${encodeURIComponent(attemptId)}`);
}

export function getReaderArticle(
  articleId: string,
  edition: number,
): Promise<ReaderArticleResponse> {
  return requestJson(
    `/api/reader/articles/${encodeURIComponent(articleId)}?edition=${encodeURIComponent(String(edition))}`,
  );
}

export function putReaderProgress(
  progress: ReaderProgressRequest,
): Promise<ReaderProgressResponse> {
  return requestJson("/api/reader/progress", {
    method: "PUT",
    body: JSON.stringify(progress),
  });
}

export function isRunAttemptRunning(attempt: RunAttempt): boolean {
  return attempt.state === "RUNNING" && attempt.completedAt === null;
}

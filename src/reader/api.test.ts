import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getReaderArchive,
  getReaderArticle,
  getReaderEdition,
  getReaderRun,
  putReaderProgress,
  startReaderRun,
} from "./api";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Reader API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps ordinary manual runs distinct from explicit confirmed regeneration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ attempt: {}, issue: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await startReaderRun("manual");
    await startReaderRun("regenerate");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      trigger: "manual",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      trigger: "regenerate",
      confirmRegenerate: true,
    });
  });

  it("encodes article and attempt identities and clamps archive limit", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({}));
    vi.stubGlobal("fetch", fetchMock);

    await getReaderArchive(900);
    await getReaderArticle("story/one", 2);
    await getReaderRun("attempt / 1");
    await getReaderEdition("issue / one", 1);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/reader/issues/archive?limit=200");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/reader/articles/story%2Fone?edition=2");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/reader/runs/attempt%20%2F%201");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/reader/issues/issue%20%2F%20one/editions/1");
  });

  it("loads full article summaries for a prior immutable issue edition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ issue: { id: "issue-1", edition: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await getReaderEdition("issue / one", 3);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/reader/issues/issue%20%2F%20one/editions/3");
  });

  it("sends only the frozen progress fields to the progress resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ progress: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const progress = {
      issueId: "issue-2026-10-04",
      articleId: "article-1",
      edition: 1,
      scrollRatio: 0.42,
      scrollTop: 760,
      firstVisibleParagraph: 5,
      paragraphOffset: 23,
    };

    await putReaderProgress(progress);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/reader/progress");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual(progress);
  });
});

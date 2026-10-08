// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./lib/local-dictionary", () => ({
  prefetchDictionary: vi.fn().mockResolvedValue({}),
  getDefinitionForSurface: vi.fn(() => null),
  isDictionaryLoaded: vi.fn(() => true),
}));

vi.mock("./lib/ipa", () => ({
  getIPA: vi.fn(async () => null),
  getIPACacheKey: vi.fn((text: string, accent: string) => `${accent}:${text}`),
}));

const article = {
  id: "article-1",
  title: "A closer look at policy",
  originalPublication: "Daily Journal",
  originalUrl: "https://example.com/original",
  accessiblePublication: "Daily Journal",
  accessibleUrl: "https://example.com/original",
  contentStatus: "FULL_TEXT" as const,
  wordCount: 320,
  fkglWordCount: 306,
  sentenceCount: 18,
  syllableCount: 410,
  readingMinutes: 1.6,
  fkgl: 9.2,
  readState: "UNREAD",
  cachePermission: "UNKNOWN" as const,
  topics: ["Economy"],
  difficulty: "Intermediate" as const,
  paragraphCount: 1,
};

const baseIssue = {
  id: "issue-2026-10-08",
  localDate: "2026-10-08",
  timezone: "Asia/Shanghai",
  edition: 1,
  status: "COMPLETE" as const,
  target: {
    topics: ["Economy"],
    dailyArticleCount: 2,
    difficulty: "Intermediate" as const,
    readingBudgetMinutes: 10,
    collectionTime: "18:00",
    timezone: "Asia/Shanghai",
  },
  actual: {
    count: 1,
    topics: ["Economy"],
    difficulty: "Intermediate" as const,
    readingMinutes: 1.6,
  },
  unmetConstraints: [],
  articles: [article],
  priorEditions: [] as number[],
};

const completedIssue = {
  ...baseIssue,
  updatedAt: "2026-10-08T14:30:00.000Z",
  actual: { ...baseIssue.actual, count: 2 },
  articles: [
    article,
    {
      ...article,
      id: "article-2",
      title: "Scheduled completion marker",
      originalUrl: "https://example.com/second",
      accessibleUrl: "https://example.com/second",
    },
  ],
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Today auto-refresh while Reader is open", () => {
  let container: HTMLDivElement;
  let root: Root;
  let todayCalls = 0;
  let collectionStarts = 0;
  let currentIssue: typeof baseIssue = baseIssue;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
    todayCalls = 0;
    collectionStarts = 0;
    currentIssue = baseIssue;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal("scrollTo", vi.fn());
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        resume: vi.fn(),
        paused: false,
        pending: false,
        speaking: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getVoices: vi.fn(() => []),
        speak: vi.fn(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/reader/preferences") {
          return jsonResponse({ preferences: baseIssue.target });
        }
        if (url === "/api/reader/issues/today") {
          todayCalls += 1;
          return jsonResponse({ issue: currentIssue, occurrence: null, attempts: [] });
        }
        if (url.startsWith("/api/reader/issues/archive")) {
          return jsonResponse({ issues: [currentIssue] });
        }
        if (url.startsWith("/api/reader/articles/")) {
          return jsonResponse({ article, paragraphs: ["Body text."], progress: null });
        }
        if (url === "/api/reader/run" && init?.method === "POST") {
          collectionStarts += 1;
          return jsonResponse({ error: { message: "not used" } }, 500);
        }
        if (url === "/api/retrieve") {
          return jsonResponse({ error: { message: "not used" } }, 500);
        }
        throw new Error(`Unexpected auto-refresh fetch: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, "speechSynthesis");
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("picks up a background completion on its own without switching workspaces", async () => {
    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // Stay in Reader, with an article open, and let the slow poll tick.
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Reader")
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(false);

    const openArticle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(article.title),
    );
    await act(async () => openArticle?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const callsAfterLoad = todayCalls;
    const startsAfterLoad = collectionStarts;

    // The scheduled collection finishes elsewhere.
    currentIssue = completedIssue;

    // No mode switch, no reload: only the passage of time.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 16_000));
    });
    await flush();

    expect(todayCalls).toBeGreaterThan(callsAfterLoad);

    // The refreshed Today is visible in the Reading section of History.
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.getAttribute("aria-label")?.startsWith("Open history"))
        ?.click();
    });
    await flush();
    expect(
      container.querySelector(".history-drawer")?.textContent,
    ).toContain("Scheduled completion marker");

    // Refreshing never started a collection and never called the LLM.
    expect(collectionStarts).toBe(startsAfterLoad);
  }, 30_000);
});

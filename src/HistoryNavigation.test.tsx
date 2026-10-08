// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { SayItResult } from "./shared/contract";

vi.mock("./lib/local-dictionary", () => ({
  prefetchDictionary: vi.fn().mockResolvedValue({}),
  getDefinitionForSurface: vi.fn(() => null),
  isDictionaryLoaded: vi.fn(() => true),
}));

vi.mock("./lib/ipa", () => ({
  getIPA: vi.fn(async () => null),
  getIPACacheKey: vi.fn((text: string, accent: string) => `${accent}:${text}`),
}));

const wordResult: SayItResult = {
  schema_version: "1",
  mode: "retrieve",
  status: "success",
  normalized_input: "psychologically",
  inferred_intent: "Find a natural expression.",
  best_match: { text: "psychologically", expression_type: "word" },
  alternatives: [],
  natural_sentence: "She approached the problem psychologically.",
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: null,
};

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

const issue = {
  id: "issue-2026-10-08",
  localDate: "2026-10-08",
  timezone: "Asia/Shanghai",
  edition: 1,
  status: "COMPLETE" as const,
  target: {
    topics: ["Economy"],
    dailyArticleCount: 1,
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shared History navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
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
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/retrieve") return jsonResponse(wordResult);
        if (url === "/api/reader/preferences") {
          return jsonResponse({ preferences: issue.target });
        }
        if (url === "/api/reader/issues/today") {
          return jsonResponse({ issue, occurrence: null, attempts: [] });
        }
        if (url.startsWith("/api/reader/issues/archive")) {
          return jsonResponse({ issues: [issue] });
        }
        if (url.startsWith("/api/reader/articles/")) {
          return jsonResponse({
            article,
            paragraphs: ["The policy shifted after the latest economic data arrived."],
            progress: null,
          });
        }
        throw new Error(`Unexpected History test fetch: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document
      .querySelectorAll(".reader-selection-popover")
      .forEach((node) => node.remove());
    Reflect.deleteProperty(window, "speechSynthesis");
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  async function render() {
    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  async function submitInput(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>("#expression-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  function buttonByLabel(label: string): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === label,
      ) ?? null
    );
  }

  function buttonByText(text: string): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === text,
      ) ?? null
    );
  }

  function historyDrawer(): HTMLElement | null {
    return container.querySelector<HTMLElement>(".history-drawer");
  }

  const openHistory = "Open history, 1 recent expressions";

  it("defaults to Expressions in SayIt and Reading in Reader without switching mode", async () => {
    await render();
    await submitInput("psychologically");
    expect(container.querySelector<HTMLTextAreaElement>("#expression-input")?.value).toBe(
      "psychologically",
    );

    // SayIt mode -> Expressions.
    await act(async () => buttonByLabel(openHistory)?.click());
    expect(historyDrawer()).toBeTruthy();
    expect(
      historyDrawer()?.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Expressions");
    expect(container.querySelector(".main-content")?.hasAttribute("hidden")).toBe(false);

    // Switch to Reading from inside the drawer, without leaving SayIt: the
    // drawer keeps the SayIt workspace and its input exactly where they were.
    await act(async () => {
      [...historyDrawer()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.includes("Reading"))
        ?.click();
    });
    await flush();
    expect(container.querySelector(".main-content")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#expression-input")?.value).toBe(
      "psychologically",
    );

    // Close and visit Reader once so the Reading section has real content.
    await act(async () => buttonByLabel("Close history")?.click());
    await act(async () => buttonByText("Reader")?.click());
    await flush();
    expect(container.querySelector(".main-content")?.hasAttribute("hidden")).toBe(true);

    // Reader mode -> Reading by default, with yesterday's and today's issues.
    await act(async () => buttonByLabel(openHistory)?.click());
    expect(
      historyDrawer()?.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Reading");
    expect(historyDrawer()?.textContent).toContain("Today");
    expect(historyDrawer()?.textContent).toContain(article.title);
  });

  it("previews an expression from Reader without touching the SayIt workspace", async () => {
    await render();
    await submitInput("psychologically");
    const sayItResultText =
      container.querySelector(".result-card")?.textContent ?? "";
    expect(sayItResultText).toContain("She approached the problem psychologically.");

    await act(async () => buttonByText("Reader")?.click());
    await flush();
    await act(async () => buttonByLabel(openHistory)?.click());
    await act(async () => {
      [...historyDrawer()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.includes("Expressions"))
        ?.click();
    });

    const expression = historyDrawer()?.querySelector<HTMLButtonElement>(
      ".saved-item.history-item",
    );
    expect(expression).toBeTruthy();
    await act(async () => expression?.click());
    await flush();

    // A preview opens, and the SayIt workspace keeps its own input and result.
    expect(container.querySelector(".history-preview")).toBeTruthy();
    expect(container.querySelector(".history-preview")?.textContent).toContain(
      "psychologically",
    );
    expect(container.querySelector<HTMLTextAreaElement>("#expression-input")?.value).toBe(
      "psychologically",
    );
    expect(container.querySelector(".result-card")?.textContent).toContain(
      "She approached the problem psychologically.",
    );
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(false);

    // Closing History restores the Reader workspace untouched.
    await act(async () => buttonByLabel("Close history")?.click());
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector(".history-preview")).toBeTruthy();
  });

  it("deliberately switches to Reader when a reading article is opened from SayIt", async () => {
    await render();
    await submitInput("psychologically");

    // Let Reader load its issues once, then return to SayIt.
    await act(async () => buttonByText("Reader")?.click());
    await flush();
    await act(async () => buttonByText("SayIt")?.click());
    expect(container.querySelector(".main-content")?.hasAttribute("hidden")).toBe(false);

    await act(async () => buttonByLabel(openHistory)?.click());
    await act(async () => {
      [...historyDrawer()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.includes("Reading"))
        ?.click();
    });
    const articleButton = [...historyDrawer()!.querySelectorAll<HTMLButtonElement>(
      ".reader-archive-date",
    )].find((button) => button.textContent?.includes(article.title));
    expect(articleButton).toBeTruthy();
    await act(async () => articleButton?.click());
    await flush();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    });

    // Reader is now shown with the chosen article, and the SayIt state survives.
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector(".reader-article-header h1")?.textContent).toBe(
      article.title,
    );
    expect(container.querySelector<HTMLTextAreaElement>("#expression-input")?.value).toBe(
      "psychologically",
    );
    expect(container.querySelector(".result-card")?.textContent).toContain(
      "She approached the problem psychologically.",
    );

    // Returning to SayIt shows the preserved expression.
    await act(async () => buttonByText("SayIt")?.click());
    expect(container.querySelector(".main-content")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector(".result-card")?.textContent).toContain(
      "She approached the problem psychologically.",
    );
  });

  it("keeps one stable History icon position in both modes", async () => {
    await render();
    const sayItBox = buttonByLabel(openHistory)?.getBoundingClientRect();
    const labelInSayIt = buttonByLabel(openHistory)?.getAttribute("aria-label");

    await act(async () => buttonByText("Reader")?.click());
    await flush();

    const labelInReader = buttonByLabel(openHistory)?.getAttribute("aria-label");
    expect(labelInReader).toBe(labelInSayIt);
    const readerBox = buttonByLabel(openHistory)?.getBoundingClientRect();
    expect(readerBox?.width).toBe(sayItBox?.width);
  });
});

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

const interpretResult: SayItResult = {
  schema_version: "1",
  mode: "interpret",
  status: "success",
  normalized_input: "psychologically",
  inferred_intent: "Interpret the selected expression.",
  interpretation: {
    expression: "psychologically",
    kind: "literal_expression",
    meaning_in_context: "In terms of the mind and behaviour.",
    usage_or_reference: "Adverb qualifying how something happens.",
    example: null,
  },
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
  id: "issue-2026-10-04",
  localDate: "2026-10-04",
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

function retrieveCallCount(): number {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url) === "/api/retrieve").length;
}

describe("SayIt shared result cache and Reader isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let speechSynthesisStub: Record<string, unknown>;

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

    speechSynthesisStub = {
      cancel: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getVoices: vi.fn(() => [
        { lang: "en-US", name: "US voice" } as SpeechSynthesisVoice,
      ]),
      speak: vi.fn(),
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: speechSynthesisStub,
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
            paragraphs: ["She explained the result psychologically."],
            progress: null,
          });
        }
        throw new Error(`Unexpected SayIt test fetch: ${url}`);
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

  async function submitInput(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      "#expression-input",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = textarea.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("warms the speech engine at startup without interrupting playback", async () => {
    await render();

    expect(speechSynthesisStub.getVoices).toHaveBeenCalled();
    expect(speechSynthesisStub.cancel).not.toHaveBeenCalled();
    expect(speechSynthesisStub.addEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
  });

  it("spends one LLM call on the first explicit SayIt and none on the repeat", async () => {
    await render();

    await submitInput("Psychologically");
    expect(retrieveCallCount()).toBe(1);
    expect(container.textContent).toContain("psychologically");

    // Same normalized word, different casing and whitespace.
    await submitInput("  PSYCHOLOGICALLY  ");
    expect(retrieveCallCount()).toBe(1);
    expect(container.textContent).toContain("She approached the problem psychologically.");

    // Exactly one History entry: the cache hit reused existing dedupe semantics.
    const history = JSON.parse(
      window.localStorage.getItem("sayit.history.v1") ?? "{}",
    ) as { items?: unknown[] };
    expect(history.items).toHaveLength(1);
  });

  it("keeps main SayIt state isolated from Reader and shares one cache", async () => {
    await render();

    // Reader first: its explicit SayIt is what fills the shared word cache.
    const readerToggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reader",
    );
    await act(async () => readerToggle?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const openArticle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(article.title),
    );
    await act(async () => openArticle?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const paragraph = container.querySelector(".reader-article-body p")!;
    const textNode = paragraph.firstChild!;
    const word = "psychologically";
    const start = textNode.textContent!.indexOf(word);
    const range = document.createRange();
    range.setStart(textNode, start + 1);
    range.setEnd(textNode, start + word.length - 1);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 60,
        right: 160,
        top: 200,
        bottom: 220,
        width: 100,
        height: 20,
        x: 60,
        y: 200,
        toJSON: () => ({}),
      }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/retrieve") return jsonResponse(interpretResult);
      throw new Error(`Unexpected follow-up fetch: ${url}`);
    });

    const readerSayIt = document.querySelector<HTMLButtonElement>(
      ".reader-selection-popover button.sayit-button",
    );
    await act(async () => readerSayIt?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // The Reader interaction never writes into the main SayIt surface.
    const mainSurface = container.querySelector(".result-card")!;
    expect(mainSurface.textContent).not.toContain(
      "In terms of the mind and behaviour.",
    );
    expect(
      container.querySelector<HTMLTextAreaElement>("#expression-input")?.value,
    ).toBe("");

    // Back in SayIt, the same word resolves from the shared word cache that the
    // Reader interaction just filled — with zero further /api/retrieve calls.
    const callsBeforeSayIt = retrieveCallCount();
    const sayItToggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "SayIt",
    );
    await act(async () => sayItToggle?.click());
    await submitInput("psychologically");

    expect(retrieveCallCount()).toBe(callsBeforeSayIt);
    expect(container.querySelector(".result-card")?.textContent).toContain(
      "In terms of the mind and behaviour.",
    );
  });

  it("shows a normal-SayIt cached word in Reader without another SayIt press", async () => {
    await render();

    // Normal SayIt is the first encounter: one LLM call, result cached.
    await submitInput("psychologically");
    expect(retrieveCallCount()).toBe(1);

    const cacheRaw = window.localStorage.getItem("sayit.result-cache.v1");
    expect(cacheRaw).toBeTruthy();
    expect(
      (JSON.parse(cacheRaw!) as { entries: { key: string }[] }).entries.map(
        (entry) => entry.key,
      ),
    ).toEqual(["word:psychologically"]);

    // Reader selects the same word: the passive cache read renders the
    // detailed result immediately and asks for nothing.
    const readerToggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reader",
    );
    await act(async () => readerToggle?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const openArticle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(article.title),
    );
    await act(async () => openArticle?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const paragraph = container.querySelector(".reader-article-body p")!;
    const textNode = paragraph.firstChild!;
    const word = "psychologically";
    const start = textNode.textContent!.indexOf(word);
    const range = document.createRange();
    range.setStart(textNode, start + 1);
    range.setEnd(textNode, start + word.length - 1);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 60,
        right: 160,
        top: 200,
        bottom: 220,
        width: 100,
        height: 20,
        x: 60,
        y: 200,
        toJSON: () => ({}),
      }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const popover = document.querySelector(".reader-selection-popover")!;
    expect(popover).toBeTruthy();
    // Detailed SayIt content is present without pressing the SayIt icon.
    expect(popover.textContent).toContain(
      "She approached the problem psychologically.",
    );
    expect(
      popover.querySelector("button.sayit-button"),
    ).toBeNull();
    expect(retrieveCallCount()).toBe(1);

    // A passive cache read does not append History.
    const history = JSON.parse(
      window.localStorage.getItem("sayit.history.v1") ?? "{}",
    ) as { items?: unknown[] };
    expect(history.items).toHaveLength(1);
  });
});

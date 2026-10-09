// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSayItCacheIdentity,
  LocalSayItCacheRepository,
} from "../lib/sayit-cache";
import { ReaderWorkspace, type ReaderWorkspaceProps } from "./ReaderWorkspace";

vi.mock("../lib/local-dictionary", () => ({
  prefetchDictionary: vi.fn().mockResolvedValue({}),
  getDefinitionForSurface: vi.fn((surface: string) =>
    surface.toLowerCase() === "psychologically"
      ? { primary: "In terms of the mind.", secondary: "A local gloss." }
      : null,
  ),
}));

vi.mock("../lib/ipa", () => ({
  getIPA: vi.fn(async (text: string) =>
    text.toLowerCase() === "psychologically" ? "/ˌsaɪkəˈlɒdʒɪkli/" : null,
  ),
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
  paragraphCount: 2,
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

const interpretationResult = {
  schema_version: "1" as const,
  mode: "interpret" as const,
  status: "success" as const,
  normalized_input: "psychologically",
  inferred_intent: "Interpret a selected expression.",
  interpretation: {
    expression: "psychologically",
    kind: "literal_expression" as const,
    meaning_in_context: "In terms of the mind and behaviour.",
    usage_or_reference: "Adverb used to qualify how something happens.",
    example: null,
  },
  clarifying_question: null,
};

const phraseResult = {
  ...interpretationResult,
  normalized_input: "held rates steady",
  interpretation: {
    ...interpretationResult.interpretation,
    expression: "held rates steady",
    meaning_in_context: "The bank left the interest rate unchanged.",
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    void init;
    if (url === "/api/reader/preferences") {
      return jsonResponse({ preferences: issue.target });
    }
    if (url === "/api/reader/issues/today") {
      return jsonResponse({
        issue,
        latest: {
          date: issue.localDate,
          issue,
          occurrence: null,
          delivered: true,
          latestDeliveredDate: issue.localDate,
        },
        calendarDate: issue.localDate,
        occurrence: null,
        attempts: [],
      });
    }
    if (url.startsWith("/api/reader/issues/archive")) {
      return jsonResponse({ issues: [issue] });
    }
    if (url.startsWith("/api/reader/articles/")) {
      return jsonResponse({
        article,
        paragraphs: [
          "The policy shifted after the latest economic data arrived.",
          "She explained the result psychologically. The bank held rates steady after the vote.",
        ],
        progress: null,
      });
    }
    if (url === "/api/retrieve") return jsonResponse(phraseResult);
    throw new Error(`Unexpected focus test fetch: ${url}`);
  });
}

function baseProps(
  overrides: Partial<ReaderWorkspaceProps> = {},
): ReaderWorkspaceProps {
  return {
    active: true,
    pronunciationAccent: "us",
    copiedLabel: null,
    speakingKey: null,
    pronunciationErrorKey: null,
    pronunciationError: null,
    sayItCache: new LocalSayItCacheRepository(window.localStorage),
    onArchiveChange: vi.fn(),
    onCopy: vi.fn().mockResolvedValue(undefined),
    onSpeak: vi.fn(),
    onSuccessfulSayIt: vi.fn(),
    renderSayItResult: (result) =>
      createElement("div", { "data-testid": "rendered" }, result.mode),
    onSaveRetrieval: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

const appCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

function cssRuleFor(selector: string): string {
  const start = appCss.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = appCss.indexOf("}", start);
  return appCss.slice(start, end);
}

describe("Reader selection popover", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof createFetchMock>;
  let props: ReaderWorkspaceProps;
  let originalScrollY: PropertyDescriptor | undefined;
  let originalRangeRect: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // Portals and prior roots can leave nodes on body between files.
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("scrollTo", vi.fn());
    window.localStorage.clear();
    originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    props = baseProps();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document
      .querySelectorAll(".reader-selection-popover")
      .forEach((node) => node.remove());
    if (originalScrollY) {
      Object.defineProperty(window, "scrollY", originalScrollY);
    } else {
      Reflect.deleteProperty(window, "scrollY");
    }
    if (originalRangeRect) {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeRect);
    } else {
      Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    }
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  async function openArticle() {
    await act(async () => {
      root.render(createElement(ReaderWorkspace, props));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const openButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(article.title),
    );
    await act(async () => openButton?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  function selectWord(word: string, paragraphIndex = 0) {
    const paragraph = container.querySelectorAll(".reader-article-body p")[
      paragraphIndex
    ];
    const textNode = paragraph.firstChild!;
    const start = textNode.textContent!.indexOf(word);
    if (start < 0) {
      throw new Error(`Fixture is missing the selection: ${word}`);
    }
    const range = document.createRange();
    range.setStart(textNode, start + 1);
    range.setEnd(textNode, start + word.length - 1);
    // Reader expands the selection to word boundaries and clones the range, so
    // the rect must be stubbed on the prototype rather than one instance.
    originalRangeRect = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getBoundingClientRect",
    );
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 80,
        right: 130,
        top: 180,
        bottom: 200,
        width: 50,
        height: 20,
        x: 80,
        y: 180,
        toJSON: () => ({}),
      }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return paragraph;
  }

  /**
   * Select `word` and release the drag as one uninterrupted task, which is how
   * the browser delivers a drag-and-release to the article's mouseup handler.
   */
  async function commitSelection(word: string, paragraphIndex = 0) {
    await act(async () => {
      const paragraph = selectWord(word, paragraphIndex);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("declares no internal scroll container and no viewport max-height", () => {
    const rule = cssRuleFor(".reader-selection-popover");
    expect(rule).not.toContain("overflow");
    expect(rule).not.toContain("max-height");
    expect(rule).toContain("position: absolute");
    // The older viewport-pinned model must not come back.
    expect(rule).not.toContain("position: fixed");
    expect(rule).not.toContain("52vh");
  });

  it("anchors to document coordinates so scrolling carries it with the text", async () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    await openArticle();
    await commitSelection("psychologically", 1);

    const popover = document.querySelector<HTMLElement>(
      ".reader-selection-popover",
    );
    expect(popover).toBeTruthy();
    // rect.bottom (200) + document scroll (0) + 8px gap
    expect(popover!.style.top).toBe("208px");
    expect(popover!.style.left).toMatch(/px$/);
    expect(popover!.parentElement).toBe(document.body);

    // The same anchor now sits 1200px further down the document, which is what
    // makes the popover travel with the selected text instead of staying put.
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 1200,
    });
    await act(async () => {
      const paragraph = selectWord("psychologically", 1);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const rescrolled = document.querySelector<HTMLElement>(
      ".reader-selection-popover",
    );
    expect(rescrolled!.style.top).toBe("1408px");
  });

  function retrieveCalls(): number {
    return fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/retrieve",
    ).length;
  }

  function sayItButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(
      ".reader-selection-popover button.sayit-button",
    );
  }

  function detailedResultText(): string {
    return (
      document.querySelector('[data-testid="rendered"]')?.textContent ?? ""
    );
  }

  it("shows local lightweight state for an uncached word without requesting SayIt", async () => {
    await openArticle();
    await commitSelection("psychologically", 1);

    // Local state only: no detailed SayIt result, no API request.
    expect(detailedResultText()).toBe("");
    expect(retrieveCalls()).toBe(0);

    const popover = document.querySelector(".reader-selection-popover")!;
    expect(popover.textContent).toContain("A local gloss.");
    expect(sayItButton()).toBeTruthy();

    // Wait out the async local enrichment so the IPA is visible too.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(
      document.querySelector(".reader-selection-popover")?.textContent,
    ).toContain("/ˌsaɪkəˈlɒdʒɪkli/");
    expect(detailedResultText()).toBe("");
    expect(retrieveCalls()).toBe(0);
  });

  it("caches the detailed result after the first explicit SayIt", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    props = baseProps({ sayItCache: cache });
    await openArticle();
    await commitSelection("psychologically", 1);

    await act(async () => sayItButton()!.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(retrieveCalls()).toBe(1);
    expect(detailedResultText()).toBe("interpret");
    // The successful result is now in the shared cache. A single word is
    // context-free, so any surrounding sentence resolves to the same entry.
    expect(
      cache.get(
        buildSayItCacheIdentity({
          selection: " PSYCHOLOGICALLY ",
          source: "reader",
          context: "anything at all",
        }),
      ),
    ).toEqual(phraseResult);
    expect(props.onSuccessfulSayIt).toHaveBeenCalledTimes(1);
  });

  it("renders the detailed cached result immediately after close and reselect", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    props = baseProps({ sayItCache: cache });
    await openArticle();

    // First encounter: explicit SayIt caches the detailed result.
    await commitSelection("psychologically", 1);
    await act(async () => sayItButton()!.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(retrieveCalls()).toBe(1);

    // Close the popup without touching the readable article.
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '.reader-selection-popover button[aria-label="Close selection"]',
        )
        ?.click();
    });
    expect(document.querySelector(".reader-selection-popover")).toBeNull();
    expect(
      container.querySelector(".reader-article-body")?.textContent,
    ).toContain("psychologically");

    // Later encounter, with Reader restarted against the same persistent
    // storage. The cache is read while the selection is finalized, so the first
    // useful popover render is already the detailed result.
    await act(async () => root.unmount());
    document
      .querySelectorAll(".reader-selection-popover")
      .forEach((node) => node.remove());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = baseProps({
      sayItCache: new LocalSayItCacheRepository(window.localStorage),
    });
    await openArticle();
    await commitSelection("psychologically", 1);

    const popover = document.querySelector<HTMLElement>(
      ".reader-selection-popover",
    );
    expect(popover).toBeTruthy();
    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(1);
    // No upgrade icon and no local-only intermediate state.
    expect(sayItButton()).toBeNull();
    expect(popover!.textContent).not.toContain("A local gloss.");
    // A passive cache read is not a new SayIt interaction.
    expect(
      vi.mocked(props.onSuccessfulSayIt).mock.calls.length,
    ).toBe(0);
    expect(
      document.querySelectorAll('[data-testid="rendered"]'),
    ).toHaveLength(1);
  });

  it("renders the detailed cached result for a phrase in the same context", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    cache.put(
      buildSayItCacheIdentity({
        selection: "held rates steady",
        source: "reader",
        context: "The bank held rates steady after the vote.",
      }),
      phraseResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();

    await commitSelection("held rates steady", 1);

    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(0);
    expect(sayItButton()).toBeNull();
  });

  it("keeps local lightweight state for a phrase in a different context", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    cache.put(
      buildSayItCacheIdentity({
        selection: "held rates steady",
        source: "reader",
        context: "Markets held rates steady through the summer.",
      }),
      phraseResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();

    await commitSelection("held rates steady", 1);

    // Same phrase, different sentence: no reuse, no request, no History.
    expect(detailedResultText()).toBe("");
    expect(retrieveCalls()).toBe(0);
    expect(sayItButton()).toBeTruthy();
    expect(props.onSuccessfulSayIt).not.toHaveBeenCalled();
  });

  it("restores the detailed result from persistent storage on a fresh mount", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    cache.put(
      buildSayItCacheIdentity({
        selection: "psychologically",
        source: "reader",
        context: "She explained the result psychologically.",
      }),
      interpretationResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();

    await commitSelection("psychologically", 1);
    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(0);
    expect(sayItButton()).toBeNull();

    // Remount Reader with the same storage, as a page/app restart would.
    await act(async () => root.unmount());
    container.remove();
    document
      .querySelectorAll(".reader-selection-popover")
      .forEach((node) => node.remove());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    props = baseProps({
      sayItCache: new LocalSayItCacheRepository(window.localStorage),
    });
    await openArticle();
    await commitSelection("psychologically", 1);

    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(0);
    expect(sayItButton()).toBeNull();
  });

  it("keeps the SayIt action an icon control and resolves a cached word locally", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    cache.put(
      buildSayItCacheIdentity({
        selection: "psychologically",
        source: "reader",
        context: "She explained the result psychologically.",
      }),
      interpretationResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();
    await commitSelection("psychologically", 1);

    // The passive read already upgraded the surface: icon controls only.
    const popover = document.querySelector(".reader-selection-popover")!;
    expect(sayItButton()).toBeNull();
    const speak = popover.querySelector<HTMLButtonElement>("button.speak-button");
    const copy = popover.querySelector<HTMLButtonElement>("button.copy-button");
    expect(speak?.textContent).toBe("");
    expect(speak?.getAttribute("aria-label")).toBe("Listen to psychologically");
    expect(copy?.textContent).toBe("");
    expect(copy?.getAttribute("aria-label")).toBe("Copy psychologically");
    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(0);
    expect(props.onSuccessfulSayIt).not.toHaveBeenCalled();
  });

  it("does not reuse a context-specific phrase result in another context", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    // The same phrase, already explained in a different article sentence.
    cache.put(
      buildSayItCacheIdentity({
        selection: "held rates steady",
        source: "reader",
        context: "Markets held rates steady through the summer.",
      }),
      phraseResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();
    await commitSelection("held rates steady", 1);
    expect(window.getSelection()?.toString()).toBe("held rates steady");

    // Context mismatch still needs an explicit SayIt press.
    expect(detailedResultText()).toBe("");
    await act(async () => sayItButton()?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // A different sentence fingerprint cannot reuse that interpretation.
    const retrieveCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/retrieve",
    );
    expect(retrieveCalls).toHaveLength(1);
    expect(String(retrieveCalls[0][1]?.body)).toContain(
      "The bank held rates steady after the vote.",
    );

    // The in-context answer is now cached; the same phrase in the same sentence
    // resolves as a passive cache read with no further request.
    await commitSelection("held rates steady", 1);
    expect(
      document.querySelector(".reader-selection-popover"),
      `detail=${JSON.stringify(detailedResultText())}`,
    ).toBeTruthy();
    expect(detailedResultText()).toBe("interpret");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/retrieve"),
    ).toHaveLength(1);
  });

  it("does not answer two same-length phrases in one sentence from one entry", async () => {
    const cache = new LocalSayItCacheRepository(window.localStorage);
    const sentence = "The bank held rates steady after the vote.";
    // Only the second, same-length phrase of the same sentence is cached.
    cache.put(
      buildSayItCacheIdentity({
        selection: "after the vote",
        source: "reader",
        context: sentence,
      }),
      phraseResult,
    );
    props = baseProps({ sayItCache: cache });
    await openArticle();

    // Selecting the other three-word phrase must not surface the wrong answer.
    await commitSelection("held rates steady", 1);
    expect(
      document.querySelector(".reader-selection-popover"),
      `detail=${JSON.stringify(detailedResultText())}`,
    ).toBeTruthy();
    expect(detailedResultText()).toBe("");
    expect(sayItButton()).toBeTruthy();
    expect(retrieveCalls()).toBe(0);
    expect(props.onSuccessfulSayIt).not.toHaveBeenCalled();

    // The phrase that does match the sentence still reads from cache.
    await commitSelection("after the vote", 1);
    expect(detailedResultText()).toBe("interpret");
    expect(retrieveCalls()).toBe(0);
    expect(sayItButton()).toBeNull();
  });
});

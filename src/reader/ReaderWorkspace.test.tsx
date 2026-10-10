// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SayItResult } from "../shared/contract";
import { LocalSayItCacheRepository } from "../lib/sayit-cache";
import { ReaderWorkspace, type ReaderWorkspaceProps } from "./ReaderWorkspace";
import type { ArticleProgress } from "./types";

vi.mock("../lib/local-dictionary", () => ({
  prefetchDictionary: vi.fn().mockResolvedValue({}),
  getDefinitionForSurface: vi.fn((surface: string) => {
    const word = surface.toLowerCase();
    if (word === "policy") {
      return { primary: "A course or principle of action.", secondary: "A governing plan." };
    }
    if (word === "investment") return { primary: "The act of investing money for profit." };
    return null;
  }),
}));

vi.mock("../lib/ipa", () => ({
  getIPA: vi.fn(async (text: string) => {
    const word = text.toLowerCase();
    if (word === "policy") return "/ˈpɑləsi/";
    if (word === "investment") return "/ɪnˈvɛstmənt/";
    return null;
  }),
  getIPACacheKey: vi.fn((text: string, accent: string) => `${accent}:${text.toLowerCase()}`),
}));

const preferences = {
  topics: ["Economy"],
  dailyArticleCount: 1,
  difficulty: "Intermediate" as const,
  readingBudgetMinutes: 10,
  collectionTime: "18:00",
  timezone: "Asia/Shanghai",
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
  paragraphCount: 2,
};

const issue = {
  id: "issue-2026-10-04",
  localDate: "2026-10-04",
  timezone: "Asia/Shanghai",
  edition: 1,
  status: "COMPLETE" as const,
  target: preferences,
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

let storedProgress: ArticleProgress | null = null;
let requestedProgress: ArticleProgress | null = null;
let readerParagraphs: string[] = [];
let deferProgressWrite = false;
let failProgressWrite = false;
let completeDeferredProgressWrite: (() => void) | null = null;
let requestSequence: string[] = [];
let progressAtRegenerate: ArticleProgress | null = null;
let regeneratedArticle: typeof article | null = null;
let regeneratedIssue: typeof issue | null = null;
let regeneratedProgress: ArticleProgress | null = null;

const interpretationResult: SayItResult = {
  schema_version: "1",
  mode: "interpret",
  status: "success",
  normalized_input: "Interpret the selected expression “held rates steady” in the context of this article sentence: “The bank held rates steady after the vote.”.",
  inferred_intent: "Interpret a selected expression in an article sentence.",
  interpretation: {
    expression: "held rates steady",
    kind: "literal_expression",
    meaning_in_context: "The bank chose not to change the interest rate.",
    usage_or_reference: "A common way to describe leaving a rate unchanged.",
    example: null,
  },
  clarifying_question: null,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function storeReaderProgress(progress: ArticleProgress): void {
  storedProgress = progress;
  if (
    progress.issueId === issue.id &&
    progress.articleId === article.id &&
    progress.edition === issue.edition
  ) {
    article.readState =
      progress.scrollRatio >= 0.98
        ? "READ"
        : progress.scrollRatio > 0.01 || progress.firstVisibleParagraph > 0
          ? "IN_PROGRESS"
          : "UNREAD";
  }
}

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/reader/preferences") return jsonResponse({ preferences });
    if (url === "/api/reader/issues/today") {
      const current = regeneratedIssue ?? issue;
      return jsonResponse({
        issue: current,
        latest: {
          date: current.localDate,
          issue: current,
          occurrence: {
            id: "occurrence-2026-10-04",
            localDate: current.localDate,
            timezone: current.timezone,
            localTime: "18:00",
            scheduledAt: "2026-10-04T10:00:00.000Z",
            status: "ALREADY_FULFILLED",
            scheduledAttemptCount: 0,
            maxScheduledAttempts: 3,
            nextAttemptAt: null,
            lastAttemptId: null,
            updatedAt: "2026-10-04T10:00:00.000Z",
          },
          delivered: current.articles.some(
            (item) => item.contentStatus === "FULL_TEXT",
          ),
          latestDeliveredDate: current.localDate,
        },
        calendarDate: current.localDate,
        occurrence: {
          id: "occurrence-2026-10-04",
          localDate: current.localDate,
          timezone: current.timezone,
          localTime: "18:00",
          scheduledAt: "2026-10-04T10:00:00.000Z",
          status: "ALREADY_FULFILLED",
          scheduledAttemptCount: 0,
          maxScheduledAttempts: 3,
          nextAttemptAt: null,
          lastAttemptId: null,
          updatedAt: "2026-10-04T10:00:00.000Z",
        },
        attempts: [],
      });
    }
    if (url.startsWith("/api/reader/issues/archive")) {
      return jsonResponse({ issues: [regeneratedIssue ?? issue] });
    }
    if (url.startsWith("/api/reader/articles/")) {
      if (url.includes("article-edition-2")) {
        return jsonResponse({
          article: regeneratedArticle,
          paragraphs: readerParagraphs,
          progress: regeneratedProgress,
        });
      }
      return jsonResponse({
        article,
        paragraphs: readerParagraphs,
        progress: storedProgress,
      });
    }
    if (url === "/api/reader/run" && init?.method === "POST") {
      requestSequence.push("run");
      const body = JSON.parse(String(init.body)) as { trigger: string; confirmRegenerate?: boolean };
      if (body.trigger !== "regenerate" || body.confirmRegenerate !== true) {
        throw new Error("The Regenerate test expected an explicitly confirmed Regenerate request.");
      }
      progressAtRegenerate = storedProgress;
      regeneratedArticle = {
        ...article,
        id: "article-edition-2",
        readState: progressAtRegenerate?.firstVisibleParagraph ? "IN_PROGRESS" : "UNREAD",
      };
      regeneratedIssue = {
        ...issue,
        edition: 2,
        priorEditions: [1],
        articles: [regeneratedArticle],
      };
      regeneratedProgress = progressAtRegenerate
        ? { ...progressAtRegenerate, articleId: regeneratedArticle.id, edition: 2 }
        : null;
      return jsonResponse({
        schema_version: "1",
        attempt: {
          id: "attempt-regenerate",
          issueId: issue.id,
          edition: 2,
          state: "SUCCEEDED",
          trigger: "regenerate",
          startedAt: "2026-10-04T10:00:00.000Z",
          completedAt: "2026-10-04T10:00:01.000Z",
          retryable: false,
          failureReason: null,
          deliveredCount: 1,
          traceId: "trace-regenerate",
        },
        issue: regeneratedIssue,
      });
    }
    if (url === "/api/retrieve") return jsonResponse(interpretationResult);
    if (url === "/api/reader/progress" && init?.method === "PUT") {
      requestSequence.push("progress");
      const nextProgress = JSON.parse(String(init.body)) as ArticleProgress;
      requestedProgress = nextProgress;
      if (failProgressWrite) {
        return jsonResponse({ error: { message: "Reading position save failed." } }, 503);
      }
      if (deferProgressWrite) {
        deferProgressWrite = false;
        await new Promise<void>((resolve) => {
          completeDeferredProgressWrite = () => {
            storeReaderProgress(nextProgress);
            resolve();
          };
        });
      } else {
        storeReaderProgress(nextProgress);
      }
      return jsonResponse({ schema_version: "1", progress: storedProgress });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  });
}

function baseProps(overrides: Partial<ReaderWorkspaceProps> = {}): ReaderWorkspaceProps {
  return {
    active: false,
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
    renderSayItResult: (result, _input, _saved, _onSave, _ipa, _retry) =>
      createElement("div", { "data-testid": "rendered-sayit-result" }, result.mode),
    onSaveRetrieval: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe("Reader workspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof createFetchMock>;
  let props: ReaderWorkspaceProps;
  let originalReaderRectDescriptor: PropertyDescriptor | undefined;
  let originalInnerHeightDescriptor: PropertyDescriptor | undefined;
  let originalScrollYDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("scrollTo", vi.fn());
    storedProgress = null;
    requestedProgress = null;
    article.title = "A closer look at policy";
    article.readState = "UNREAD";
    readerParagraphs = [
      "The policy shifted after the latest economic data arrived.",
      "The bank held rates steady after the vote. Traders adjusted their forecasts.",
    ];
    deferProgressWrite = false;
    failProgressWrite = false;
    completeDeferredProgressWrite = null;
    requestSequence = [];
    progressAtRegenerate = null;
    regeneratedArticle = null;
    regeneratedIssue = null;
    regeneratedProgress = null;
    originalReaderRectDescriptor = undefined;
    originalInnerHeightDescriptor = undefined;
    originalScrollYDescriptor = undefined;
    window.localStorage.clear();
    props = baseProps();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    // The selection popover renders through a portal, so it lives on body.
    document.querySelectorAll(".reader-selection-popover").forEach((node) => node.remove());
    if (originalReaderRectDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalReaderRectDescriptor);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).getBoundingClientRect;
    }
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(window, "innerHeight", originalInnerHeightDescriptor);
    } else {
      Reflect.deleteProperty(window, "innerHeight");
    }
    if (originalScrollYDescriptor) {
      Object.defineProperty(window, "scrollY", originalScrollYDescriptor);
    } else {
      Reflect.deleteProperty(window, "scrollY");
    }
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  async function render(nextProps = props) {
    await act(async () => {
      root.render(createElement(ReaderWorkspace, nextProps));
      await Promise.resolve();
    });
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  /** Reader opens on the latest issue list; a test enters an article from it. */
  async function openFirstArticle() {
    const openArticle = [...container.querySelectorAll("button")].find((button) =>
      button.classList.contains("reader-article-open"),
    );
    await act(async () => openArticle?.click());
    await flush();
  }

  it("starts hidden and does not load Reader service data before activation", async () => {
    await render();
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    props = { ...props, active: true };
    await render();
    await flush();
    expect(container.querySelector(".reader-main")?.hasAttribute("hidden")).toBe(false);
    expect(container.textContent).toContain("Latest issue");
    expect(container.textContent).toContain("1.6 min");
    expect(container.textContent).not.toContain("Recent collection attempts");
    expect(container.textContent).not.toContain("Reading preferences");
    expect(fetchMock).toHaveBeenCalledWith("/api/reader/preferences", expect.anything());
  });

  it("waits for the final progress write before restoring the last article on Reader re-entry", async () => {
    readerParagraphs = Array.from({ length: 16 }, (_, index) => `Article paragraph ${index}.`);
    props = { ...props, active: true };
    await render();
    await flush();

    await openFirstArticle();

    originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
    originalScrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2549 });
    originalReaderRectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains("reader-article-body")) {
          const top = 200 - window.scrollY;
          return {
            top,
            bottom: top + 4398,
            height: 4398,
            left: 0,
            right: 700,
            width: 700,
            x: 0,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        }
        const paragraphIndex = this.dataset.readerParagraph;
        if (paragraphIndex !== undefined) {
          const top = 277 + Number(paragraphIndex) * 160 - window.scrollY;
          return {
            top,
            bottom: top + 80,
            height: 80,
            left: 0,
            right: 700,
            width: 700,
            x: 0,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    const backButton = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label") === "Back to reading list",
    );
    await act(async () => backButton?.click());
    await flush();

    // Returning to the list clamps the document scroll. Simulate the final exit save
    // still being in flight when the user reopens Reader.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 297 });
    deferProgressWrite = true;
    props = { ...props, active: false };
    await render();
    await flush();
    expect(completeDeferredProgressWrite).toBeTruthy();
    expect(requestedProgress?.firstVisibleParagraph).toBe(15);

    const articleReadsBeforeReentry = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/reader/articles/"),
    ).length;
    props = { ...props, active: true };
    await render();
    await flush();
    const readsWhileProgressSaveIsPending = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/reader/articles/"),
    ).length;

    await act(async () => completeDeferredProgressWrite?.());
    await flush();

    expect(readsWhileProgressSaveIsPending).toBe(articleReadsBeforeReentry);
    expect(storedProgress?.scrollRatio).toBeCloseTo(0.6529, 4);
    expect(storedProgress?.scrollTop).toBe(2549);
    expect(storedProgress?.firstVisibleParagraph).toBe(15);

    // Reader reopens on the latest issue list: the persisted position is a
    // bookmark offered there, not an instruction to re-enter the article.
    expect(container.querySelector(".reader-article-body")).toBeNull();
    const resume = container.querySelector<HTMLButtonElement>(".reader-resume-bookmark");
    expect(resume, container.textContent?.slice(0, 200) ?? "").toBeTruthy();
    expect(resume?.textContent).toContain(article.title);

    // Choosing the bookmark restores that saved position.
    await act(async () => resume?.click());
    await flush();
    const restoration = vi.mocked(window.scrollTo).mock.calls.slice(-1)[0]?.[0] as
      | ScrollToOptions
      | undefined;
    expect(restoration?.top).toBeGreaterThan(2000);
  });

  it("saves the latest old-edition position before confirmed Regenerate carries progress", async () => {
    readerParagraphs = Array.from({ length: 16 }, (_, index) => `Article paragraph ${index}.`);
    storedProgress = {
      issueId: issue.id,
      articleId: article.id,
      edition: 1,
      scrollRatio: 0,
      scrollTop: 0,
      firstVisibleParagraph: 0,
      paragraphOffset: 0,
    };
    props = { ...props, active: true };
    await render();
    await flush();

    await openFirstArticle();

    originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
    originalScrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2100 });
    originalReaderRectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains("reader-article-body")) {
          const top = 200 - window.scrollY;
          const height = 800 + 1900 / 0.5508;
          return { top, bottom: top + height, height, left: 0, right: 700, width: 700, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        }
        const paragraphIndex = this.dataset.readerParagraph;
        if (paragraphIndex !== undefined) {
          const top = 148 + Number(paragraphIndex) * 160 - window.scrollY;
          return { top, bottom: top + 80, height: 80, left: 0, right: 700, width: 700, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      },
    });
    await act(async () => window.dispatchEvent(new Event("scroll")));

    const backButton = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label") === "Back to reading list",
    );
    const articleToolbar = container.querySelector<HTMLElement>(".reader-article-toolbar");
    expect(articleToolbar).toBeTruthy();
    const articleToolbarIsSticky = articleToolbar!.classList.contains("reader-article-toolbar--sticky");
    const browserMustScrollToBackButton = !articleToolbarIsSticky;
    await act(async () => {
      if (browserMustScrollToBackButton) {
        // Playwright scrolls an offscreen non-sticky button into view before click.
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
        window.dispatchEvent(new Event("scroll"));
      }
      backButton?.click();
    });
    await flush();

    const issueActions = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label") === "Issue actions",
    );
    await act(async () => issueActions?.click());
    await flush();
    const regenerateButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim() === "Regenerate",
    );
    await act(async () => regenerateButton?.click());
    await flush();
    const confirmButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim() === "Confirm Regenerate",
    );
    deferProgressWrite = true;
    await act(async () => confirmButton?.click());
    await flush();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 550)));

    expect(completeDeferredProgressWrite).toBeTruthy();
    const sequenceBeforeProgressWriteCompletes = [...requestSequence];
    await act(async () => completeDeferredProgressWrite?.());
    await flush();

    expect(sequenceBeforeProgressWriteCompletes).toEqual(["progress"]);
    expect(requestSequence).toEqual(["progress", "run"]);
    expect(progressAtRegenerate).toMatchObject({
      issueId: issue.id,
      articleId: article.id,
      edition: 1,
      scrollTop: 2100,
      firstVisibleParagraph: 13,
    });
    expect(progressAtRegenerate?.scrollRatio).toBeCloseTo(0.5508, 4);
    expect(storedProgress).toMatchObject({
      articleId: article.id,
      edition: 1,
      firstVisibleParagraph: 13,
    });
    expect(article.readState).toBe("IN_PROGRESS");
    expect(regeneratedIssue?.edition).toBe(2);
    expect(regeneratedArticle?.originalUrl).toBe(article.originalUrl);
    expect(regeneratedArticle?.readState).toBe("IN_PROGRESS");
    expect(regeneratedProgress).toMatchObject({
      issueId: issue.id,
      articleId: "article-edition-2",
      edition: 2,
      firstVisibleParagraph: 13,
      scrollTop: 2100,
    });
    expect(browserMustScrollToBackButton).toBe(false);
  });

  it("does not start confirmed Regenerate when the final progress flush fails", async () => {
    storedProgress = {
      issueId: issue.id,
      articleId: article.id,
      edition: 1,
      scrollRatio: 0.5886,
      scrollTop: 2549,
      firstVisibleParagraph: 13,
      paragraphOffset: 21,
    };
    props = { ...props, active: true };
    await render();
    await flush();

    await openFirstArticle();
    const backButton = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label") === "Back to reading list",
    );
    await act(async () => backButton?.click());
    await flush();

    const issueActions = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label") === "Issue actions",
    );
    await act(async () => issueActions?.click());
    await flush();
    const regenerateButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim() === "Regenerate",
    );
    await act(async () => regenerateButton?.click());
    await flush();
    const confirmButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim() === "Confirm Regenerate",
    );
    failProgressWrite = true;
    await act(async () => confirmButton?.click());
    await flush();

    expect(requestSequence).toEqual(["progress"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/reader/run")).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Reading position save failed.",
    );
  });

  it("uses the local dictionary, IPA, and Listen path for a known word", async () => {
    props = { ...props, active: true };
    await render();
    await flush();

    const openArticle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(article.title),
    );
    expect(openArticle).toBeTruthy();
    await act(async () => openArticle?.click());
    await flush();
    const paragraph = container.querySelector(".reader-article-body p")!;    const textNode = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 9);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 80, right: 130, top: 180, bottom: 200, width: 50, height: 20, x: 80, y: 180, toJSON: () => ({}) }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(document.querySelector(".reader-selection-popover")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);

    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await flush();

    expect(selection.toString()).toBe("policy");
    expect(document.querySelector(".reader-selection-popover")).toBeTruthy();
    expect(document.body.textContent).toContain("A course or principle of action.");
    expect(document.body.textContent).toContain("/ˈpɑləsi/");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);
    const listenButton = document.querySelector<HTMLButtonElement>(
      '.reader-selection-popover button[aria-label="Listen to policy"]',
    );
    expect(listenButton?.classList.contains("speak-button")).toBe(true);
    expect(listenButton?.textContent).toBe("");
    await act(async () => listenButton?.click());
    expect(props.onSpeak).toHaveBeenCalledWith("policy", "reader-selection");
    const copyButton = document.querySelector<HTMLButtonElement>(
      '.reader-selection-popover button.copy-button',
    );
    expect(copyButton?.textContent).toBe("");
    await act(async () => copyButton?.click());
    expect(props.onCopy).toHaveBeenCalledWith("policy", "Reader selection");

    const sayItButton = document.querySelector<HTMLButtonElement>(
      '.reader-selection-popover button[aria-label*="SayIt: word"]',
    );
    expect(sayItButton?.classList.contains("sayit-button")).toBe(true);
    expect(sayItButton?.textContent).toBe("");
    await act(async () => sayItButton?.click());
    await flush();

    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(true);
    expect(props.onSuccessfulSayIt).toHaveBeenCalledWith("policy", interpretationResult);
    expect(document.querySelector(".reader-selection-popover")).toBeTruthy();
    expect(container.querySelector(".reader-result-panel")).toBeNull();
  });

  it("sends phrase interpretation with only the article sentence and keeps it local", async () => {
    props = { ...props, active: true };
    await render();
    await flush();
    await openFirstArticle();

    const paragraphs = container.querySelectorAll(".reader-article-body p");
    expect(container.textContent).toContain("1.6 min");
    expect(container.textContent).toContain("Intermediate");
    expect(container.textContent).not.toContain("FKGL inputs");
    expect(container.textContent).not.toContain("whitespace-separated words");
    expect(container.textContent).not.toContain("Offline copy");
    expect(container.textContent).not.toContain("Full text in Reader");
    const paragraph = paragraphs[1];
    const textNode = paragraph.firstChild!;
    const phrase = "held rates steady";
    const start = textNode.textContent!.indexOf(phrase);
    const range = document.createRange();
    range.setStart(textNode, start + 2);
    range.setEnd(textNode, start + phrase.length - 3);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 90, right: 230, top: 180, bottom: 202, width: 140, height: 22, x: 90, y: 180, toJSON: () => ({}) }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await flush();
    expect(window.getSelection()?.toString()).toBe(phrase);
    expect(document.querySelector(".reader-selection-popover")?.textContent).toContain(phrase);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);
    const sayItButton = document.querySelector<HTMLButtonElement>(
      '.reader-selection-popover button[aria-label*="SayIt: selected expression"]',
    );
    await act(async () => sayItButton?.click());
    await flush();

    const retrieveCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/retrieve");
    expect(retrieveCall).toBeTruthy();
    const request = JSON.parse(String(retrieveCall?.[1]?.body)) as { input: string; context: unknown[] };
    expect(request.input).toBe(
      "Interpret the selected expression “held rates steady” in the context of this article sentence: “The bank held rates steady after the vote.”",
    );
    expect(request.context).toEqual([]);
    expect(request.input.length).toBeLessThanOrEqual(500);
    expect(props.onSuccessfulSayIt).toHaveBeenCalledWith(phrase, interpretationResult);
    expect(container.querySelector(".reader-result-panel")).toBeNull();
    expect(
      document.querySelector('[data-testid="rendered-sayit-result"]')?.textContent,
    ).toBe("interpret");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("expands a partial title selection and keeps the local lookup off the API", async () => {
    article.title = "Global investment markets reopen";
    props = { ...props, active: true };
    await render();
    await flush();
    await openFirstArticle();

    const title = container.querySelector("#reader-article-title")!;
    const textNode = title.firstChild!;
    const word = "investment";
    const wordAt = textNode.textContent!.indexOf(word);
    const range = document.createRange();
    range.setStart(textNode, wordAt + 2);
    range.setEnd(textNode, wordAt + 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(document.querySelector(".reader-selection-popover")).toBeNull();

    await act(async () => {
      title.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await flush();

    expect(selection.toString()).toBe(word);
    expect(document.querySelector(".reader-selection-popover")?.textContent).toContain(word);
    expect(document.body.textContent).toContain("The act of investing money for profit.");
    expect(document.body.textContent).toContain("/ɪnˈvɛstmənt/");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);

    const sayItButton = document.querySelector<HTMLButtonElement>(
      '.reader-selection-popover button[aria-label*="SayIt: word"]',
    );
    await act(async () => sayItButton?.click());
    await flush();

    const retrieveCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/retrieve");
    const request = JSON.parse(String(retrieveCall?.[1]?.body)) as { input: string; context: unknown[] };
    expect(request.input).toBe(
      "Interpret the selected expression “investment” in the context of this article sentence: “Global investment markets reopen”",
    );
    expect(request.input).not.toContain("The policy shifted");
    expect(request.context).toEqual([]);
    expect(props.onSuccessfulSayIt).toHaveBeenCalledWith(word, interpretationResult);
  });

  it("expands both ends of a title phrase without calling SayIt", async () => {
    article.title = "Global investment markets reopen";
    props = { ...props, active: true };
    await render();
    await flush();
    await openFirstArticle();

    const title = container.querySelector("#reader-article-title")!;
    const textNode = title.firstChild!;
    const phrase = "investment markets";
    const start = textNode.textContent!.indexOf(phrase);
    const range = document.createRange();
    range.setStart(textNode, start + 2);
    range.setEnd(textNode, start + phrase.length - 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      title.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await flush();

    expect(selection.toString()).toBe(phrase);
    expect(document.querySelector(".reader-selection-popover")?.textContent).toContain(phrase);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);

    const eyebrow = container.querySelector(".reader-eyebrow")!;
    const eyebrowNode = eyebrow.firstChild!;
    const eyebrowRange = document.createRange();
    eyebrowRange.setStart(eyebrowNode, 0);
    eyebrowRange.setEnd(eyebrowNode, 5);
    selection.removeAllRanges();
    selection.addRange(eyebrowRange);
    await act(async () => {
      eyebrow.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(document.querySelector(".reader-selection-popover")).toBeNull();
  });

  it("does not show a selection action or request when selection is empty", async () => {
    props = { ...props, active: true };
    await render();
    await flush();
    await openFirstArticle();
    const body = container.querySelector(".reader-article-body")!;
    await act(async () => body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));

    expect(document.querySelector(".reader-selection-popover")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/retrieve")).toBe(false);
  });

  it("reports the Reading side of History and still loads a prior edition", async () => {
    const latestIssue = { ...issue, edition: 2, priorEditions: [1] };
    const archivedArticle = { ...article, id: "article-old", title: "The first edition article" };
    const priorIssue = { ...issue, edition: 1, articles: [archivedArticle], priorEditions: [] };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/reader/preferences") return jsonResponse({ preferences });
      if (url === "/api/reader/issues/today") return jsonResponse({ issue: latestIssue, occurrence: null, attempts: [] });
      if (url.startsWith("/api/reader/issues/archive")) return jsonResponse({ issues: [latestIssue] });
      if (url.endsWith("/editions/1")) return jsonResponse({ issue: priorIssue });
      throw new Error(`Unexpected archive test fetch: ${url}`);
    });
    props = { ...props, active: true };
    await render();
    await flush();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));

    // The shared History drawer reads this snapshot instead of a Reader drawer.
    const archiveChange = vi.mocked(props.onArchiveChange);
    expect(archiveChange).toHaveBeenCalled();
    const snapshot = archiveChange.mock.calls[archiveChange.mock.calls.length - 1][0];
    expect(snapshot.todayIssue?.edition).toBe(2);
    expect(snapshot.archiveIssues.map((item) => item.edition)).toContain(2);
    expect(snapshot.displayedIssue).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/reader/issues/archive"))).toBe(true);
  });
});

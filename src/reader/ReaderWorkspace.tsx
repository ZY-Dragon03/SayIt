import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  MAX_INPUT_LENGTH,
  type SayItResult,
} from "../shared/contract";
import {
  CopyButton,
  SayItButton,
  SpeakButton,
} from "../lib/action-controls";
import { getDefinitionForSurface, prefetchDictionary } from "../lib/local-dictionary";
import { getIPA, getIPACacheKey } from "../lib/ipa";
import type { PronunciationAccent } from "../lib/pronunciation";
import type { LocalSayItCacheRepository } from "../lib/sayit-cache";
import { buildSayItCacheIdentity } from "../lib/sayit-cache";
import { resolveSayItRequest } from "../lib/sayit-resolver";
import {
  getReaderArchive,
  getReaderArticle,
  getReaderEdition,
  getReaderPreferences,
  getReaderRun,
  getTodayIssue,
  isRunAttemptRunning,
  putReaderPreferences,
  putReaderProgress,
  startReaderRun,
} from "./api";
import {
  buildReaderInterpretationInput,
  readReaderSelection,
  type ReaderContextKind,
} from "./selection";
import type {
  ArticleProgress,
  DailyIssue,
  ReaderArticleResponse,
  ReaderArticleSummary,
  ReaderDifficulty,
  ReaderPreferences,
  RunAttempt,
  TodayIssueResponse,
} from "./types";

const READER_POINTER_KEY = "sayit.reader.last-opened.v1";
const READER_SPEECH_KEY = "reader-selection";
const READER_COPY_LABEL = "Reader selection";
const ARCHIVE_LIMIT = 60;
const PROGRESS_SAVE_DELAY_MS = 500;
const SCROLL_ANCHOR_PX = 128;
/** How often an open Reader re-reads Today while no run is being polled. */
const TODAY_REFRESH_INTERVAL_MS = 15_000;

/** Session-scoped key for an article body already loaded in this workspace. */
function articleCacheKey(articleId: string, edition: number): string {
  return `${articleId}|${edition}`;
}
/** Horizontal breathing room kept between the popover and the viewport edge. */
const POPOVER_VIEWPORT_MARGIN = 12;
const POPOVER_GAP_PX = 8;

interface ReaderPointer {
  issueId: string;
  localDate: string;
  articleId: string;
  edition: number;
  article: ReaderArticleSummary;
}

interface ReaderSelection {
  text: string;
  context: string;
  contextKind: ReaderContextKind;
  singleWord: boolean;
  left: number;
  top: number;
  ipa: string | null;
  definitionPrimary: string | null;
  definitionSecondary: string | null;
}

export interface ReaderWorkspaceProps {
  active: boolean;
  pronunciationAccent: PronunciationAccent;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  pronunciationError: string | null;
  /** The one shared SayIt result cache, owned by the app shell. */
  sayItCache: LocalSayItCacheRepository;
  onCopy: (text: string, label: string) => Promise<void>;
  onSpeak: (text: string, key: string) => void;
  onSuccessfulSayIt: (input: string, result: SayItResult) => void;
  /** Report the Reading side of History so the shared drawer can show it. */
  onArchiveChange: (snapshot: ReaderArchiveSnapshot) => void;
  renderSayItResult: (
    result: SayItResult,
    input: string,
    isSaved: boolean,
    onSave: () => void,
    ipaByKey: Record<string, string>,
    onRetry: () => void,
  ) => ReactNode;
  onSaveRetrieval: (input: string, result: SayItResult) => boolean;
  preferencesOpen?: boolean;
  onClosePreferences?: () => void;
}

/** The Reading side of the shared History drawer. */
export interface ReaderArchiveSnapshot {
  todayIssue: DailyIssue | null;
  archiveIssues: DailyIssue[];
  /** The issue currently open, or null when the reading list is shown. */
  displayedIssue: DailyIssue | null;
  /** Reader's explicit view state, so History can name where the reader is. */
  viewState: ReaderViewState;
  /** Date the latest-issue list represents; the single Latest target. */
  latestDate: string | null;
  /** Current calendar date in the configured timezone, when known. */
  calendarDate: string | null;
}

/** Which issue Reader presents as the latest scheduled one. */
export type LatestIssueStatus = NonNullable<TodayIssueResponse["latest"]>;

/**
 * Reader's explicit view states. The workspace is either offering the latest
 * issue list, reading an article, or showing an earlier issue's list.
 */
export type ReaderViewState =
  | "LATEST_ISSUE_LIST"
  | "READING_ARTICLE"
  | "VIEWING_HISTORICAL_ISSUE";

/** Operations the shared History drawer asks the open Reader to perform. */
export interface ReaderWorkspaceHandle {
  openArticle: (article: ReaderArticleSummary) => void;
  showToday: () => void;
}

function defaultPreferences(): ReaderPreferences {
  return {
    topics: ["Politics", "Economy", "Finance", "Geopolitics", "Technology"],
    dailyArticleCount: 3,
    difficulty: "Intermediate",
    readingBudgetMinutes: 20,
    collectionTime: "08:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function readPointer(): ReaderPointer | null {
  try {
    const raw = window.localStorage.getItem(READER_POINTER_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const pointer = value as Partial<ReaderPointer>;
    if (
      typeof pointer.issueId !== "string" ||
      typeof pointer.localDate !== "string" ||
      typeof pointer.articleId !== "string" ||
      typeof pointer.edition !== "number" ||
      !pointer.article
    ) {
      return null;
    }
    return pointer as ReaderPointer;
  } catch {
    return null;
  }
}

function writePointer(pointer: ReaderPointer): void {
  try {
    window.localStorage.setItem(READER_POINTER_KEY, JSON.stringify(pointer));
  } catch {
    // The service progress API remains the source of truth for article position.
  }
}

function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function formatReadingMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return "Reading time unavailable";
  }
  return `${minutes.toFixed(1)} min`;
}

function difficultyForGrade(value: number): ReaderDifficulty {
  if (value <= 8) return "Easy";
  if (value <= 12) return "Intermediate";
  return "Advanced";
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function isActiveAttempt(attempt: RunAttempt): boolean {
  return isRunAttemptRunning(attempt);
}

export const ReaderWorkspace = forwardRef<
  ReaderWorkspaceHandle,
  ReaderWorkspaceProps
>(function ReaderWorkspace({
  active,
  pronunciationAccent,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  pronunciationError,
  sayItCache,
  onCopy,
  onSpeak,
  onSuccessfulSayIt,
  onArchiveChange,
  renderSayItResult,
  onSaveRetrieval,
  preferencesOpen = false,
  onClosePreferences,
}, ref) {
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultPreferences);
  const [topicDraft, setTopicDraft] = useState("Politics, Economy, Finance, Geopolitics, Technology");
  const [todayIssue, setTodayIssue] = useState<DailyIssue | null>(null);
  const [archiveIssues, setArchiveIssues] = useState<DailyIssue[]>([]);
  const [latestIssue, setLatestIssue] = useState<LatestIssueStatus | null>(null);
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [todayAttemptCount, setTodayAttemptCount] = useState(0);
  /** The bookmark offered on the issue list; never entered automatically. */
  const [resumableArticle, setResumableArticle] = useState<ReaderArticleSummary | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<DailyIssue | null>(null);
  const [articleResponse, setArticleResponse] = useState<ReaderArticleResponse | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ReaderArticleSummary | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const [showRegenerateConfirmation, setShowRegenerateConfirmation] = useState(false);
  const [issueMenuOpen, setIssueMenuOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [activeAttempt, setActiveAttempt] = useState<RunAttempt | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [sayItBusy, setSayItBusy] = useState(false);
  const [sayItError, setSayItError] = useState<string | null>(null);
  const [readerSayItResult, setReaderSayItResult] = useState<{
    input: string;
    result: SayItResult;
  } | null>(null);
  const [readerResultSaved, setReaderResultSaved] = useState(false);
  /**
   * True when the displayed detailed result came from a passive cache read at
   * selection time, rather than an explicit SayIt action in this session.
   */
  const [passiveCacheResult, setPassiveCacheResult] = useState(false);
  const [readerIpaByKey, setReaderIpaByKey] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<ArticleProgress | null>(null);

  const articleContentRef = useRef<HTMLElement>(null);
  const articleBodyRef = useRef<HTMLElement>(null);
  const lastProgressRef = useRef<ArticleProgress | null>(null);
  const selectedIssueRef = useRef<DailyIssue | null>(null);
  const selectedArticleRef = useRef<ReaderArticleSummary | null>(null);
  const selectedExpressionForRetryRef = useRef<ReaderSelection | null>(null);
  const selectionTokenRef = useRef(0);
  const ignoreSelectionChangeRef = useRef(false);
  const progressTimerRef = useRef<number | null>(null);
  const progressWriteRef = useRef<Promise<void>>(Promise.resolve());
  const restorePendingRef = useRef(false);
  const wasActiveRef = useRef(false);
  /** True while the SayIt workspace owns the screen. */
  const inactiveRef = useRef(!active);
  const readerScrollRef = useRef(0);
  /** Article bodies loaded in this session, so reopening does not refetch. */
  const articleBodyCacheRef = useRef(
    new Map<string, ReaderArticleResponse>(),
  );

  const enqueueProgressWrite = useCallback((nextProgress: ArticleProgress) => {
    const nextWrite = progressWriteRef.current
      .catch(() => undefined)
      .then(() => putReaderProgress(nextProgress))
      .then(() => undefined);
    progressWriteRef.current = nextWrite;
    return nextWrite;
  }, []);

  const flushProgressWrites = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    const pending = lastProgressRef.current;
    return pending ? enqueueProgressWrite(pending) : progressWriteRef.current;
  }, [enqueueProgressWrite]);

  useEffect(() => {
    selectedIssueRef.current = selectedIssue;
  }, [selectedIssue]);
  useEffect(() => {
    selectedArticleRef.current = selectedArticle;
  }, [selectedArticle]);

  const displayedIssue = selectedIssue ?? todayIssue;
  const paragraphs = articleResponse?.paragraphs ?? null;

  /**
   * Reader's explicit view state: reading an article, looking at an earlier
   * issue's list, or on the latest issue list.
   */
  const viewState: ReaderViewState = selectedArticle
    ? "READING_ARTICLE"
    : selectedIssue && selectedIssue.localDate !== (latestIssue?.date ?? calendarDate)
      ? "VIEWING_HISTORICAL_ISSUE"
      : "LATEST_ISSUE_LIST";

  const refreshWorkspace = useCallback(async (restoreLastOpened: boolean) => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    const [preferencesResult, todayResult, archiveResult] = await Promise.allSettled([
      getReaderPreferences(),
      getTodayIssue(),
      getReaderArchive(ARCHIVE_LIMIT),
    ]);
    if (preferencesResult.status === "fulfilled") {
      setPreferences(preferencesResult.value.preferences);
      setTopicDraft(preferencesResult.value.preferences.topics.join(", "));
    } else {
      setWorkspaceError((current) => current ?? "Reader preferences could not be loaded.");
    }

    let nextToday: DailyIssue | null = null;
    if (todayResult.status === "fulfilled") {
      nextToday = todayResult.value.issue;
      setTodayIssue(nextToday);
      setLatestIssue(todayResult.value.latest);
      setCalendarDate(todayResult.value.calendarDate);
      setTodayAttemptCount(todayResult.value.attempts.length);
      const running = todayResult.value.attempts.find(isActiveAttempt) ?? null;
      setActiveAttempt(running);
    } else {
      setWorkspaceError((current) => current ?? "Today’s reading issue could not be loaded.");
    }

    let nextArchive: DailyIssue[] = [];
    if (archiveResult.status === "fulfilled") {
      nextArchive = archiveResult.value.issues;
      setArchiveIssues(nextArchive);
    } else {
      setWorkspaceError((current) => current ?? "The Reader archive could not be loaded.");
    }

    setWorkspaceLoading(false);
    if (restoreLastOpened) {
      // A persisted pointer is a bookmark, not an instruction to enter an
      // article. Reader opens on the latest issue list, and the pointer is
      // offered there as a clearly labelled way back into the last article.
      const pointer = readPointer();
      if (pointer) {
        setResumableArticle(pointer.article);
      } else {
        setResumableArticle(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const remember = () => {
      const root = articleBodyRef.current?.closest(".reader-main");
      if (root?.hasAttribute("hidden")) return;
      readerScrollRef.current = window.scrollY;
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [active]);

  /**
   * Refresh the Today view and archive without disturbing the open article.
   * Reader resumes the last opened article on activation, so this is what keeps
   * a background scheduled run observable instead of showing stale data.
   */
  const refreshTodaySurface = useCallback(async () => {
    const [todayResult, archiveResult] = await Promise.allSettled([
      getTodayIssue(),
      getReaderArchive(ARCHIVE_LIMIT),
    ]);
    if (todayResult.status === "fulfilled") {
      setTodayIssue(todayResult.value.issue);
      setLatestIssue(todayResult.value.latest);
      setCalendarDate(todayResult.value.calendarDate);
      setTodayAttemptCount(todayResult.value.attempts.length);
      setActiveAttempt(todayResult.value.attempts.find(isActiveAttempt) ?? null);
    }
    if (archiveResult.status === "fulfilled") {
      setArchiveIssues(archiveResult.value.issues);
    }
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        void flushProgressWrites().catch(() => undefined);
      }
      return;
    }
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = true;
    // Mode switching is handled by the in-memory view state: an article the
    // reader opened in this session stays open at its position without
    // refetching, and the issue list stays the issue list.
    if (selectedArticleRef.current && articleBodyRef.current) {
      window.scrollTo({ top: readerScrollRef.current, behavior: "auto" });
      void refreshTodaySurface();
      return;
    }
    if (wasActive) {
      void refreshTodaySurface();
      return;
    }
    // First activation in this session still rebuilds from persisted state, but
    // it opens on the latest issue list rather than a stale article pointer.
    void refreshWorkspace(true);
  }, [active, flushProgressWrites, refreshTodaySurface, refreshWorkspace]);

  const loadArticle = useCallback(async (issue: DailyIssue, summary: ReaderArticleSummary) => {    setSelectedIssue(issue);
    setSelectedArticle(summary);
    setArticleResponse(null);
    setArticleError(null);
    setArticleLoading(true);
    setSelection(null);
    setReaderSayItResult(null);
    setPassiveCacheResult(false);
    setSayItError(null);
    setReaderResultSaved(false);
    writePointer({
      issueId: issue.id,
      localDate: issue.localDate,
      articleId: summary.id,
      edition: issue.edition,
      article: summary,
    });
    try {
      await flushProgressWrites().catch(() => undefined);
      // Reuse a body that is already loaded in this session. Nothing restricted
      // is persisted for speed: this is the same in-memory response the server
      // would return, kept only while the workspace is mounted.
      const cached = articleBodyCacheRef.current.get(articleCacheKey(summary.id, issue.edition));
      if (cached) {
        setArticleResponse(cached);
        setProgress(cached.progress);
        lastProgressRef.current = cached.progress;
        restorePendingRef.current = Boolean(cached.progress);
        if (!cached.paragraphs) {
          setArticleError(
            cached.article.contentStatus === "FULL_TEXT"
              ? "Verified article text is unavailable now. Check the source link for access."
              : "This item is available from its publisher, but Reader does not have verified full text.",
          );
        }
        return;
      }
      const response = await getReaderArticle(summary.id, issue.edition);
      articleBodyCacheRef.current.set(
        articleCacheKey(summary.id, issue.edition),
        response,
      );
      setArticleResponse(response);
      setProgress(response.progress);
      lastProgressRef.current = response.progress;
      restorePendingRef.current = Boolean(response.progress);
      if (!response.paragraphs) {
        setArticleError(
          response.article.contentStatus === "FULL_TEXT"
            ? "Verified article text is unavailable now. Check the source link for access."
            : "This item is available from its publisher, but Reader does not have verified full text.",
        );
      }
    } catch (error) {
      setArticleError(error instanceof Error ? error.message : "The article could not be opened.");
      setArticleResponse({ schema_version: "1", article: summary, paragraphs: null, progress: null });
      setProgress(null);
      lastProgressRef.current = null;
    } finally {
      setArticleLoading(false);
    }
  }, [flushProgressWrites]);

  /**
   * Resume the bookmarked article, refreshing its saved position first.
   *
   * The session body cache is reused so reopening does not refetch the text, but
   * the saved position may have moved since it was cached, so it is refreshed
   * from the service in the background before the article is shown.
   */
  const resumeBookmarkedArticle = useCallback(
    (issue: DailyIssue, article: ReaderArticleSummary) => {
      const key = articleCacheKey(article.id, issue.edition);
      void getReaderArticle(article.id, issue.edition)
        .then((response) => {
          articleBodyCacheRef.current.set(key, response);
        })
        .catch(() => undefined)
        .finally(() => {
          void loadArticle(issue, article);
        });
    },
    [loadArticle],
  );

  useEffect(() => {
    if (!active || !activeAttempt || !isActiveAttempt(activeAttempt)) return;
    const timer = window.setInterval(() => {
      void getReaderRun(activeAttempt.id)
        .then(({ attempt, issue }) => {
          setActiveAttempt(isActiveAttempt(attempt) ? attempt : null);
          if (issue) setTodayIssue(issue);
          if (!isActiveAttempt(attempt)) {
            void getReaderArchive(ARCHIVE_LIMIT)
              .then((response) => setArchiveIssues(response.issues))
              .catch(() => undefined);
          }
        })
        .catch((error) => {
          setWorkspaceError(error instanceof Error ? error.message : "Run status could not be checked.");
        });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [active, activeAttempt]);

  /**
   * Keep Today fresh while Reader is open, so a scheduled collection finishing in
   * the background becomes visible without switching workspaces or reloading.
   *
   * This only reads `/api/reader/issues/today` on a slow interval and only when
   * nothing else is already polling a run; it never starts a collection or an
   * LLM call, and it updates state only when the delivered issue actually
   * changed.
   */
  useEffect(() => {
    if (!active || (activeAttempt && isActiveAttempt(activeAttempt))) return;
    const timer = window.setInterval(() => {
      void getTodayIssue()
        .then((response) => {
          const fresh = response.issue;
          if (fresh) {
            setTodayIssue((current) => {
              if (
                current &&
                current.updatedAt === fresh.updatedAt &&
                current.status === fresh.status &&
                current.actual.count === fresh.actual.count
              ) {
                return current;
              }
              return fresh;
            });
          }
          const running = response.attempts.find(isActiveAttempt) ?? null;
          setActiveAttempt((current) => {
            if (current && running && current.id === running.id) return current;
            return running;
          });
        })
        .catch(() => undefined);
    }, TODAY_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, activeAttempt]);

  useEffect(() => {
    const result = readerSayItResult?.result;
    if (!result) {
      setReaderIpaByKey({});
      return;
    }
    const expressions =
      result.mode === "retrieve"
        ? [result.best_match?.text, ...result.alternatives.map((item) => item.text)]
        : [result.interpretation?.expression];
    let cancelled = false;
    void Promise.all(
      Array.from(new Set(expressions.filter((value): value is string => Boolean(value))))
        .map(async (expression) => {
          const ipa = await getIPA(expression, pronunciationAccent);
          return ipa ? [getIPACacheKey(expression, pronunciationAccent), ipa] as const : null;
        }),
    ).then((entries) => {
      if (!cancelled) {
        setReaderIpaByKey(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pronunciationAccent, readerSayItResult]);

  const persistProgress = useCallback((nextProgress: ArticleProgress) => {
    lastProgressRef.current = nextProgress;
    setProgress(nextProgress);
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null;
      void enqueueProgressWrite(nextProgress).catch((error) => {
        setWorkspaceError(error instanceof Error ? error.message : "Reading position could not be saved.");
      });
    }, PROGRESS_SAVE_DELAY_MS);
  }, [enqueueProgressWrite]);

  const captureProgress = useCallback(() => {
    const issue = selectedIssueRef.current;
    const article = selectedArticleRef.current;
    const body = articleBodyRef.current;
    if (!issue || !article || !body || !articleResponse?.paragraphs) return;
    const paragraphElements = Array.from(
      body.querySelectorAll<HTMLElement>("[data-reader-paragraph]"),
    );
    if (paragraphElements.length === 0) return;
    const visible = paragraphElements.find(
      (element) => element.getBoundingClientRect().bottom > SCROLL_ANCHOR_PX,
    ) ?? paragraphElements[paragraphElements.length - 1];
    const paragraphIndex = Number(visible.dataset.readerParagraph ?? 0);
    const paragraphOffset = Math.max(
      0,
      SCROLL_ANCHOR_PX - visible.getBoundingClientRect().top,
    );
    const articleRect = body.getBoundingClientRect();
    const scrollTop = window.scrollY;
    const readingHeight = Math.max(1, articleRect.height - window.innerHeight);
    const scrollRatio = Math.max(
      0,
      Math.min(1, (scrollTop - (scrollTop + articleRect.top)) / readingHeight),
    );
    persistProgress({
      issueId: issue.id,
      articleId: article.id,
      edition: issue.edition,
      scrollRatio,
      scrollTop,
      firstVisibleParagraph: paragraphIndex,
      paragraphOffset,
    });
  }, [articleResponse?.paragraphs, persistProgress]);

  useEffect(() => {
    if (!active || !selectedArticle || !paragraphs) return;
    const onScroll = () => captureProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, captureProgress, paragraphs, selectedArticle]);

  useLayoutEffect(() => {
    if (!restorePendingRef.current || !articleResponse?.paragraphs || !selectedArticle) return;
    const saved = articleResponse.progress;
    if (saved && articleBodyRef.current) {
      const paragraph = articleBodyRef.current.querySelector<HTMLElement>(
        `[data-reader-paragraph="${Math.max(0, saved.firstVisibleParagraph)}"]`,
      );
      if (paragraph) {
        const destination =
          window.scrollY + paragraph.getBoundingClientRect().top - SCROLL_ANCHOR_PX +
          Math.max(0, saved.paragraphOffset);
        window.scrollTo({ top: Math.max(0, destination), behavior: "auto" });
      } else if (saved.scrollTop > 0) {
        window.scrollTo({ top: saved.scrollTop, behavior: "auto" });
      }
    }
    restorePendingRef.current = false;
  }, [articleResponse, selectedArticle]);

  useEffect(() => {
    if (!active || !selectedArticle) return;
    const clearStaleSelection = () => {
      if (ignoreSelectionChangeRef.current) return;
      const current = window.getSelection();
      if (current && !current.isCollapsed) return;
      setSelection(null);
      setSayItBusy(false);
      setSayItError(null);
      setReaderSayItResult(null);
      setPassiveCacheResult(false);
    };
    document.addEventListener("selectionchange", clearStaleSelection);
    return () => document.removeEventListener("selectionchange", clearStaleSelection);
  }, [active, selectedArticle]);

  const savePreferences = async () => {
    setSavingPreferences(true);
    setWorkspaceError(null);
    setPreferenceNotice(null);
    const next = {
      ...preferences,
      topics: topicDraft.split(",").map((topic) => topic.trim()).filter(Boolean),
    };
    try {
      const response = await putReaderPreferences(next);
      setPreferences(response.preferences);
      setTopicDraft(response.preferences.topics.join(", "));
      setPreferenceNotice("Preferences saved");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Preferences could not be saved.");
    } finally {
      setSavingPreferences(false);
    }
  };

  const beginRun = async (trigger: "manual" | "regenerate") => {
    setWorkspaceError(null);
    setRegenerating(trigger === "regenerate");
    setShowRegenerateConfirmation(false);
    try {
      if (trigger === "regenerate") await flushProgressWrites();
      const { attempt, issue } = await startReaderRun(trigger);
      setActiveAttempt(isActiveAttempt(attempt) ? attempt : null);
      if (issue) setTodayIssue(issue);
      if (!isActiveAttempt(attempt)) {
        const [today, archive] = await Promise.allSettled([
          getTodayIssue(),
          getReaderArchive(ARCHIVE_LIMIT),
        ]);
        if (today.status === "fulfilled") {
          setTodayIssue(today.value.issue);
        }
        if (archive.status === "fulfilled") setArchiveIssues(archive.value.issues);
      }
      if (trigger === "regenerate") {
        setSelectedIssue(null);
        setSelectedArticle(null);
        setArticleResponse(null);
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Reader collection could not start.");
    } finally {
      setRegenerating(false);
    }
  };

  const selectArticle = async (issue: DailyIssue, article: ReaderArticleSummary) => {
    if (article.contentStatus !== "FULL_TEXT") return;
    await loadArticle(issue, article);
  };

  const enrichLocalSelection = useCallback(async (next: ReaderSelection, token: number) => {
    let ipa: string | null = null;
    let definitionPrimary: string | null = null;
    let definitionSecondary: string | null = null;
    try {
      if (next.singleWord) {
        await prefetchDictionary();
        const definition = getDefinitionForSurface(next.text);
        if (definition) {
          definitionPrimary = definition.primary;
          definitionSecondary = definition.secondary ?? null;
        }
      }
      ipa = await getIPA(next.text, pronunciationAccent);
    } catch {
      // Local pronunciation and dictionary extras stay empty.
    }
    if (selectionTokenRef.current !== token) return;
    setSelection((current) => {
      if (!current || current.text !== next.text) return current;
      return { ...current, ipa, definitionPrimary, definitionSecondary };
    });
  }, [pronunciationAccent]);

  /**
   * The shared cache identity for one Reader selection. Reader and normal SayIt
   * must resolve the same word to the same entry, so this stays the single
   * source of cache identity.
   */
  const selectionCacheIdentity = useCallback(
    (candidate: { text: string; context: string }) =>
      buildSayItCacheIdentity({
        selection: candidate.text,
        source: "reader",
        context: candidate.context,
      }),
    [],
  );

  const finalizeSelection = useCallback(() => {
    const content = articleContentRef.current;
    if (!content) return;
    ignoreSelectionChangeRef.current = true;
    const details = readReaderSelection(content);
    ignoreSelectionChangeRef.current = false;
    const token = ++selectionTokenRef.current;

    setSayItError(null);
    setSayItBusy(false);
    setReaderResultSaved(false);

    if (!details) {
      selectedExpressionForRetryRef.current = null;
      setSelection(null);
      setReaderSayItResult(null);
      setPassiveCacheResult(false);
      return;
    }

    const next: ReaderSelection = {
      ...details,
      ipa: null,
      definitionPrimary: null,
      definitionSecondary: null,
    };
    selectedExpressionForRetryRef.current = next;

    // A valid cache entry is already-known knowledge, not an API optimization:
    // surface the detailed SayIt result with the selection, before the first
    // popover render, and without writing History for the passive read.
    const cached = sayItCache.get(selectionCacheIdentity(next));
    setSelection(next);
    setReaderSayItResult(
      cached ? { input: next.text, result: cached } : null,
    );
    setPassiveCacheResult(Boolean(cached));
    void enrichLocalSelection(next, token);
  }, [enrichLocalSelection, sayItCache, selectionCacheIdentity]);

  const handleSelectionAction = async (requestedSelection = selection) => {
    if (!requestedSelection || !requestedSelection.text.trim()) return;
    const currentSelection = requestedSelection;
    // A new explicit action supersedes any pending one, and the token is bumped
    // again when Reader is deactivated so a late response cannot reopen the
    // popover while SayIt is on screen.
    const token = ++selectionTokenRef.current;
    selectedExpressionForRetryRef.current = currentSelection;
    setSayItError(null);
    setReaderResultSaved(false);

    const input = buildReaderInterpretationInput(
      currentSelection.text,
      currentSelection.context,
    );
    if (!input || input.length > MAX_INPUT_LENGTH) {
      setSayItError("Select a shorter expression so SayIt can include its article sentence.");
      return;
    }

    // A selection that already has a valid shared entry needs no provider call.
    const cached = sayItCache.get(selectionCacheIdentity(currentSelection));
    if (cached) {
      setReaderSayItResult({ input: currentSelection.text, result: cached });
      setPassiveCacheResult(false);
      if (cached.status === "success") {
        onSuccessfulSayIt(currentSelection.text, cached);
      }
      return;
    }

    setReaderSayItResult(null);
    setPassiveCacheResult(false);
    setSayItBusy(true);
    try {
      const resolved = await resolveSayItRequest({
        selection: currentSelection.text,
        source: "reader",
        contextText: currentSelection.context,
        requestInput: input,
        cache: sayItCache,
      });
      if (selectionTokenRef.current !== token) return;
      setReaderSayItResult({
        input: currentSelection.text,
        result: resolved.result,
      });
      if (resolved.result.status === "success") {
        onSuccessfulSayIt(currentSelection.text, resolved.result);
      }
    } catch (error) {
      if (selectionTokenRef.current !== token) return;
      setSayItError(
        error instanceof Error ? error.message : "SayIt could not interpret this selection.",
      );
    } finally {
      if (selectionTokenRef.current === token) {
        setSayItBusy(false);
      }
    }
  };

  const handleSaveReaderResult = useCallback(() => {
    if (!readerSayItResult || readerSayItResult.result.mode !== "retrieve") return;
    if (onSaveRetrieval(readerSayItResult.input, readerSayItResult.result)) {
      setReaderResultSaved(true);
    }
  }, [onSaveRetrieval, readerSayItResult]);

  const closeContextResult = useCallback(() => {
    setReaderSayItResult(null);
    setPassiveCacheResult(false);
    setReaderResultSaved(false);
    setSayItError(null);
    setSayItBusy(false);
    setSelection(null);
    window.requestAnimationFrame(() => articleBodyRef.current?.focus({ preventScroll: true }));
  }, []);

  /**
   * Leaving Reader dismisses its transient selection presentation.
   *
   * The popover is portaled into `document.body`, so without this it would stay
   * on screen over SayIt. The open article, its position, the shared result
   * cache and History are untouched. Bumping the selection token also
   * invalidates any in-flight local enrichment, and `inactiveRef` stops a
   * pending SayIt response from recreating the popup while SayIt is active.
   */
  useEffect(() => {
    inactiveRef.current = !active;
    if (active) return;
    selectionTokenRef.current += 1;
    setSelection(null);
    setReaderSayItResult(null);
    setPassiveCacheResult(false);
    setReaderResultSaved(false);
    setSayItBusy(false);
    setSayItError(null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (readerSayItResult || sayItError || selection) {
        closeContextResult();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [active, closeContextResult, readerSayItResult, sayItError, selection]);

  const closeArticle = () => {
    captureProgress();
    selectedArticleRef.current = null;
    setSelectedArticle(null);
    setArticleResponse(null);
    setArticleError(null);
    setSelection(null);
    setReaderSayItResult(null);
    setPassiveCacheResult(false);
    setSayItError(null);
    // Closing an article belongs to the issue it came from; the latest issue
    // goes back to the latest list rather than pinning an older date.
    if (selectedIssue && selectedIssue.localDate === (latestIssue?.date ?? calendarDate)) {
      setSelectedIssue(null);
    }
  };

  const uniqueArchiveIssues = useMemo(() => {
    const byDate = new Map<string, DailyIssue>();
    for (const issue of [todayIssue, ...archiveIssues]) {
      if (issue && !byDate.has(issue.localDate)) byDate.set(issue.localDate, issue);
    }
    return [...byDate.values()].sort((a, b) => b.localDate.localeCompare(a.localDate));
  }, [archiveIssues, todayIssue]);

  // Publish the Reading side of History to the shared drawer.
  useEffect(() => {
    onArchiveChange({
      todayIssue,
      archiveIssues: uniqueArchiveIssues,
      displayedIssue: selectedArticle ? selectedIssue ?? todayIssue : null,
      viewState,
      latestDate: latestIssue?.date ?? calendarDate,
      calendarDate,
    });
  }, [
    calendarDate,
    latestIssue,
    onArchiveChange,
    selectedArticle,
    selectedIssue,
    todayIssue,
    uniqueArchiveIssues,
    viewState,
  ]);

  // Opening a past article from History must load it here, without discarding
  // the reading progress or the Reader's own state.
  useImperativeHandle(
    ref,
    () => ({
      openArticle: (nextArticle: ReaderArticleSummary) => {
        const issue =
          uniqueArchiveIssues.find((candidate) =>
            candidate.articles.some((item) => item.id === nextArticle.id),
          ) ?? todayIssue;
        if (!issue) return;
        // Honour the reader's picked article: it may belong to the most recent
        // delivered issue rather than the latest scheduled one.
        const chosen =
          issue.articles.find((item) => item.id === nextArticle.id) ??
          issue.articles.find((item) => item.contentStatus === "FULL_TEXT") ??
          nextArticle;
        void loadArticle(issue, chosen);
      },
      showToday: () => {
        setSelectedIssue(null);
        setSelectedArticle(null);
        selectedArticleRef.current = null;
        setArticleResponse(null);
        setArticleError(null);
        setSelection(null);
        setReaderSayItResult(null);
        setPassiveCacheResult(false);
      },
    }),
    [loadArticle, todayIssue, uniqueArchiveIssues],
  );

  const selectedSourceUrl = safeExternalUrl(
    selectedArticle?.accessibleUrl || selectedArticle?.originalUrl,
  );
  const articleTitle = articleResponse?.article.title ?? selectedArticle?.title ?? "Article";
  const articleFkgl = articleResponse?.article.fkgl ?? selectedArticle?.fkgl ?? null;
  const articleProgressRatio = progress?.scrollRatio ?? 0;

  // The latest scheduled issue is the most recent date whose configured
  // collection time has passed; earlier issues stay plainly dated.
  const latestDate = latestIssue?.date ?? calendarDate;
  const latestDeliveredDate = latestIssue?.latestDeliveredDate ?? null;
  const isCurrentCalendarDate = (value: string | null) =>
    Boolean(value && calendarDate && value === calendarDate);
  const listDate = selectedIssue?.localDate ?? latestDate;
  const issueForDate = useCallback(
    (date: string | null): DailyIssue | null => {
      if (!date) return null;
      return (
        uniqueArchiveIssues.find((issue) => issue.localDate === date) ??
        (todayIssue?.localDate === date ? todayIssue : null)
      );
    },
    [todayIssue, uniqueArchiveIssues],
  );
  const browsingIssue = useMemo(
    () => issueForDate(listDate),
    [issueForDate, listDate],
  );
  const browsingArticles = (browsingIssue?.articles ?? []).filter(
    (article) => article.contentStatus === "FULL_TEXT",
  );
  // When the latest scheduled issue delivered nothing, the most recent issue
  // that did is offered right below it, plainly dated, so the reader is not left
  // on a dead end.
  const fallbackIssue =
    !selectedIssue && browsingArticles.length === 0 && latestDeliveredDate
      ? issueForDate(latestDeliveredDate)
      : null;
  const fallbackArticles = (fallbackIssue?.articles ?? []).filter(
    (article) => article.contentStatus === "FULL_TEXT",
  );
  const latestIssueNotice = (() => {
    if (selectedIssue || !latestIssue || latestIssue.delivered) return null;
    const date = formatDate(latestIssue.date);
    const status = activeAttempt && latestIssue.date === calendarDate
      ? "RUNNING"
      : latestIssue.occurrence?.status ?? null;
    switch (status) {
      case "RUNNING":
        return `Collection is in progress for ${date}.`;
      case "WAITING":
        return `Collection is pending for ${date}.`;
      case "RETRY_WAIT":
        return `Collection failed; a retry is scheduled for ${date}.`;
      case "EXHAUSTED":
        return `Collection attempts were exhausted for ${date}; no verified full-text articles were delivered.`;
      case "MISSED":
        return `The scheduled collection was missed for ${date}; no verified full-text articles were delivered.`;
      case "COMPLETED":
        return `Collection finished for ${date}, but no verified full-text articles were delivered.`;
      case "ALREADY_FULFILLED":
        return `No verified full-text articles are recorded for ${date}.`;
      default:
        if (latestIssue.date === calendarDate && todayAttemptCount === 0) {
          return `No collection occurrence or attempt is recorded for ${date}.`;
        }
        return `No collection occurrence is recorded for ${date}.`;
    }
  })();

  return (
    <main className="reader-main" hidden={!active} aria-label="SayIt Reader workspace">
      <div className="reader-shell">
        {workspaceError && (
          <div className="reader-alert" role="alert">
            <span>{workspaceError}</span>
            <button type="button" className="reader-text-button" onClick={() => void refreshWorkspace(false)}>
              Retry
            </button>
          </div>
        )}

        {!selectedArticle ? (
          <>
            <div className="reader-heading-row">
              <div>
                <p className="reader-eyebrow">
                  {isCurrentCalendarDate(listDate) && !selectedIssue
                    ? "Latest issue · Today"
                    : selectedIssue
                      ? "Earlier issue"
                      : "Latest issue"}
                </p>
                <h1>{listDate ? formatDate(listDate) : "Reading"}</h1>
              </div>
              <div className="reader-run-actions">
                {selectedIssue ? (
                  <button type="button" className="reader-text-button" onClick={() => setSelectedIssue(null)}>
                    Back to latest
                  </button>
                ) : browsingIssue?.status === "COMPLETE" ? (
                  <div className="reader-overflow">
                    <button
                      type="button"
                      className={`icon-button utility-action ${issueMenuOpen ? "is-active" : ""}`}
                      aria-label="Issue actions"
                      aria-haspopup="menu"
                      aria-expanded={issueMenuOpen}
                      disabled={regenerating || Boolean(activeAttempt)}
                      onClick={() => setIssueMenuOpen((open) => !open)}
                    >
                      <svg aria-hidden="true" className="action-icon" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="3.25" cy="8" r="1.15" />
                        <circle cx="8" cy="8" r="1.15" />
                        <circle cx="12.75" cy="8" r="1.15" />
                      </svg>
                    </button>
                    {issueMenuOpen && (
                      <div className="reader-overflow-menu" role="menu" aria-label="Issue actions">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIssueMenuOpen(false);
                            setShowRegenerateConfirmation(true);
                          }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="reader-text-button"
                    disabled={regenerating || Boolean(activeAttempt)}
                    onClick={() => void beginRun("manual")}
                  >
                    {activeAttempt ? "Collecting…" : "Collect now"}
                  </button>
                )}
              </div>
            </div>

            {showRegenerateConfirmation && (
              <div className="reader-confirmation" role="group" aria-label="Confirm regenerate issue">
                <div>
                  <strong>Replace this collection?</strong>
                  <p>Reader will create a new edition and keep earlier articles and reading progress in the archive.</p>
                </div>
                <div className="reader-inline-actions">
                  <button type="button" className="reader-text-button" onClick={() => setShowRegenerateConfirmation(false)}>
                    Keep current issue
                  </button>
                  <button type="button" className="reader-primary-button" disabled={regenerating} onClick={() => void beginRun("regenerate")}>
                    Confirm Regenerate
                  </button>
                </div>
              </div>
            )}

            {activeAttempt && (selectedIssue || latestIssue?.date !== calendarDate) && (
              <p className="reader-quiet-status" role="status">
                Collection is in progress for {calendarDate ? formatDate(calendarDate) : "today"}.
              </p>
            )}

            {resumableArticle && browsingArticles.some((article) => article.id === resumableArticle.id) && (
              <button
                type="button"
                className="reader-resume-bookmark"
                onClick={() => {
                  const issue = browsingIssue;
                  if (issue) resumeBookmarkedArticle(issue, resumableArticle);
                }}
              >
                Continue where you left off: {resumableArticle.title}
              </button>
            )}

            {latestIssueNotice && (
              <p className="reader-quiet-status" role="status">
                {`${latestIssueNotice}${fallbackIssue ? ` Showing articles from ${formatDate(fallbackIssue.localDate)} below.` : ""}`}
              </p>
            )}

            {workspaceLoading ? (
              <div className="reader-empty-state" role="status">Loading today’s reading…</div>
            ) : browsingArticles.length > 0 && browsingIssue ? (
              <ul className="reader-article-list" aria-label={`${browsingIssue.localDate} articles`}>
                {browsingArticles
                  .map((article) => (
                    <ArticleListItem
                      key={article.id}
                      article={article}
                      issue={browsingIssue}
                      onOpen={selectArticle}
                    />
                  ))}
              </ul>
            ) : fallbackIssue && fallbackArticles.length > 0 ? (
              <>
                <p className="reader-eyebrow">
                  Most recent delivered issue · {formatDate(fallbackIssue.localDate)}
                </p>
                <ul className="reader-article-list" aria-label={`${fallbackIssue.localDate} articles`}>
                  {fallbackArticles.map((article) => (
                    <ArticleListItem
                      key={article.id}
                      article={article}
                      issue={fallbackIssue}
                      onOpen={selectArticle}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <div className="reader-empty-state">
                <p>Nothing ready to read yet.</p>
              </div>
            )}

          </>
        ) : (
          <>
            <div className="reader-article-toolbar reader-article-toolbar--sticky">
              <button className="reader-back-button" type="button" onClick={closeArticle} aria-label="Back to reading list">
                <span aria-hidden="true">←</span> {selectedIssue ? formatDate(selectedIssue.localDate) : "Latest issue"}
              </button>
              <span className="reader-article-position">
                {progress ? `${Math.round(articleProgressRatio * 100)}% read` : "Reading"}
              </span>
            </div>
            <article
              className="reader-article"
              ref={articleContentRef}
              aria-labelledby="reader-article-title"
              onMouseUp={() => finalizeSelection()}
              onKeyUp={(event) => {
                if (event.key === "Escape") return;
                finalizeSelection();
              }}
            >
              <header className="reader-article-header">
                <p className="reader-eyebrow">{selectedArticle.originalPublication || selectedArticle.accessiblePublication}</p>
                <h1 id="reader-article-title" data-reader-selectable="title">{articleTitle}</h1>
                <div className="reader-article-meta">
                  <span>{formatReadingMinutes(articleResponse?.article.readingMinutes ?? selectedArticle.readingMinutes)}</span>
                  <span>
                    {articleResponse?.article.difficulty ??
                      selectedArticle.difficulty ??
                      (typeof articleFkgl === "number" ? difficultyForGrade(articleFkgl) : "Difficulty unavailable")}
                  </span>
                </div>
                <SourceAttribution article={articleResponse?.article ?? selectedArticle} />
              </header>

              {articleLoading ? (
                <div className="reader-empty-state" role="status">Opening verified article…</div>
              ) : paragraphs && paragraphs.length > 0 ? (
                <section
                  className="reader-article-body"
                  ref={articleBodyRef}
                  tabIndex={-1}
                  aria-label="Article text. Select a word, phrase, or sentence to use SayIt."
                >
                  {paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 20)}`} data-reader-paragraph={index} data-reader-selectable="body">
                      {paragraph}
                    </p>
                  ))}
                </section>
              ) : (
                <div className="reader-unavailable-body" role="status">
                  <strong>{articleError ?? "Full text is not available in Reader."}</strong>
                  <p>This item is not counted as an in-app full-text article while its verified body is unavailable.</p>
                  {selectedSourceUrl && (
                    <a href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">
                      Open publisher page <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </div>
              )}
            </article>

            {selection && (
              <ReaderSelectionPopover
                selection={selection}
                busy={sayItBusy}
                error={sayItError}
                result={readerSayItResult}
                resultSaved={readerResultSaved}
                passiveCacheResult={passiveCacheResult}
                speaking={speakingKey === READER_SPEECH_KEY}
                speakError={pronunciationErrorKey === READER_SPEECH_KEY}
                pronunciationError={pronunciationError}
                copied={copiedLabel === READER_COPY_LABEL}
                ipaByKey={readerIpaByKey}
                renderSayItResult={renderSayItResult}
                onSaveResult={handleSaveReaderResult}
                onSpeak={() => onSpeak(selection.text, READER_SPEECH_KEY)}
                onCopy={() => void onCopy(selection.text, READER_COPY_LABEL)}
                onSayIt={(requested) =>
                  void handleSelectionAction(requested ?? selection)
                }
                onRetry={() =>
                  void handleSelectionAction(
                    selectedExpressionForRetryRef.current ?? selection,
                  )
                }
                onClose={closeContextResult}
              />
            )}
          </>
        )}
      </div>
      {preferencesOpen && (
        <div className="drawer-layer" role="presentation" onMouseDown={() => onClosePreferences?.()}>
          <aside
            className="saved-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Reading preferences"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Reader</p>
                <h2>Reading preferences</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close reading preferences" onClick={() => onClosePreferences?.()}>
                ×
              </button>
            </div>
            <form
              className="reader-preferences-form"
              onSubmit={(event) => {
                event.preventDefault();
                void savePreferences();
              }}
            >
              <label className="reader-field reader-field--wide">
                <span>Topics</span>
                <input
                  value={topicDraft}
                  onChange={(event) => setTopicDraft(event.target.value)}
                  aria-label="Reading topics, comma separated"
                  placeholder="Technology, Economy"
                />
                <small>Separate topics with commas.</small>
              </label>
              <label className="reader-field">
                <span>Articles each day</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={preferences.dailyArticleCount}
                  onChange={(event) => setPreferences({ ...preferences, dailyArticleCount: Number(event.target.value) })}
                />
              </label>
              <label className="reader-field">
                <span>Difficulty</span>
                <select
                  value={preferences.difficulty}
                  onChange={(event) => setPreferences({ ...preferences, difficulty: event.target.value as ReaderDifficulty })}
                >
                  <option>Easy</option>
                  <option>Intermediate</option>
                  <option>Advanced</option>
                </select>
              </label>
              <label className="reader-field">
                <span>Reading budget (minutes)</span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={preferences.readingBudgetMinutes}
                  onChange={(event) => setPreferences({ ...preferences, readingBudgetMinutes: Number(event.target.value) })}
                />
              </label>
              <label className="reader-field">
                <span>Collection time</span>
                <input
                  type="time"
                  value={preferences.collectionTime}
                  onChange={(event) => setPreferences({ ...preferences, collectionTime: event.target.value })}
                />
              </label>
              <label className="reader-field reader-field--wide">
                <span>Time zone</span>
                <input
                  value={preferences.timezone}
                  onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}
                  aria-label="IANA time zone"
                  placeholder="Asia/Shanghai"
                />
              </label>
              <div className="reader-preferences-footer">
                <span role="status">{preferenceNotice}</span>
                <button className="reader-secondary-button" type="submit" disabled={savingPreferences}>
                  {savingPreferences ? "Saving…" : "Save preferences"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </main>
  );
});

interface ReaderSelectionPopoverProps {
  selection: ReaderSelection;
  busy: boolean;
  error: string | null;
  result: { input: string; result: SayItResult } | null;
  resultSaved: boolean;
  /** The detailed result came from a passive cache read, not a SayIt press. */
  passiveCacheResult: boolean;
  speaking: boolean;
  speakError: boolean;
  pronunciationError: string | null;
  copied: boolean;
  ipaByKey: Record<string, string>;
  renderSayItResult: ReaderWorkspaceProps["renderSayItResult"];
  onSaveResult: () => void;
  onSpeak: () => void;
  onCopy: () => void;
  onSayIt: (requested?: ReaderSelection) => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Compact, document-anchored Reader selection surface.
 *
 * The anchor is a document-space coordinate pair, so the popover travels with
 * the selected text instead of staying pinned to the viewport. It renders into
 * document.body so no reader ancestor can clip it, and it deliberately has no
 * internal scroll container: long results grow and the page scrolls.
 */
function ReaderSelectionPopover({
  selection,
  busy,
  error,
  result,
  resultSaved,
  passiveCacheResult,
  speaking,
  speakError,
  pronunciationError,
  copied,
  ipaByKey,
  renderSayItResult,
  onSaveResult,
  onSpeak,
  onCopy,
  onSayIt,
  onRetry,
  onClose,
}: ReaderSelectionPopoverProps) {
  return createPortal(
    <aside
      className={`reader-selection-popover${busy ? " is-busy" : ""}`}
      style={{ left: selection.left, top: selection.top }}
      aria-live="polite"
      aria-label="Selection"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="reader-popover-term">
        <strong>{selection.text}</strong>
        <button
          type="button"
          className="reader-icon-close"
          aria-label="Close selection"
          title="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="reader-popover-actions">
        {selection.ipa ? (
          <span className="reader-popover-ipa">{selection.ipa}</span>
        ) : (
          <span className="reader-popover-ipa reader-popover-ipa--empty" aria-hidden="true" />
        )}
        <div className="reader-popover-buttons">
          <SpeakButton
            text={selection.text}
            label={selection.text}
            speaking={speaking}
            error={speakError}
            onSpeak={onSpeak}
            speechKey={READER_SPEECH_KEY}
          />
          <CopyButton label={selection.text} copied={copied} onCopy={onCopy} />
          {!result && (
            <SayItButton
              label={`SayIt: ${selection.singleWord ? "word" : "selected expression"} ${selection.text}`}
              busy={busy}
              onSayIt={() => onSayIt()}
            />
          )}
        </div>
      </div>

      {!result && selection.singleWord && selection.definitionPrimary && (
        <div className="reader-popover-local">
          <p className="reader-popover-definition">{selection.definitionPrimary}</p>
          {selection.definitionSecondary && (
            <p className="reader-popover-definition reader-popover-definition--secondary">
              {selection.definitionSecondary}
            </p>
          )}
        </div>
      )}

      {busy && (
        <p className="reader-selection-status" role="status">
          Interpreting in this article…
        </p>
      )}
      {passiveCacheResult && !busy && !error && (
        <p className="reader-selection-status" role="status">
          Already explained — from your saved SayIt results.
        </p>
      )}
      {error && (
        <p className="reader-inline-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="reader-selection-result">
          {renderSayItResult(
            result.result,
            result.input,
            resultSaved,
            onSaveResult,
            ipaByKey,
            onRetry,
          )}
        </div>
      )}

      {speakError && pronunciationError && (
        <p className="reader-inline-error" role="status">
          {pronunciationError}
        </p>
      )}
    </aside>,
    document.body,
  );
}

function ArticleListItem({
  article,
  issue,
  onOpen,
}: {
  article: ReaderArticleSummary;
  issue: DailyIssue;
  onOpen: (issue: DailyIssue, article: ReaderArticleSummary) => void;
}) {
  return (
    <li className="reader-article-list-item">
      <button className="reader-article-open" type="button" onClick={() => void onOpen(issue, article)}>
        <ArticleSummary article={article} />
      </button>
    </li>
  );
}

function ArticleSummary({ article }: { article: ReaderArticleSummary }) {
  return (
    <>
      <span className="reader-article-title">{article.title}</span>
      <span className="reader-article-byline">
        {article.originalPublication || article.accessiblePublication || "Publisher unknown"}
        {` · ${formatReadingMinutes(article.readingMinutes)}`}
        {article.difficulty ? ` · ${article.difficulty}` : ""}
      </span>
    </>
  );
}

function SourceAttribution({ article }: { article: ReaderArticleSummary }) {
  const accessibleUrl = safeExternalUrl(article.accessibleUrl);
  const originalUrl = safeExternalUrl(article.originalUrl);
  const originalSameAsAccessible =
    article.originalUrl === article.accessibleUrl &&
    article.originalPublication.toLocaleLowerCase() ===
      article.accessiblePublication.toLocaleLowerCase();
  return (
    <div className="reader-source-attribution">
      <span>
        Original: {article.originalPublication || "Publication unknown"}
        {originalUrl && (
          <> · <a href={originalUrl} target="_blank" rel="noopener noreferrer">source</a></>
        )}
      </span>
      {!originalSameAsAccessible && (
        <span>
          Accessible version: {article.accessiblePublication || "not verified"}
          {accessibleUrl && (
            <> · <a href={accessibleUrl} target="_blank" rel="noopener noreferrer">open source</a></>
          )}
        </span>
      )}
    </div>
  );
}

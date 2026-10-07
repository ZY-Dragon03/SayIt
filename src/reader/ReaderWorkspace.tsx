import {
  useCallback,
  useEffect,
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
} from "./types";

const READER_POINTER_KEY = "sayit.reader.last-opened.v1";
const READER_SPEECH_KEY = "reader-selection";
const READER_COPY_LABEL = "Reader selection";
const ARCHIVE_LIMIT = 60;
const PROGRESS_SAVE_DELAY_MS = 500;
const SCROLL_ANCHOR_PX = 128;
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
  archiveOpen?: boolean;
  onClosePreferences?: () => void;
  onCloseArchive?: () => void;
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

function readProgressLabel(state: ReaderArticleSummary["readState"]): string {
  if (state === "READ") return "read";
  if (state === "IN_PROGRESS") return "in progress";
  return "unread";
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

export function ReaderWorkspace({
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
  renderSayItResult,
  onSaveRetrieval,
  preferencesOpen = false,
  archiveOpen = false,
  onClosePreferences,
  onCloseArchive,
}: ReaderWorkspaceProps) {
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultPreferences);
  const [topicDraft, setTopicDraft] = useState("Politics, Economy, Finance, Geopolitics, Technology");
  const [todayIssue, setTodayIssue] = useState<DailyIssue | null>(null);
  const [archiveIssues, setArchiveIssues] = useState<DailyIssue[]>([]);
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
  const readerScrollRef = useRef(0);

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

  const displayedIssue = selectedIssue ?? todayIssue;  const issueArticles = displayedIssue?.articles ?? [];
  const paragraphs = articleResponse?.paragraphs ?? null;

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
      const pointer = readPointer();
      if (pointer) {
        const matchingIssue =
          [nextToday, ...nextArchive].find(
            (issue): issue is DailyIssue =>
              issue !== null &&
              (issue.id === pointer.issueId || issue.localDate === pointer.localDate),
          ) ?? null;
        if (matchingIssue) {
          if (matchingIssue.edition === pointer.edition) {
            setSelectedIssue(matchingIssue);
            setSelectedArticle(pointer.article);
            restorePendingRef.current = true;
            void loadArticle(matchingIssue, pointer.article);
          } else {
            void getReaderEdition(matchingIssue.id, pointer.edition)
              .then(({ issue }) => {
                setSelectedIssue(issue);
                setSelectedArticle(pointer.article);
                restorePendingRef.current = true;
                void loadArticle(issue, pointer.article);
              })
              .catch((error) => {
                setWorkspaceError(
                  error instanceof Error
                    ? error.message
                    : "The previous Reader edition could not be restored.",
                );
              });
          }
        }
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

  useLayoutEffect(() => {
    if (!active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        void flushProgressWrites().catch(() => undefined);
      }
      return;
    }
    const alreadyReading = Boolean(selectedArticleRef.current && articleBodyRef.current);
    wasActiveRef.current = true;
    if (alreadyReading) {
      window.scrollTo({ top: readerScrollRef.current, behavior: "auto" });
      return;
    }
    void refreshWorkspace(true);
  }, [active, flushProgressWrites, refreshWorkspace]);

  const loadArticle = useCallback(async (issue: DailyIssue, summary: ReaderArticleSummary) => {
    setSelectedIssue(issue);
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
      const response = await getReaderArticle(summary.id, issue.edition);
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
      setReaderSayItResult({
        input: currentSelection.text,
        result: resolved.result,
      });
      if (resolved.result.status === "success") {
        onSuccessfulSayIt(currentSelection.text, resolved.result);
      }
    } catch (error) {
      setSayItError(
        error instanceof Error ? error.message : "SayIt could not interpret this selection.",
      );
    } finally {
      setSayItBusy(false);
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
  };

  const selectArchiveIssue = (issue: DailyIssue) => {
    onCloseArchive?.();
    setSelectedIssue(issue);
    setSelectedArticle(null);
    setArticleResponse(null);
    setSelection(null);
    setReaderSayItResult(null);
    setPassiveCacheResult(false);
  };

  const selectPriorEdition = async (issue: DailyIssue, edition: number) => {
    setWorkspaceError(null);
    try {
      const response = await getReaderEdition(issue.id, edition);
      setSelectedIssue(response.issue);
      setSelectedArticle(null);
      setArticleResponse(null);
      setSelection(null);
      setReaderSayItResult(null);
      setPassiveCacheResult(false);
      onCloseArchive?.();
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "That archive edition could not be opened.",
      );
    }
  };

  const uniqueArchiveIssues = useMemo(() => {
    const byDate = new Map<string, DailyIssue>();
    for (const issue of [todayIssue, ...archiveIssues]) {
      if (issue && !byDate.has(issue.localDate)) byDate.set(issue.localDate, issue);
    }
    return [...byDate.values()].sort((a, b) => b.localDate.localeCompare(a.localDate));
  }, [archiveIssues, todayIssue]);

  const selectedSourceUrl = safeExternalUrl(
    selectedArticle?.accessibleUrl || selectedArticle?.originalUrl,
  );
  const articleTitle = articleResponse?.article.title ?? selectedArticle?.title ?? "Article";
  const articleFkgl = articleResponse?.article.fkgl ?? selectedArticle?.fkgl ?? null;
  const articleProgressRatio = progress?.scrollRatio ?? 0;

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
                <h1>{selectedIssue ? formatDate(selectedIssue.localDate) : "Today"}</h1>
              </div>
              <div className="reader-run-actions">
                {selectedIssue ? (
                  <button type="button" className="reader-text-button" onClick={() => setSelectedIssue(null)}>
                    Today
                  </button>
                ) : todayIssue?.status === "COMPLETE" ? (
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
                  <strong>Replace today’s collection?</strong>
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

            {displayedIssue && displayedIssue.status !== "COMPLETE" && (
              <p className="reader-quiet-status">
                {displayedIssue.actual.count} of {displayedIssue.target.dailyArticleCount} ready
              </p>
            )}
            {activeAttempt && <p className="reader-quiet-status">Collecting</p>}

            {workspaceLoading ? (
              <div className="reader-empty-state" role="status">Loading today’s reading…</div>
            ) : displayedIssue && displayedIssue.articles.some((article) => article.contentStatus === "FULL_TEXT") ? (
              <ul className="reader-article-list" aria-label={`${displayedIssue.localDate} articles`}>
                {displayedIssue.articles
                  .filter((article) => article.contentStatus === "FULL_TEXT")
                  .map((article) => (
                    <ArticleListItem
                      key={article.id}
                      article={article}
                      issue={displayedIssue}
                      onOpen={selectArticle}
                    />
                  ))}
              </ul>
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
                <span aria-hidden="true">←</span> {selectedIssue?.localDate === todayIssue?.localDate ? "Today" : selectedIssue ? formatDate(selectedIssue.localDate) : "Reading list"}
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
      {archiveOpen && (
        <div className="drawer-layer history-layer" role="presentation" onMouseDown={() => onCloseArchive?.()}>
          <aside
            className="saved-drawer history-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Reader archive"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Earlier reading</p>
                <h2>History</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close reader history" onClick={() => onCloseArchive?.()}>
                ×
              </button>
            </div>
            {uniqueArchiveIssues.length > 0 ? (
              <ul className="reader-archive-list">
                {uniqueArchiveIssues.map((issue) => (
                  <li key={`${issue.id}-${issue.edition}`}>
                    <button
                      type="button"
                      className="reader-archive-date"
                      onClick={() => {
                        if (issue.id === todayIssue?.id && issue.edition === todayIssue.edition) {
                          setSelectedIssue(null);
                          onCloseArchive?.();
                          return;
                        }
                        selectArchiveIssue(issue);
                      }}
                    >
                      <span>{formatDate(issue.localDate)}</span>
                      <span>
                        {issue.articles.length > 0
                          ? issue.articles
                              .map((article) => `${article.title} · ${readProgressLabel(article.readState)}`)
                              .join(" · ")
                          : "No delivered articles"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="drawer-empty">
                <p>Earlier Daily Issues will collect here.</p>
              </div>
            )}
            {displayedIssue?.priorEditions?.length ? (
              <section className="reader-prior-editions" aria-label="Earlier editions">
                <h3>Earlier editions</h3>
                <ul className="reader-archive-list">
                  {displayedIssue.priorEditions
                    .slice()
                    .sort((a, b) => b - a)
                    .map((edition) => (
                      <li key={edition}>
                        <button
                          type="button"
                          className="reader-archive-date"
                          onClick={() => void selectPriorEdition(displayedIssue, edition)}
                        >
                          <span>Edition {edition}</span>
                          <span>{formatDate(displayedIssue.localDate)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}

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

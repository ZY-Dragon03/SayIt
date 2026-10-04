import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  apiErrorSchema,
  isSuccessfulResult,
  MAX_INPUT_LENGTH,
  sayItResultSchema,
  type SayItResult,
} from "../shared/contract";
import { getDefinitionForSurface, prefetchDictionary } from "../lib/local-dictionary";
import { getIPA, getIPACacheKey } from "../lib/ipa";
import type { PronunciationAccent } from "../lib/pronunciation";
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
  findContainingSentence,
  isSingleWordSelection,
} from "./selection";
import type {
  ArticleProgress,
  DailyIssue,
  ReaderArticleResponse,
  ReaderArticleSummary,
  ReaderContentStatus,
  ReaderDifficulty,
  ReaderPreferences,
  RunAttempt,
} from "./types";

const READER_POINTER_KEY = "sayit.reader.last-opened.v1";
const ARCHIVE_LIMIT = 60;
const PROGRESS_SAVE_DELAY_MS = 500;
const SCROLL_ANCHOR_PX = 128;

interface ReaderPointer {
  issueId: string;
  localDate: string;
  articleId: string;
  edition: number;
  article: ReaderArticleSummary;
}

interface ReaderSelection {
  text: string;
  sentence: string;
  singleWord: boolean;
  left: number;
  top: number;
}

interface LocalWordResult {
  surface: string;
  primary: string;
  secondary?: string;
  ipa: string | null;
}

export interface ReaderWorkspaceProps {
  active: boolean;
  pronunciationAccent: PronunciationAccent;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  pronunciationError: string | null;
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

function contentStatusLabel(status: ReaderContentStatus): string {
  switch (status) {
    case "FULL_TEXT":
      return "Full text in Reader";
    case "EXTERNAL_ONLY":
      return "External reading";
    case "SUMMARY":
      return "Summary only";
    case "UNAVAILABLE":
      return "Source unavailable";
  }
}

function issueStatusLabel(status: DailyIssue["status"] | null): string {
  if (status === "COMPLETE") return "Complete";
  if (status === "PARTIAL") return "Partial";
  return "Not delivered";
}

function formatReadingMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return "Reading time unavailable";
  }
  return `${minutes.toFixed(1)} min · estimated`;
}

function cachePermissionLabel(permission: ReaderArticleSummary["cachePermission"]): string {
  if (permission === "PERMITTED") return "Offline copy permitted";
  if (permission === "NOT_PERMITTED") return "Offline copy not permitted";
  return "Offline copy permission unknown";
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

function issueSummary(issue: DailyIssue | null): string {
  if (!issue) return "No Daily Issue has been delivered for today.";
  const timeText = `${issue.actual.readingMinutes.toFixed(1)} min of ${issue.target.readingBudgetMinutes} min`;
  return `${issue.actual.count} of ${issue.target.dailyArticleCount} articles · ${timeText}`;
}

function findSelectionDetails(articleBody: HTMLElement): ReaderSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const text = selection.toString().trim().replace(/\s+/gu, " ");
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!text || !range) return null;

  const startNode = range.startContainer;
  const startElement =
    startNode.nodeType === Node.ELEMENT_NODE
      ? (startNode as Element)
      : startNode.parentElement;
  const paragraph = startElement?.closest<HTMLElement>("[data-reader-paragraph]");
  if (!paragraph || !articleBody.contains(paragraph)) return null;

  const sentence = findContainingSentence(paragraph.textContent ?? "", text);
  const rect = range.getBoundingClientRect();
  return {
    text,
    sentence,
    singleWord: isSingleWordSelection(text),
    left: Math.min(Math.max(rect.left, 12), window.innerWidth - 150),
    top: Math.max(12, rect.top - 44),
  };
}

function readApiError(payload: unknown): string | null {
  const parsed = apiErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.message : null;
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
  onCopy,
  onSpeak,
  onSuccessfulSayIt,
  renderSayItResult,
  onSaveRetrieval,
}: ReaderWorkspaceProps) {
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultPreferences);
  const [topicDraft, setTopicDraft] = useState("Politics, Economy, Finance, Geopolitics, Technology");
  const [todayIssue, setTodayIssue] = useState<DailyIssue | null>(null);
  const [occurrence, setOccurrence] = useState<Awaited<ReturnType<typeof getTodayIssue>>["occurrence"]>(null);
  const [attempts, setAttempts] = useState<RunAttempt[]>([]);
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
  const [readerIpaByKey, setReaderIpaByKey] = useState<Record<string, string>>({});
  const [localWordResult, setLocalWordResult] = useState<LocalWordResult | null>(null);
  const [localWordLoading, setLocalWordLoading] = useState(false);
  const [progress, setProgress] = useState<ArticleProgress | null>(null);

  const articleBodyRef = useRef<HTMLElement>(null);
  const lastProgressRef = useRef<ArticleProgress | null>(null);
  const selectedIssueRef = useRef<DailyIssue | null>(null);
  const selectedArticleRef = useRef<ReaderArticleSummary | null>(null);
  const selectedExpressionForRetryRef = useRef<ReaderSelection | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const restorePendingRef = useRef(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    selectedIssueRef.current = selectedIssue;
  }, [selectedIssue]);
  useEffect(() => {
    selectedArticleRef.current = selectedArticle;
  }, [selectedArticle]);

  const displayedIssue = selectedIssue ?? todayIssue;
  const issueArticles = displayedIssue?.articles ?? [];
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
      setOccurrence(todayResult.value.occurrence);
      setAttempts(todayResult.value.attempts);
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
    if (!active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        if (progressTimerRef.current !== null) {
          window.clearTimeout(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        const pending = lastProgressRef.current;
        if (pending) void putReaderProgress(pending).catch(() => undefined);
      }
      return;
    }
    wasActiveRef.current = true;
    void refreshWorkspace(true);
  }, [active, refreshWorkspace]);

  const loadArticle = useCallback(async (issue: DailyIssue, summary: ReaderArticleSummary) => {
    setSelectedIssue(issue);
    setSelectedArticle(summary);
    setArticleResponse(null);
    setArticleError(null);
    setArticleLoading(true);
    setSelection(null);
    setReaderSayItResult(null);
    setLocalWordResult(null);
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
  }, []);

  useEffect(() => {
    if (!active || !activeAttempt || !isActiveAttempt(activeAttempt)) return;
    const timer = window.setInterval(() => {
      void getReaderRun(activeAttempt.id)
        .then(({ attempt, issue }) => {
          setActiveAttempt(isActiveAttempt(attempt) ? attempt : null);
          setAttempts((current) => [attempt, ...current.filter((item) => item.id !== attempt.id)]);
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
      void putReaderProgress(nextProgress).catch((error) => {
        setWorkspaceError(error instanceof Error ? error.message : "Reading position could not be saved.");
      });
    }, PROGRESS_SAVE_DELAY_MS);
  }, []);

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
    if (!active || !selectedArticle || !articleBodyRef.current) return;
    const updateSelection = () => {
      const body = articleBodyRef.current;
      if (!body) return;
      const next = findSelectionDetails(body);
      setSelection(next);
    };
    document.addEventListener("selectionchange", updateSelection);
    return () => document.removeEventListener("selectionchange", updateSelection);
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
      const { attempt, issue } = await startReaderRun(trigger);
      setAttempts((current) => [attempt, ...current.filter((item) => item.id !== attempt.id)]);
      setActiveAttempt(isActiveAttempt(attempt) ? attempt : null);
      if (issue) setTodayIssue(issue);
      if (!isActiveAttempt(attempt)) {
        const [today, archive] = await Promise.allSettled([
          getTodayIssue(),
          getReaderArchive(ARCHIVE_LIMIT),
        ]);
        if (today.status === "fulfilled") {
          setTodayIssue(today.value.issue);
          setOccurrence(today.value.occurrence);
          setAttempts(today.value.attempts);
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

  const handleSelectionAction = async (requestedSelection = selection) => {
    if (!requestedSelection || !requestedSelection.text.trim()) return;
    const currentSelection = requestedSelection;
    selectedExpressionForRetryRef.current = currentSelection;
    setSelection(null);
    setSayItError(null);
    setReaderSayItResult(null);
    setReaderResultSaved(false);
    setLocalWordResult(null);
    setSayItBusy(true);
    try {
      if (currentSelection.singleWord) {
        await prefetchDictionary();
        const definition = getDefinitionForSurface(currentSelection.text);
        if (definition) {
          const ipa = await getIPA(currentSelection.text, pronunciationAccent);
          setLocalWordResult({
            surface: currentSelection.text,
            primary: definition.primary,
            secondary: definition.secondary,
            ipa,
          });
          return;
        }
      }

      const input = buildReaderInterpretationInput(
        currentSelection.text,
        currentSelection.sentence,
      );
      if (!input || input.length > MAX_INPUT_LENGTH) {
        setSayItError("Select a shorter expression so SayIt can include its article sentence.");
        return;
      }
      const response = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, context: [] }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSayItError(
          readApiError(payload) ?? "SayIt could not interpret this selection.",
        );
        return;
      }
      const parsed = sayItResultSchema.safeParse(payload);
      if (!parsed.success) {
        setSayItError("SayIt returned an invalid result for this selection.");
        return;
      }
      setReaderSayItResult({ input, result: parsed.data });
      if (isSuccessfulResult(parsed.data)) {
        onSuccessfulSayIt(input, parsed.data);
      } else if (parsed.data.status === "success") {
        onSuccessfulSayIt(input, parsed.data);
      }
    } catch (error) {
      setSayItError(error instanceof Error ? error.message : "SayIt could not interpret this selection.");
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
    setReaderResultSaved(false);
    setLocalWordResult(null);
    setSayItError(null);
    setSelection(null);
    window.requestAnimationFrame(() => articleBodyRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!active) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (readerSayItResult || localWordResult || sayItError || selection) {
        closeContextResult();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [active, closeContextResult, localWordResult, readerSayItResult, sayItError, selection]);

  const closeArticle = () => {
    captureProgress();
    setSelectedArticle(null);
    setArticleResponse(null);
    setArticleError(null);
    setSelection(null);
    setReaderSayItResult(null);
    setLocalWordResult(null);
    setSayItError(null);
  };

  const selectArchiveIssue = (issue: DailyIssue) => {
    setSelectedIssue(issue);
    setSelectedArticle(null);
    setArticleResponse(null);
    setSelection(null);
    setReaderSayItResult(null);
    setLocalWordResult(null);
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
      setLocalWordResult(null);
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
  const olderArchiveIssues = uniqueArchiveIssues.filter(
    (issue) => issue.localDate !== todayIssue?.localDate,
  );

  const selectedSourceUrl = safeExternalUrl(
    selectedArticle?.accessibleUrl || selectedArticle?.originalUrl,
  );
  const articleTitle = articleResponse?.article.title ?? selectedArticle?.title ?? "Article";
  const articleStatus = articleResponse?.article.contentStatus ?? selectedArticle?.contentStatus;
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
                <p className="reader-eyebrow">Your English reading</p>
                <h1>{selectedIssue ? formatDate(selectedIssue.localDate) : "Today"}</h1>
                <p className="reader-muted">
                  {selectedIssue
                    ? `Daily Issue · edition ${selectedIssue.edition}`
                    : "A small collection, chosen for your preferences."}
                </p>
              </div>
              <div className="reader-run-actions">
                {selectedIssue ? (
                  <button type="button" className="reader-secondary-button" onClick={() => setSelectedIssue(null)}>
                    Today
                  </button>
                ) : todayIssue?.status === "COMPLETE" ? (
                  <button
                    type="button"
                    className="reader-secondary-button"
                    disabled={regenerating || Boolean(activeAttempt)}
                    onClick={() => setShowRegenerateConfirmation(true)}
                  >
                    Regenerate
                  </button>
                ) : !selectedIssue ? (
                  <button
                    type="button"
                    className="reader-primary-button"
                    disabled={regenerating || Boolean(activeAttempt)}
                    onClick={() => void beginRun("manual")}
                  >
                    {activeAttempt ? "Collecting…" : "Run now"}
                  </button>
                ) : null}
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

            <div className="reader-issue-summary" aria-live="polite">
              <span className={`reader-status reader-status--${(displayedIssue?.status ?? "NOT_DELIVERED").toLowerCase()}`}>
                {issueStatusLabel(displayedIssue?.status ?? null)}
              </span>
              <span>{issueSummary(displayedIssue)}</span>
              {!selectedIssue && occurrence && (
                <span className="reader-occurrence-state">
                  {occurrence.status.toLowerCase().replaceAll("_", " ")} · {occurrence.localTime} {occurrence.timezone}
                </span>
              )}
            </div>

            {displayedIssue?.unmetConstraints?.length ? (
              <p className="reader-shortage">Still looking for: {displayedIssue.unmetConstraints.join(" · ")}</p>
            ) : null}

            {workspaceLoading ? (
              <div className="reader-empty-state" role="status">Loading today’s reading…</div>
            ) : displayedIssue && displayedIssue.articles.length > 0 ? (
              <ul className="reader-article-list" aria-label={`${displayedIssue.localDate} articles`}>
                {displayedIssue.articles.map((article) => (
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
                <span aria-hidden="true">✦</span>
                <p>{displayedIssue ? "No verified full-text articles are in this issue." : "Your reading list will appear after the first collection."}</p>
                {!displayedIssue && !workspaceLoading && <span>Use Run now to collect from your saved preferences.</span>}
              </div>
            )}

            {displayedIssue?.priorEditions?.length ? (
              <details className="reader-prior-editions">
                <summary>Earlier editions</summary>
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
                          <span>Open archived articles</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}

            <details className="reader-preferences">
              <summary>Reading preferences</summary>
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
            </details>

            <section className="reader-archive" aria-labelledby="reader-archive-title">
              <div className="reader-section-heading">
                <h2 id="reader-archive-title">Archive</h2>
                <span>{olderArchiveIssues.length ? `${olderArchiveIssues.length} days` : "No past issues"}</span>
              </div>
              {olderArchiveIssues.length > 0 ? (
                <ul className="reader-archive-list">
                  {olderArchiveIssues.map((issue) => (
                      <li key={`${issue.id}-${issue.edition}`}>
                        <button type="button" className="reader-archive-date" onClick={() => selectArchiveIssue(issue)}>
                          <span>{formatDate(issue.localDate)}</span>
                          <span>{issue.articles.length} articles · {issueStatusLabel(issue.status)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="reader-muted reader-archive-empty">Earlier Daily Issues will collect here.</p>
              )}
            </section>

            {attempts.length > 0 && (
              <details className="reader-attempt-history">
                <summary>Recent collection attempts</summary>
                <ul>
                  {attempts.slice(0, 5).map((attempt) => (
                    <li key={attempt.id}>
                      <span>{attempt.trigger}</span>
                      <span>{attempt.state.toLowerCase()}</span>
                      <time dateTime={attempt.startedAt}>{new Date(attempt.startedAt).toLocaleTimeString()}</time>
                      {attempt.state === "FAILED" && attempt.failureReason && <span>{attempt.failureReason}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <>
            <div className="reader-article-toolbar">
              <button className="reader-back-button" type="button" onClick={closeArticle} aria-label="Back to reading list">
                <span aria-hidden="true">←</span> {selectedIssue?.localDate === todayIssue?.localDate ? "Today" : selectedIssue ? formatDate(selectedIssue.localDate) : "Reading list"}
              </button>
              <span className="reader-article-position">
                {progress ? `${Math.round(articleProgressRatio * 100)}% read` : "Reading"}
              </span>
            </div>
            <article className="reader-article" aria-labelledby="reader-article-title">
              <header className="reader-article-header">
                <p className="reader-eyebrow">{selectedArticle.originalPublication || selectedArticle.accessiblePublication}</p>
                <h1 id="reader-article-title">{articleTitle}</h1>
                <div className="reader-article-meta">
                  <span>
                    {articleResponse?.article.wordCount ?? selectedArticle.wordCount} whitespace-separated words ÷ 200 words/min = {formatReadingMinutes(articleResponse?.article.readingMinutes ?? selectedArticle.readingMinutes)}
                  </span>
                  <span>
                    FKGL inputs: {articleResponse?.article.fkglWordCount ?? selectedArticle.fkglWordCount} words · {articleResponse?.article.sentenceCount ?? selectedArticle.sentenceCount} sentences · {articleResponse?.article.syllableCount ?? selectedArticle.syllableCount} syllables
                  </span>
                  {typeof articleFkgl === "number" && (
                    <span>
                      FK grade {articleFkgl.toFixed(1)} · {articleResponse?.article.difficulty ?? selectedArticle.difficulty ?? difficultyForGrade(articleFkgl)} · estimated
                    </span>
                  )}
                  <span>{cachePermissionLabel(articleResponse?.article.cachePermission ?? selectedArticle.cachePermission)}</span>
                  {articleStatus && <span className={`reader-status reader-status--${articleStatus.toLowerCase()}`}>{contentStatusLabel(articleStatus)}</span>}
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
                  onMouseUp={() => {
                    if (articleBodyRef.current) setSelection(findSelectionDetails(articleBodyRef.current));
                  }}
                  onKeyUp={() => {
                    if (articleBodyRef.current) setSelection(findSelectionDetails(articleBodyRef.current));
                  }}
                >
                  {paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 20)}`} data-reader-paragraph={index}>
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

            {selection && !readerSayItResult && !localWordResult && !sayItBusy && (
              <div
                className="reader-selection-toolbar"
                style={{ left: selection.left, top: selection.top }}
                role="toolbar"
                aria-label="SayIt selection actions"
              >
                <span>{selection.text.length > 32 ? `${selection.text.slice(0, 29)}…` : selection.text}</span>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleSelectionAction()}
                  aria-label={`Use SayIt for ${selection.singleWord ? "word" : "selected expression"} ${selection.text}`}
                >
                  SayIt <span aria-hidden="true">↗</span>
                </button>
              </div>
            )}

            {(sayItBusy || localWordLoading) && (
              <aside className="reader-result-panel" aria-live="polite" aria-label="SayIt result">
                <div className="reader-result-panel-header">
                  <strong>{localWordLoading ? "Looking up locally…" : "SayIt"}</strong>
                  <button type="button" className="reader-icon-close" aria-label="Close SayIt result" onClick={() => { setLocalWordLoading(false); setSayItBusy(false); closeContextResult(); }}>
                    ×
                  </button>
                </div>
                <p className="reader-muted">{localWordLoading ? "Checking the local dictionary and pronunciation." : "Checking the selected text with its article sentence."}</p>
              </aside>
            )}

            {localWordResult && (
              <aside className="reader-result-panel" aria-live="polite" aria-label="Local dictionary result">
                <div className="reader-result-panel-header">
                  <div>
                    <span className="reader-eyebrow">Local dictionary</span>
                    <strong>{localWordResult.surface}</strong>
                  </div>
                  <button type="button" className="reader-icon-close" aria-label="Close SayIt result" onClick={closeContextResult}>×</button>
                </div>
                {localWordResult.ipa && <p className="reader-word-ipa">{localWordResult.ipa}</p>}
                <p className="reader-word-definition">{localWordResult.primary}</p>
                {localWordResult.secondary && <p className="reader-word-definition reader-word-definition--secondary">{localWordResult.secondary}</p>}
                <div className="reader-inline-actions">
                  <button className={`reader-secondary-button ${speakingKey === "reader-word" ? "is-active" : ""}`} type="button" onClick={() => onSpeak(localWordResult.surface, "reader-word")}>
                    Listen
                  </button>
                  <button className="reader-secondary-button" type="button" onClick={() => void onCopy(localWordResult.surface, "Reader word")}>
                    {copiedLabel === "Reader word" ? "Copied" : "Copy"}
                  </button>
                </div>
                {pronunciationErrorKey === "reader-word" && pronunciationError && <p className="reader-inline-error" role="status">{pronunciationError}</p>}
              </aside>
            )}

            {readerSayItResult && (
              <aside className="reader-result-panel" aria-live="polite" aria-label="SayIt result">
                <div className="reader-result-panel-header">
                  <div>
                    <span className="reader-eyebrow">Selected from this article</span>
                    <strong>{readerSayItResult.result.mode === "interpret" ? readerSayItResult.result.interpretation?.expression ?? "Interpretation" : readerSayItResult.result.best_match?.text ?? "SayIt result"}</strong>
                  </div>
                  <button type="button" className="reader-icon-close" aria-label="Close SayIt result and continue reading" onClick={closeContextResult}>
                    ×
                  </button>
                </div>
                {renderSayItResult(
                  readerSayItResult.result,
                  readerSayItResult.input,
                  readerResultSaved,
                  handleSaveReaderResult,
                  readerIpaByKey,
                  () => void handleSelectionAction(selectedExpressionForRetryRef.current),
                )}
              </aside>
            )}

            {sayItError && (
              <aside className="reader-result-panel reader-result-panel--error" role="alert">
                <div className="reader-result-panel-header">
                  <strong>SayIt could not complete this action</strong>
                  <button type="button" className="reader-icon-close" aria-label="Close message" onClick={closeContextResult}>×</button>
                </div>
                <p>{sayItError}</p>
              </aside>
            )}
          </>
        )}
      </div>
    </main>
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
  const sourceUrl = safeExternalUrl(article.accessibleUrl || article.originalUrl);
  return (
    <li className="reader-article-list-item">
      {article.contentStatus === "FULL_TEXT" ? (
        <button className="reader-article-open" type="button" onClick={() => void onOpen(issue, article)}>
          <ArticleSummary article={article} />
        </button>
      ) : (
        <div className="reader-article-open reader-article-open--external">
          <ArticleSummary article={article} />
          {sourceUrl && (
            <a className="reader-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Open publisher <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function ArticleSummary({ article }: { article: ReaderArticleSummary }) {
  const accessibleDiffers =
    article.accessiblePublication &&
    article.originalPublication &&
    article.accessiblePublication.toLocaleLowerCase() !== article.originalPublication.toLocaleLowerCase();
  return (
    <>
      <span className="reader-article-title">{article.title}</span>
      <span className="reader-article-byline">
        {article.originalPublication || article.accessiblePublication || "Publisher unknown"}
        {accessibleDiffers && ` · accessible via ${article.accessiblePublication}`}
      </span>
      <span className="reader-article-details">
        <span className={`reader-status reader-status--${article.contentStatus.toLowerCase()}`}>
          {contentStatusLabel(article.contentStatus)}
        </span>
        <span>{formatReadingMinutes(article.readingMinutes)}</span>
        {typeof article.wordCount === "number" && <span>{article.wordCount} words</span>}
        <span>{cachePermissionLabel(article.cachePermission)}</span>
        {article.readState && <span>{article.readState.toLowerCase().replaceAll("_", " ")}</span>}
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  isSuccessfulResult,
  MAX_CONTEXT_SUMMARY_LENGTH,
  MAX_INPUT_LENGTH,
  MAX_SESSION_TURNS,
  type SayItResult,
  type SessionContextTurn,
  type ExpressionType,
  type RetrievalResult,
} from "./shared/contract";
import {
  LocalMemoryRepository,
  StorageError,
  type SavedExpression,
} from "./lib/storage";
import {
  LocalHistoryRepository,
  type HistoryRecord,
} from "./lib/history";
import { segmentExplanatoryText } from "./lib/explanatory-text";
import {
  getDefinitionForSurface,
  isDictionaryLoaded,
  prefetchDictionary,
  type DictionaryDefinition,
} from "./lib/local-dictionary";
import {
  loadPronunciationPreferences,
  PronunciationService,
  savePronunciationPreferences,
  type PronunciationPreferences,
  type SpeechStartTiming,
} from "./lib/pronunciation";
import { getIPA, getIPACacheKey } from "./lib/ipa";
import {
  BookmarkIcon,
  CheckIcon,
  CopyButton,
  CopyIcon,
  HistoryIcon,
  SpeakButton,
  SpeakerIcon,
  useCopyAction,
} from "./lib/action-controls";
import { LocalSayItCacheRepository } from "./lib/sayit-cache";
import { resolveSayItRequest } from "./lib/sayit-resolver";
import { RetrievalApiError, requestRetrieval } from "./lib/sayit-request";
import { ReaderWorkspace } from "./reader/ReaderWorkspace";
import type {
  ReaderArchiveSnapshot,
  ReaderWorkspaceHandle,
} from "./reader/ReaderWorkspace";
import type { ReaderArticleSummary } from "./reader/types";
import { HistoryDrawer } from "./HistoryDrawer";
import "./App.css";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem("sayit.theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
  } catch {
    // Fall back to the browser preference when local storage is unavailable.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function formatExpressionType(type: ExpressionType): string {
  return type.replace("_", " ");
}

function summarizeResult(result: SayItResult): string {
  let summary: string;
  if (result.mode === "interpret") {
    if (result.interpretation) {
      summary = [
        `Expression: ${result.interpretation.expression}`,
        `Meaning: ${result.interpretation.meaning_in_context}`,
        `Usage or reference: ${result.interpretation.usage_or_reference}`,
      ].join(" ");
    } else if (result.clarifying_question) {
      summary = `Clarification question: ${result.clarifying_question}`;
    } else {
      summary = "No reliable interpretation was found.";
    }
  } else if (result.best_match) {
    summary = [
      `Best match: ${result.best_match.text}`,
      result.natural_sentence
        ? `Natural version: ${result.natural_sentence}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (result.clarifying_question) {
    summary = `Clarification question: ${result.clarifying_question}`;
  } else {
    summary = "No reliable expression was found.";
  }
  return summary.slice(0, MAX_CONTEXT_SUMMARY_LENGTH);
}

function historyTitle(record: HistoryRecord): string {
  return record.result.mode === "interpret"
    ? record.result.interpretation?.expression ?? record.input
    : record.result.best_match?.text ?? record.input;
}

function historySummary(record: HistoryRecord): string {
  if (record.result.mode === "interpret") {
    return record.result.interpretation?.meaning_in_context ?? record.input;
  }
  return record.result.natural_sentence ?? record.input;
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getIPAExpressions(result: SayItResult): string[] {
  const expressions =
    result.mode === "retrieve"
      ? [
          result.best_match?.text,
          ...result.alternatives.map((alternative) => alternative.text),
        ]
      : [result.interpretation?.expression];

  return Array.from(
    new Set(
      expressions.filter(
        (expression): expression is string => Boolean(expression?.trim()),
      ),
    ),
  );
}

function App() {
  const repositoryRef = useRef<LocalMemoryRepository | null>(null);
  const historyRepositoryRef = useRef<LocalHistoryRepository | null>(null);
  const cacheRepositoryRef = useRef<LocalSayItCacheRepository | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<SayItResult | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContextTurn[]>(
    [],
  );
  const [savedItems, setSavedItems] = useState<SavedExpression[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryRecord[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<HistoryRecord | null>(null);
  const [readerArchive, setReaderArchive] = useState<ReaderArchiveSnapshot>({
    todayIssue: null,
    archiveIssues: [],
    displayedIssue: null,
  });
  const readerRef = useRef<ReaderWorkspaceHandle | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [readerActive, setReaderActive] = useState(false);
  const [readerPreferencesOpen, setReaderPreferencesOpen] = useState(false);
  const [pronunciationPreferences, setPronunciationPreferences] =
    useState<PronunciationPreferences>(loadPronunciationPreferences);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [pronunciationErrorKey, setPronunciationErrorKey] = useState<
    string | null
  >(null);
  const [pronunciationError, setPronunciationError] = useState<string | null>(
    null,
  );
  const [ipaByKey, setIpaByKey] = useState<Record<string, string>>({});
  const pronunciationServiceRef = useRef<PronunciationService | null>(null);

  const getCacheRepository = useCallback(() => {
    cacheRepositoryRef.current ??= new LocalSayItCacheRepository();
    return cacheRepositoryRef.current;
  }, []);

  const getHistoryRepository = useCallback(() => {
    historyRepositoryRef.current ??= new LocalHistoryRepository();
    return historyRepositoryRef.current;
  }, []);

  useEffect(() => {
    const repository = new LocalMemoryRepository();
    repositoryRef.current = repository;
    setSavedItems(repository.list());
    const historyRepository = getHistoryRepository();
    setHistoryItems(historyRepository.list());
    // Establish the shared SayIt result cache before any request can need it.
    getCacheRepository();
  }, [getCacheRepository, getHistoryRepository]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const maxHeight =
      Number.parseFloat(window.getComputedStyle(textarea).maxHeight) || 240;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("sayit.theme", theme);
    } catch {
      // Theme persistence is optional; the current session still works.
    }
  }, [theme]);

  useEffect(() => {
    pronunciationServiceRef.current = new PronunciationService(
      undefined,
      undefined,
      (timing: SpeechStartTiming) => {
        if (import.meta.env.DEV) {
          console.debug("[sayit] speech start latency", timing);
        }
      },
    );
    // Warm the engine voice list at startup so the first Listen is not paying
    // for voice discovery.
    pronunciationServiceRef.current.warmUp();
    return () => {
      pronunciationServiceRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const expressions = result ? getIPAExpressions(result) : [];
    const accent = pronunciationPreferences.accent;
    let cancelled = false;
    setIpaByKey({});

    if (expressions.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      expressions.map(async (expression) => {
        const ipa = await getIPA(expression, accent);
        return ipa
          ? ([getIPACacheKey(expression, accent), ipa] as const)
          : null;
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setIpaByKey(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, string] => entry !== null,
          ),
        ),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [pronunciationPreferences.accent, result]);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  }, []);

  const { copiedLabel, copy: handleCopy } = useCopyAction(showNotice);

  const markSayItInteraction = useCallback(
    (value: string, nextResult: SayItResult) => {
      const historyRepository = getHistoryRepository();
      try {
        historyRepository.append(value, nextResult);
        setHistoryItems(historyRepository.list());
      } catch {
        showNotice("This result could not be added to local history.");
      }
    },
    [getHistoryRepository, showNotice],
  );

  const updatePronunciationPreferences = useCallback(
    (next: PronunciationPreferences) => {
      setPronunciationPreferences(next);
      savePronunciationPreferences(next);
    },
    [],
  );

  const handleSpeak = useCallback(
    (text: string, key: string) => {
      setPronunciationError(null);
      setPronunciationErrorKey(null);
      const service = pronunciationServiceRef.current;
      if (!service) {
        setPronunciationErrorKey(key);
        setPronunciationError("Speech playback is unavailable.");
        return;
      }
      try {
        service.speak(text, pronunciationPreferences, {
          onStart: () => setSpeakingKey(key),
          onEnd: () => setSpeakingKey((current) => (current === key ? null : current)),
          onError: () => {
            setSpeakingKey((current) => (current === key ? null : current));
            setPronunciationErrorKey(key);
            setPronunciationError("Couldn’t play this expression in the browser.");
          },
        });
      } catch (speechError) {
        setSpeakingKey(null);
        setPronunciationErrorKey(key);
        setPronunciationError(
          speechError instanceof Error
            ? speechError.message
            : "Speech playback is unavailable.",
        );
      }
    },
    [pronunciationPreferences],
  );

  const retrieve = useCallback(
    async (value: string) => {
      setIsSubmitting(true);
      setError(null);
      setNotice(null);
      setResult(null);
      setActiveSavedId(null);

      const requestedContext = sessionContext.slice(-MAX_SESSION_TURNS);

      try {
        // One shared persistent cache: a repeated successful query renders from
        // local storage without spending another LLM call.
        const resolved = await resolveSayItRequest({
          selection: value,
          source: "sayit",
          context: requestedContext,
          cache: getCacheRepository(),
          retrieve: (requestedInput, requestedTurns) =>
            requestRetrieval({
              input: requestedInput,
              context: requestedTurns.slice(-MAX_SESSION_TURNS),
            }),
        });
        const resolvedResult = resolved.result;
        setResult(resolvedResult);
        if (resolvedResult.status === "success") {
          // An explicit SayIt action stays a SayIt interaction even on a cache
          // hit; History dedupe decides whether a new entry is meaningful.
          markSayItInteraction(value, resolvedResult);
        }
        setSessionContext((currentContext) =>
          [
            ...currentContext,
            {
              input: value,
              mode: resolvedResult.mode,
              assistant_summary: summarizeResult(resolvedResult),
            },
          ].slice(-MAX_SESSION_TURNS),
        );
      } catch (requestError) {
        setError(
          requestError instanceof RetrievalApiError
            ? requestError.message
            : requestError instanceof Error
              ? requestError.message
              : "SayIt could not complete this request.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [getCacheRepository, markSayItInteraction, sessionContext],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) {
      setError("Enter an English thought first.");
      return;
    }
    if (value.length > MAX_INPUT_LENGTH) {
      setError(`Keep your input under ${MAX_INPUT_LENGTH} characters.`);
      return;
    }
    void retrieve(value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleSave = () => {
    if (!isSuccessfulResult(result) || !repositoryRef.current) {
      return;
    }
    try {
      const saved = repositoryRef.current.save(input.trim(), result);
      setSavedItems(repositoryRef.current.list());
      setActiveSavedId(saved.id);
      showNotice("Saved locally");
    } catch (storageError) {
      setError(
        storageError instanceof StorageError
          ? storageError.message
          : "Could not save this expression locally.",
      );
    }
  };

  const handleRemove = (id: string) => {
    if (!repositoryRef.current) {
      return;
    }
    try {
      repositoryRef.current.remove(id);
      setSavedItems(repositoryRef.current.list());
      if (activeSavedId === id) {
        setActiveSavedId(null);
      }
      showNotice("Removed from saved expressions");
    } catch {
      setError("Could not remove this saved expression.");
    }
  };

  const handleClearSaved = () => {
    if (!repositoryRef.current || savedItems.length === 0) {
      return;
    }
    if (!window.confirm("Clear all saved expressions from this browser?")) {
      return;
    }
    try {
      repositoryRef.current.clear();
      setSavedItems([]);
      setActiveSavedId(null);
      showNotice("Saved expressions cleared");
    } catch {
      setError("Could not clear saved expressions.");
    }
  };

  const handleLoadSaved = (item: SavedExpression) => {
    setInput(item.input);
    setResult(item.result);
    setActiveSavedId(item.id);
    setError(null);
    setDrawerOpen(false);
    setHistoryOpen(false);
  };

  const handleRestoreHistory = (item: HistoryRecord) => {
    const restored = historyRepositoryRef.current?.restore(
      item.id,
      summarizeResult,
    );
    if (!restored) return;

    setInput(restored.record.input);
    setResult(restored.record.result);
    setActiveSavedId(null);
    setSessionContext(restored.context);
    setError(null);
    setIsSubmitting(false);
    setPronunciationError(null);
    setPronunciationErrorKey(null);
    setDrawerOpen(false);
    setHistoryOpen(false);
    setHistoryPreview(null);
  };

  /** Show a past result without entering SayIt or touching its session. */
  const handlePreviewExpression = (item: HistoryRecord) => {
    setHistoryPreview(item);
  };

  const handleOpenExpressionInSayIt = (item: HistoryRecord) => {
    setHistoryPreview(null);
    setHistoryOpen(false);
    setReaderActive(false);
    handleRestoreHistory(item);
  };

  const handleOpenReading = (article: ReaderArticleSummary) => {
    setHistoryPreview(null);
    setReaderActive(true);
    readerRef.current?.openArticle(article);
  };

  const handleHistoryShowToday = () => {
    setHistoryPreview(null);
    setReaderActive(true);
    readerRef.current?.showToday();
  };

  const handleReaderSuccessfulSayIt = (value: string, readerResult: SayItResult) => {
    if (readerResult.status !== "success") return;
    markSayItInteraction(value, readerResult);
  };

  const handleSaveReaderResult = (value: string, readerResult: SayItResult): boolean => {
    if (!isSuccessfulResult(readerResult) || !repositoryRef.current) {
      return false;
    }
    try {
      repositoryRef.current.save(value, readerResult);
      setSavedItems(repositoryRef.current.list());
      showNotice("Saved locally");
      return true;
    } catch (storageError) {
      showNotice(
        storageError instanceof StorageError
          ? storageError.message
          : "Could not save this expression locally.",
      );
      return false;
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <div className="mode-switch" role="group" aria-label="Workspace">
            <button
              className={!readerActive ? "is-active" : ""}
              type="button"
              aria-pressed={!readerActive}
              onClick={() => {
                setDrawerOpen(false);
                setHistoryOpen(false);
                setHistoryPreview(null);
                setReaderPreferencesOpen(false);
                setReaderActive(false);
              }}
            >
              SayIt
            </button>
            <button
              className={readerActive ? "is-active" : ""}
              type="button"
              aria-pressed={readerActive}
              onClick={() => {
                setDrawerOpen(false);
                setHistoryOpen(false);
                setHistoryPreview(null);
                setReaderPreferencesOpen(false);
                setReaderActive(true);
              }}
            >
              Reader
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-button utility-action ${historyOpen ? "is-active" : ""}`}
            type="button"
            title={`History · ${historyItems.length} expressions`}
            onClick={() => {
              setDrawerOpen(false);
              setReaderPreferencesOpen(false);
              setHistoryPreview(null);
              setHistoryOpen(true);
            }}
            aria-expanded={historyOpen}
            aria-label={`Open history, ${historyItems.length} recent expressions`}
          >
            <HistoryIcon />
            {historyItems.length > 0 && (
              <span className="saved-count">{historyItems.length}</span>
            )}
          </button>
          {readerActive ? (
            <button
              className={`icon-button utility-action ${readerPreferencesOpen ? "is-active" : ""}`}
              type="button"
              title="Reader settings"
              aria-label="Open reading preferences"
              aria-expanded={readerPreferencesOpen}
              onClick={() => {
                setReaderPreferencesOpen(true);
              }}
            >
              <GearIcon />
            </button>
          ) : (
            <button
              className={`icon-button utility-action ${drawerOpen ? "is-active" : ""}`}
              type="button"
              title={`Saved${savedItems.length > 0 ? ` · ${savedItems.length}` : ""}`}
              onClick={() => {
                setHistoryOpen(false);
                setDrawerOpen(true);
              }}
              aria-expanded={drawerOpen}
              aria-label={`Open saved expressions, ${savedItems.length} saved`}
            >
              <BookmarkIcon />
              {savedItems.length > 0 && (
                <span className="saved-count">{savedItems.length}</span>
              )}
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
        </div>
      </header>

      <main className="main-content" hidden={readerActive}>
        <section className="hero-copy" aria-labelledby="page-title">
          <h1 id="page-title">What are you trying to say?</h1>
          <p>Find the words, or make sense of an expression.</p>
        </section>
        <PronunciationControls
          preferences={pronunciationPreferences}
          onChange={updatePronunciationPreferences}
        />

        <form className="input-card" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="expression-input">
            Your thought
          </label>
          <textarea
            id="expression-input"
            ref={inputRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
              setActiveSavedId(null);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Try: sort ideas by shared traits"
            maxLength={MAX_INPUT_LENGTH}
            autoFocus
            aria-describedby="input-hint input-count"
            aria-busy={isSubmitting}
          />
          <div className="input-footer">
            <span id="input-hint">Enter to find · Shift+Enter for a new line</span>
            <span id="input-count" className="character-count">
              {input.length}/{MAX_INPUT_LENGTH}
            </span>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Finding…" : "Say it"}
              <span aria-hidden="true">↵</span>
            </button>
          </div>
        </form>

        <section
          className={`result-card ${result || error || isSubmitting ? "has-content" : ""}`}
          aria-live="polite"
          aria-atomic="false"
          aria-label="SayIt result"
        >
          {pronunciationError && (
            <div className="pronunciation-error" role="status">
              {pronunciationError}
            </div>
          )}
          {isSubmitting && (
            <div className="loading-state">
              <span className="loading-orb" aria-hidden="true" />
              <div>
                <strong>Finding a natural expression…</strong>
                <span>Keeping it short and useful.</span>
              </div>
            </div>
          )}

          {!isSubmitting && error && (
            <div className="message-state error-state" role="alert">
              <div>
                <strong>Couldn’t retrieve that.</strong>
                <span>{error}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void retrieve(input.trim())}
                disabled={!input.trim()}
              >
                Retry
              </button>
            </div>
          )}

          {!isSubmitting && !error && result && (
            <ResultView
              result={result}
              isSaved={activeSavedId !== null}
              copiedLabel={copiedLabel}
              onCopy={handleCopy}
              onSave={handleSave}
              onRetry={() => void retrieve(input.trim())}
              onSpeak={handleSpeak}
              speakingKey={speakingKey}
              pronunciationErrorKey={pronunciationErrorKey}
              pronunciationAccent={pronunciationPreferences.accent}
              ipaByKey={ipaByKey}
            />
          )}

          {!isSubmitting && !error && !result && (
            <div className="empty-result">
              <span className="empty-icon" aria-hidden="true">
                ✦
              </span>
              <span>Your next words start here.</span>
            </div>
          )}
        </section>
      </main>

      <ReaderWorkspace
        ref={readerRef}
        active={readerActive}
        pronunciationAccent={pronunciationPreferences.accent}
        copiedLabel={copiedLabel}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        pronunciationError={pronunciationError}
        sayItCache={getCacheRepository()}
        onCopy={handleCopy}
        onSpeak={handleSpeak}
        onSuccessfulSayIt={handleReaderSuccessfulSayIt}
        onSaveRetrieval={handleSaveReaderResult}
        preferencesOpen={readerPreferencesOpen}
        onClosePreferences={() => setReaderPreferencesOpen(false)}
        onArchiveChange={setReaderArchive}
        renderSayItResult={(readerResult, readerInput, isSaved, onSave, readerIpaByKey) => (
          <ReaderResultBody
            result={readerResult}
            isSaved={isSaved}
            pronunciationAccent={pronunciationPreferences.accent}
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            ipaByKey={readerIpaByKey}
            onCopy={handleCopy}
            onSave={onSave}
            onSpeak={handleSpeak}
          />
        )}
      />

      {notice && <div className="toast" role="status">{notice}</div>}

      {historyPreview && (
        <aside
          className="history-preview drawer-layer"
          role="dialog"
          aria-modal="false"
          aria-label="Saved SayIt result"
        >
          <div className="history-preview-card">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Saved SayIt result</p>
                <h2>{historyTitle(historyPreview)}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close preview"
                onClick={() => setHistoryPreview(null)}
              >
                ×
              </button>
            </div>
            <ResultView
              result={historyPreview.result}
              isSaved={false}
              copiedLabel={copiedLabel}
              onCopy={handleCopy}
              onSave={() => undefined}
              onRetry={() => undefined}
              onSpeak={handleSpeak}
              speakingKey={speakingKey}
              pronunciationErrorKey={pronunciationErrorKey}
              pronunciationAccent={pronunciationPreferences.accent}
              ipaByKey={ipaByKey}
            />
            <button
              type="button"
              className="secondary-button history-preview-open"
              onClick={() => handleOpenExpressionInSayIt(historyPreview)}
            >
              Open in SayIt
            </button>
          </div>
        </aside>
      )}

      <HistoryDrawer
        open={historyOpen}
        mode={readerActive ? "reader" : "sayit"}
        readingArticleOpen={readerArchive.displayedIssue !== null}
        todayIssue={readerArchive.todayIssue}
        archiveIssues={readerArchive.archiveIssues}
        historyItems={historyItems}
        onPreviewExpression={handlePreviewExpression}
        onOpenExpression={handleOpenExpressionInSayIt}
        onOpenReading={handleOpenReading}
        onShowToday={handleHistoryShowToday}
        onReadArticle={() => setHistoryOpen(false)}
        onClose={() => setHistoryOpen(false)}
      />

      {drawerOpen && (
        <div className="drawer-layer" role="presentation" onMouseDown={() => setDrawerOpen(false)}>
          <aside
            className="saved-drawer"
            aria-label="Saved expressions"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Local memory</p>
                <h2>Saved expressions</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close saved expressions"
                onClick={() => setDrawerOpen(false)}
              >
                ×
              </button>
            </div>
            {savedItems.length === 0 ? (
              <div className="drawer-empty">
                <span className="empty-icon" aria-hidden="true">♡</span>
                <p>Save an expression and it will stay in this browser.</p>
              </div>
            ) : (
              <>
                <ul className="saved-list">
                  {savedItems.map((item) => (
                    <li className="saved-list-item" key={item.id}>
                      <button
                        className="saved-item"
                        type="button"
                        onClick={() => handleLoadSaved(item)}
                      >
                        <strong>{item.result.best_match?.text ?? "Saved result"}</strong>
                        <span>{item.result.natural_sentence ?? item.input}</span>
                      </button>
                      <div className="saved-item-actions">
                        <CopyButton
                          label="Saved sentence"
                          copied={copiedLabel === "Saved sentence"}
                          onCopy={() =>
                            void handleCopy(
                              item.result.natural_sentence ??
                                item.result.best_match?.text ??
                                item.input,
                              "Saved sentence",
                            )
                          }
                        />
                        <button
                          className="tiny-button danger-button"
                          type="button"
                          onClick={() => handleRemove(item.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button className="clear-button" type="button" onClick={handleClearSaved}>
                  Clear all saved expressions
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

interface ResultViewProps {
  result: SayItResult;
  isSaved: boolean;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  pronunciationAccent: PronunciationPreferences["accent"];
  ipaByKey: Record<string, string>;
  onCopy: (text: string, label: string) => Promise<void>;
  onSave: () => void;
  onRetry: () => void;
  onSpeak: (text: string, key: string) => void;
}

function ResultView({
  result,
  isSaved,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  pronunciationAccent,
  ipaByKey,
  onCopy,
  onSave,
  onRetry,
  onSpeak,
}: ResultViewProps) {
  if (result.mode === "interpret") {
    return (
      <InterpretationResultView
        result={result}
        copiedLabel={copiedLabel}
        onCopy={onCopy}
        onRetry={onRetry}
        onSpeak={onSpeak}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        pronunciationAccent={pronunciationAccent}
        ipaByKey={ipaByKey}
      />
    );
  }

  if (result.status === "no_match") {
    return (
      <div className="message-state no-match-state">
        <div>
          <span className="result-kicker">No reliable match yet</span>
          <strong>Try adding a little more context.</strong>
          <span>{result.inferred_intent || "Say what you want to express in your own words."}</span>
        </div>
        <button className="secondary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (result.status === "needs_clarification") {
    return (
      <div className="clarification-state">
        <span className="result-kicker">One quick question</span>
        <h2>{result.clarifying_question}</h2>
        {result.alternatives.length > 0 && (
          <div className="alternative-list">
            {result.alternatives.map((alternative) => (
              <ExpressionRow
                key={`${alternative.text}-${alternative.expression_type}`}
                expression={alternative}
                onCopy={onCopy}
                copiedLabel={copiedLabel}
                onSpeak={onSpeak}
                speakingKey={speakingKey}
                pronunciationErrorKey={pronunciationErrorKey}
                pronunciationAccent={pronunciationAccent}
                ipaByKey={ipaByKey}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!result.best_match || !result.natural_sentence) {
    return null;
  }

  return (
    <div className="result-content">
      <div className="best-match action-block">
        <div className="playable-text">
          <strong>{result.best_match.text}</strong>
          <ExpressionMeta
            ipa={
              ipaByKey[
                getIPACacheKey(result.best_match.text, pronunciationAccent)
              ]
            }
            expressionType={formatExpressionType(result.best_match.expression_type)}
          />
          <button
            className={`icon-button save-result-button ${isSaved ? "saved-state" : ""}`}
            type="button"
            onClick={onSave}
            disabled={isSaved}
            aria-pressed={isSaved}
            aria-label={isSaved ? "Saved locally" : "Save expression"}
            title={isSaved ? "Saved" : "Save expression"}
          >
            {isSaved ? <CheckIcon /> : <BookmarkIcon />}
          </button>
        </div>
        <ContextualActions
          text={result.best_match.text}
          label="Best match"
          speechKey="best-match"
          copiedLabel={copiedLabel}
          speakingKey={speakingKey}
          pronunciationErrorKey={pronunciationErrorKey}
          onCopy={onCopy}
          onSpeak={onSpeak}
        />
      </div>

      {result.alternatives.length > 0 && (
        <div className="result-section">
          <span className="result-kicker">Useful expressions</span>
          <div className="alternative-list">
            {result.alternatives.map((alternative) => (
              <ExpressionRow
                key={`${alternative.text}-${alternative.expression_type}`}
                expression={alternative}
                onCopy={onCopy}
                copiedLabel={copiedLabel}
                onSpeak={onSpeak}
                speakingKey={speakingKey}
                pronunciationErrorKey={pronunciationErrorKey}
                pronunciationAccent={pronunciationAccent}
                ipaByKey={ipaByKey}
              />
            ))}
          </div>
        </div>
      )}

      <div className="natural-section">
        <span className="result-kicker">Natural version</span>
        <div className="natural-sentence action-block">
          <p>{result.natural_sentence}</p>
          <ContextualActions
            text={result.natural_sentence}
            label="Natural version"
            speechKey="natural-version"
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        </div>
      </div>

      {result.short_explanation && (
        <ExplanatoryResultBlock
          kicker="Explanation"
          text={result.short_explanation}
          copyLabel="Explanation"
          speechKey="short-explanation"
          pronunciationAccent={pronunciationAccent}
          copiedLabel={copiedLabel}
          speakingKey={speakingKey}
          pronunciationErrorKey={pronunciationErrorKey}
          onCopy={onCopy}
          onSpeak={onSpeak}
        />
      )}

      {result.learnable_items.length > 0 && (
        <div className="learnable-row">
          <span>Worth noticing</span>
          {result.learnable_items.map((item) => (
            <span className="learnable-chip" key={`${item.text}-${item.expression_type}`}>
              {item.text}
            </span>
          ))}
        </div>
      )}

      {result.typo_corrections.length > 0 && (
        <details className="normalization-details">
          <summary>Show normalization</summary>
          <p>
            {result.typo_corrections
              .map((correction) => `${correction.original} → ${correction.corrected}`)
              .join(" · ")}
          </p>
        </details>
      )}
    </div>
  );
}

interface InterpretationResultViewProps {
  result: Extract<SayItResult, { mode: "interpret" }>;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  pronunciationAccent: PronunciationPreferences["accent"];
  ipaByKey: Record<string, string>;
  onCopy: (text: string, label: string) => Promise<void>;
  onRetry: () => void;
  onSpeak: (text: string, key: string) => void;
}

function InterpretationResultView({
  result,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  pronunciationAccent,
  ipaByKey,
  onCopy,
  onRetry,
  onSpeak,
}: InterpretationResultViewProps) {
  if (result.status === "no_match") {
    return (
      <div className="message-state no-match-state">
        <div>
          <span className="result-kicker">No reliable interpretation yet</span>
          <strong>Try adding the scene or speaker.</strong>
          <span>
            {result.inferred_intent ||
              "Add the sentence, show, speaker, or situation."}
          </span>
        </div>
        <button className="secondary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (result.status === "needs_clarification") {
    return (
      <div className="clarification-state">
        <span className="result-kicker">One quick question</span>
        <h2>{result.clarifying_question}</h2>
        <button className="secondary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!result.interpretation) {
    return null;
  }

  const interpretation = result.interpretation;
  return (
    <div className="result-content interpretation-content">
      <div className="best-match action-block">
        <div className="playable-text">
          <strong>{interpretation.expression}</strong>
          <ExpressionMeta
            ipa={
              ipaByKey[
                getIPACacheKey(interpretation.expression, pronunciationAccent)
              ]
            }
            expressionType={interpretation.kind.replace("_", " ")}
          />
        </div>
        <ContextualActions
          text={interpretation.expression}
          label="Expression"
          speechKey="interpretation-expression"
          copiedLabel={copiedLabel}
          speakingKey={speakingKey}
          pronunciationErrorKey={pronunciationErrorKey}
          onCopy={onCopy}
          onSpeak={onSpeak}
        />
      </div>

      <ExplanatoryResultBlock
        kicker="Meaning in this context"
        text={interpretation.meaning_in_context}
        emphasis="primary"
        copyLabel="Meaning in this context"
        speechKey="interpretation-meaning"
        pronunciationAccent={pronunciationAccent}
        copiedLabel={copiedLabel}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        onCopy={onCopy}
        onSpeak={onSpeak}
      />

      <ExplanatoryResultBlock
        kicker="Usage / reference"
        text={interpretation.usage_or_reference}
        copyLabel="Usage / reference"
        speechKey="interpretation-usage"
        pronunciationAccent={pronunciationAccent}
        copiedLabel={copiedLabel}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        onCopy={onCopy}
        onSpeak={onSpeak}
      />

      {interpretation.example && (
        <ExplanatoryResultBlock
          kicker="Example"
          text={interpretation.example}
          copyLabel="Example"
          speechKey="interpretation-example"
          pronunciationAccent={pronunciationAccent}
          copiedLabel={copiedLabel}
          speakingKey={speakingKey}
          pronunciationErrorKey={pronunciationErrorKey}
          onCopy={onCopy}
          onSpeak={onSpeak}
        />
      )}
    </div>
  );
}

interface ExplanatoryResultBlockProps {
  kicker: string;
  text: string;
  emphasis?: "primary" | "supporting";
  copyLabel: string;
  speechKey: string;
  pronunciationAccent: PronunciationPreferences["accent"];
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  onCopy: (text: string, label: string) => Promise<void>;
  onSpeak: (text: string, key: string) => void;
}

function ExplanatoryResultBlock({
  kicker,
  text,
  emphasis = "supporting",
  copyLabel,
  speechKey,
  pronunciationAccent,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  onCopy,
  onSpeak,
}: ExplanatoryResultBlockProps) {
  return (
    <div
      className={`explanatory-result-block explanatory-result-block--${emphasis} action-block`}
    >
      <span className="result-kicker">{kicker}</span>
      <LexicalText
        text={text}
        pronunciationAccent={pronunciationAccent}
        onSpeak={onSpeak}
      />
      <ContextualActions
        text={text}
        label={copyLabel}
        speechKey={speechKey}
        copiedLabel={copiedLabel}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        onCopy={onCopy}
        onSpeak={onSpeak}
      />
    </div>
  );
}

interface LexicalTextProps {
  text: string;
  pronunciationAccent: PronunciationPreferences["accent"];
  onSpeak: (text: string, key: string) => void;
}

interface ActiveLexicalWord {
  key: string;
  surface: string;
}

interface IdleWindow {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

function LexicalText({
  text,
  pronunciationAccent,
  onSpeak,
}: LexicalTextProps) {
  const parts = segmentExplanatoryText(text);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const [activeWord, setActiveWord] = useState<ActiveLexicalWord | null>(null);
  const [ipa, setIpa] = useState<string | null>(null);
  const [definition, setDefinition] =
    useState<DictionaryDefinition | null>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);

  useEffect(() => {
    const idleWindow = window as unknown as IdleWindow;
    const prefetch = () => {
      void prefetchDictionary().catch(() => undefined);
    };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(prefetch, 200);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!activeWord) {
      setIpa(null);
      setDefinition(null);
      setDefinitionLoading(false);
      return;
    }

    let cancelled = false;
    setIpa(null);
    setDefinition(null);
    setDefinitionLoading(!isDictionaryLoaded());
    void getIPA(activeWord.surface, pronunciationAccent)
      .then((value) => {
        if (!cancelled) setIpa(value);
      })
      .catch(() => {
        if (!cancelled) setIpa(null);
      });

    const loadDefinition = () => {
      if (cancelled) return;
      setDefinition(getDefinitionForSurface(activeWord.surface));
      setDefinitionLoading(false);
    };
    if (isDictionaryLoaded()) {
      loadDefinition();
    } else {
      void prefetchDictionary().then(loadDefinition).catch(() => {
        if (!cancelled) setDefinitionLoading(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [activeWord, pronunciationAccent]);

  useEffect(() => {
    if (!activeWord) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-lexical-key]")
        : null;
      if (target?.getAttribute("data-lexical-key") !== activeWord.key) {
        setActiveWord(null);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActiveWord(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeWord]);

  useEffect(
    () => () => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const openWord = (key: string, surface: string) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setActiveWord({ key, surface });
  };

  const closeWordSoon = () => {
    if (lastPointerTypeRef.current === "touch") return;
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setActiveWord(null);
      closeTimerRef.current = null;
    }, 140);
  };

  if (!parts) {
    return (
      <p className="explanatory-copy">
        {text}
      </p>
    );
  }

  return (
    <p className="explanatory-copy">
      {parts.map((part) => {
        if (!part.isWordLike) {
          return (
            <span className="lexical-static-text" key={`${part.start}-${part.end}`}>
              {part.text}
            </span>
          );
        }

        const key = `${part.start}-${part.end}`;
        const isActive = activeWord?.key === key;
        return (
          <span
            className="lexical-hit-area"
            data-lexical-key={key}
            data-active={isActive ? "true" : undefined}
            key={key}
            onPointerEnter={(event) => {
              lastPointerTypeRef.current = event.pointerType;
              if (event.pointerType === "touch") return;
              if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
              if (openTimerRef.current !== null) {
                window.clearTimeout(openTimerRef.current);
              }
              openTimerRef.current = window.setTimeout(() => {
                openWord(key, part.text);
                openTimerRef.current = null;
              }, 300);
            }}
            onPointerDown={(event) => {
              lastPointerTypeRef.current = event.pointerType;
            }}
            onPointerLeave={closeWordSoon}
            onClick={() => {
              if (lastPointerTypeRef.current !== "touch") return;
              if (isActive) setActiveWord(null);
              else openWord(key, part.text);
            }}
          >
            <span className="lexical-unit">{part.text}</span>
            {isActive && activeWord && (
              <span className="lexical-tooltip" role="status">
                <strong className="lexical-tooltip-word">
                  {activeWord.surface}
                </strong>
                <span className="lexical-tooltip-pronunciation">
                  {ipa && <span className="ipa-text">{ipa}</span>}
                  <button
                    className="speak-button"
                    type="button"
                    aria-label={`Listen to ${activeWord.surface}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSpeak(
                        activeWord.surface,
                        `word-${activeWord.key}-${activeWord.surface}`,
                      );
                    }}
                  >
                    <SpeakerIcon />
                  </button>
                </span>
                {definition ? (
                  <span className="lexical-definition">
                    {definition.primary}
                    {definition.secondary && (
                      <span>{definition.secondary}</span>
                    )}
                  </span>
                ) : definitionLoading ? (
                  <span className="lexical-definition-loading">
                    Loading definition…
                  </span>
                ) : null}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

interface ExpressionRowProps {
  expression: NonNullable<RetrievalResult["alternatives"]>[number];
  onCopy: (text: string, label: string) => Promise<void>;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  pronunciationAccent: PronunciationPreferences["accent"];
  ipaByKey: Record<string, string>;
  onSpeak: (text: string, key: string) => void;
}

function ExpressionRow({
  expression,
  onCopy,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  pronunciationAccent,
  ipaByKey,
  onSpeak,
}: ExpressionRowProps) {
  const speechKey = `alternative-${expression.text}`;
  const label = `Useful expression: ${expression.text}`;
  return (
    <div className="expression-row action-block">
      <div>
        <div className="playable-text">
          <strong>{expression.text}</strong>
          <ExpressionMeta
            ipa={
              ipaByKey[getIPACacheKey(expression.text, pronunciationAccent)]
            }
            expressionType={formatExpressionType(expression.expression_type)}
          />
        </div>
      </div>
      <ContextualActions
        text={expression.text}
        label={label}
        speechKey={speechKey}
        copiedLabel={copiedLabel}
        speakingKey={speakingKey}
        pronunciationErrorKey={pronunciationErrorKey}
        onCopy={onCopy}
        onSpeak={onSpeak}
      />
    </div>
  );
}

interface ExpressionMetaProps {
  ipa: string | undefined;
  expressionType: string;
}

function ExpressionMeta({
  ipa,
  expressionType,
}: ExpressionMetaProps) {
  return (
    <span className="expression-meta">
      {ipa && <span className="ipa-text">{ipa}</span>}
      <span className="expression-type">· {expressionType}</span>
    </span>
  );
}

interface ContextualActionsProps {
  text: string;
  label: string;
  speechKey: string;
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  onCopy: (text: string, label: string) => Promise<void>;
  onSpeak: (text: string, key: string) => void;
}

function ContextualActions({
  text,
  label,
  speechKey,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  onCopy,
  onSpeak,
}: ContextualActionsProps) {
  return (
    <div className="contextual-actions">
      <SpeakButton
        text={text}
        label={label}
        speaking={speakingKey === speechKey}
        error={pronunciationErrorKey === speechKey}
        onSpeak={onSpeak}
        speechKey={speechKey}
      />
      <CopyButton
        label={label}
        copied={copiedLabel === label}
        onCopy={() => void onCopy(text, label)}
      />
    </div>
  );
}

interface PronunciationControlsProps {
  preferences: PronunciationPreferences;
  onChange: (preferences: PronunciationPreferences) => void;
}

function PronunciationControls({
  preferences,
  onChange,
}: PronunciationControlsProps) {
  const accentLabel =
    preferences.accent === "us" ? "US" : "UK";
  const nextAccentLabel = preferences.accent === "us" ? "UK" : "US";
  const speedLabel = preferences.speed === "normal" ? "1×" : "0.8×";
  const nextSpeedLabel = preferences.speed === "normal" ? "0.8×" : "1×";

  return (
    <div className="pronunciation-controls" aria-label="Pronunciation settings">
      <button
        className="preference-toggle"
        type="button"
        aria-label={`Pronunciation accent, currently ${accentLabel}, click to switch to ${nextAccentLabel}`}
        onClick={() =>
          onChange({
            ...preferences,
            accent: preferences.accent === "us" ? "uk" : "us",
          })
        }
      >
        {accentLabel}
      </button>
      <span className="control-divider" aria-hidden="true" />
      <button
        className="preference-toggle"
        type="button"
        aria-label={`Speech speed, currently ${speedLabel}, click to switch to ${nextSpeedLabel}`}
        onClick={() =>
          onChange({
            ...preferences,
            speed: preferences.speed === "normal" ? "slow" : "normal",
          })
        }
      >
        {speedLabel}
      </button>
    </div>
  );
}

interface ReaderResultBodyProps {
  result: SayItResult;
  isSaved: boolean;
  pronunciationAccent: PronunciationPreferences["accent"];
  copiedLabel: string | null;
  speakingKey: string | null;
  pronunciationErrorKey: string | null;
  ipaByKey: Record<string, string>;
  onCopy: (text: string, label: string) => Promise<void>;
  onSave: () => void;
  onSpeak: (text: string, key: string) => void;
}

/**
 * Compact Reader rendering of a SayIt result.
 *
 * It reuses the same semantic result data as the full SayIt surface, but the
 * selected expression stays the single heading owned by the Reader popover, so
 * Meaning / Usage / Example are not repeated under a second title.
 */
function ReaderResultBody({
  result,
  isSaved,
  pronunciationAccent,
  copiedLabel,
  speakingKey,
  pronunciationErrorKey,
  ipaByKey,
  onCopy,
  onSave,
  onSpeak,
}: ReaderResultBodyProps) {
  const shared = {
    copiedLabel,
    speakingKey,
    pronunciationErrorKey,
    pronunciationAccent,
    ipaByKey,
    onCopy,
    onSpeak,
  };

  if (result.mode === "interpret") {
    if (result.status === "no_match") {
      return (
        <p className="reader-popover-note">
          {result.inferred_intent || "Add the sentence, show, speaker, or situation."}
        </p>
      );
    }
    if (result.status === "needs_clarification") {
      return <p className="reader-popover-note">{result.clarifying_question}</p>;
    }
    const interpretation = result.interpretation;
    if (!interpretation) return null;

    return (
      <div className="reader-popover-result">
        <ExplanatoryResultBlock
          kicker="Meaning in this context"
          text={interpretation.meaning_in_context}
          emphasis="primary"
          copyLabel="Meaning in this context"
          speechKey="interpretation-meaning"
          {...shared}
        />
        <ExplanatoryResultBlock
          kicker="Usage / reference"
          text={interpretation.usage_or_reference}
          copyLabel="Usage / reference"
          speechKey="interpretation-usage"
          {...shared}
        />
        {interpretation.example && (
          <ExplanatoryResultBlock
            kicker="Example"
            text={interpretation.example}
            copyLabel="Example"
            speechKey="interpretation-example"
            {...shared}
          />
        )}
      </div>
    );
  }

  if (result.status === "no_match") {
    return (
      <p className="reader-popover-note">
        {result.inferred_intent || "Try selecting a little more context."}
      </p>
    );
  }
  if (result.status === "needs_clarification") {
    return <p className="reader-popover-note">{result.clarifying_question}</p>;
  }
  if (!result.best_match || !result.natural_sentence) {
    return null;
  }

  return (
    <div className="reader-popover-result">
      {result.alternatives.length > 0 && (
        <div className="reader-popover-alternatives">
          {result.alternatives.map((alternative) => (
            <ExpressionRow
              key={`${alternative.text}-${alternative.expression_type}`}
              expression={alternative}
              {...shared}
            />
          ))}
        </div>
      )}

      <ExplanatoryResultBlock
        kicker="Natural version"
        text={result.natural_sentence}
        copyLabel="Natural version"
        speechKey="natural-version"
        {...shared}
      />

      {result.short_explanation && (
        <ExplanatoryResultBlock
          kicker="Explanation"
          text={result.short_explanation}
          copyLabel="Explanation"
          speechKey="short-explanation"
          {...shared}
        />
      )}

      <div className="reader-popover-footer">
        <button
          className={`icon-button save-result-button ${isSaved ? "saved-state" : ""}`}
          type="button"
          onClick={onSave}
          disabled={isSaved}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Saved locally" : "Save expression"}
          title={isSaved ? "Saved" : "Save expression"}
        >
          {isSaved ? <CheckIcon /> : <BookmarkIcon />}
        </button>
        {result.learnable_items.length > 0 && (
          <div className="learnable-row">
            {result.learnable_items.map((item) => (
              <span
                className="learnable-chip"
                key={`${item.text}-${item.expression_type}`}
              >
                {item.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" className="settings-icon" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
      />
    </svg>
  );
}

export default App;

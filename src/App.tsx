import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  apiErrorSchema,
  isSuccessfulResult,
  MAX_INPUT_LENGTH,
  MAX_SESSION_TURNS,
  sayItResultSchema,
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
  loadPronunciationPreferences,
  PronunciationService,
  savePronunciationPreferences,
  type PronunciationPreferences,
} from "./lib/pronunciation";
import { getIPA, getIPACacheKey } from "./lib/ipa";
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
  if (result.mode === "interpret") {
    if (result.interpretation) {
      return [
        `Expression: ${result.interpretation.expression}`,
        `Meaning: ${result.interpretation.meaning_in_context}`,
        `Usage or reference: ${result.interpretation.usage_or_reference}`,
      ].join(" ");
    }
    if (result.clarifying_question) {
      return `Clarification question: ${result.clarifying_question}`;
    }
    return "No reliable interpretation was found.";
  }

  if (result.best_match) {
    return [
      `Best match: ${result.best_match.text}`,
      result.natural_sentence
        ? `Natural version: ${result.natural_sentence}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (result.clarifying_question) {
    return `Clarification question: ${result.clarifying_question}`;
  }
  return "No reliable expression was found.";
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

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();
  if (!copied) {
    throw new Error("Clipboard access is unavailable.");
  }
}

function App() {
  const repositoryRef = useRef<LocalMemoryRepository | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<SayItResult | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContextTurn[]>(
    [],
  );
  const [savedItems, setSavedItems] = useState<SavedExpression[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
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

  useEffect(() => {
    const repository = new LocalMemoryRepository();
    repositoryRef.current = repository;
    setSavedItems(repository.list());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("sayit.theme", theme);
    } catch {
      // Theme persistence is optional; the current session still works.
    }
  }, [theme]);

  useEffect(() => {
    pronunciationServiceRef.current = new PronunciationService();
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
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  }, []);

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

  const retrieve = useCallback(async (value: string) => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    setResult(null);
    setActiveSavedId(null);

    try {
      const response = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: value,
          context: sessionContext.slice(-MAX_SESSION_TURNS),
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        throw new Error(
          parsedError.success
            ? parsedError.data.error.message
            : "SayIt could not complete this request.",
        );
      }

      const parsedResult = sayItResultSchema.safeParse(payload);
      if (!parsedResult.success) {
        throw new Error("SayIt received an invalid result.");
      }
      setResult(parsedResult.data);
      setSessionContext((currentContext) => [
        ...currentContext,
        {
          input: value,
          mode: parsedResult.data.mode,
          assistant_summary: summarizeResult(parsedResult.data),
        },
      ].slice(-MAX_SESSION_TURNS));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "SayIt could not complete this request.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [sessionContext]);

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

  const handleCopy = async (text: string, label: string) => {
    try {
      await copyToClipboard(text);
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel(null), 1600);
    } catch {
      setError("Clipboard access is unavailable.");
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
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <div>
            <div className="brand-name">SayIt</div>
            <div className="brand-tagline">Find the natural way to say it.</div>
          </div>
        </div>
        <div className="topbar-actions">
          <PronunciationControls
            preferences={pronunciationPreferences}
            onChange={updatePronunciationPreferences}
          />
          <button
            className="icon-button"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
          <button
            className="saved-button"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open saved expressions, ${savedItems.length} saved`}
          >
            <span aria-hidden="true">♡</span>
            Saved
            {savedItems.length > 0 && (
              <span className="saved-count">{savedItems.length}</span>
            )}
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="hero-copy" aria-labelledby="page-title">
          <p className="eyebrow">English expression tool</p>
          <h1 id="page-title">What are you trying to say?</h1>
          <p>
            Type the rough version. SayIt will find the natural word, phrase,
            sentence, or explain an expression in context.
          </p>
        </section>

        <form className="input-card" onSubmit={handleSubmit}>
          <label htmlFor="expression-input">Your thought</label>
          <textarea
            id="expression-input"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
              setActiveSavedId(null);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="e.g. put many things in some category by same feature"
            maxLength={MAX_INPUT_LENGTH}
            autoFocus
            aria-describedby="input-hint input-count"
            aria-busy={isSubmitting}
          />
          <div className="input-footer">
            <span id="input-hint">Enter to retrieve · Shift+Enter for a new line</span>
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
              <span>Your useful expression will appear here.</span>
            </div>
          )}
        </section>
      </main>

      {notice && <div className="toast" role="status">{notice}</div>}

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
      <div className="result-heading-row">
        <span className="result-kicker">Best match</span>
        <div className="result-actions">
          <button
            className={`secondary-button ${isSaved ? "saved-state" : ""}`}
            type="button"
            onClick={onSave}
            disabled={isSaved}
          >
            {isSaved ? "Saved locally" : "Save"}
          </button>
        </div>
      </div>
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
        <div className="explanation action-block">
          <span className="result-kicker">Explanation</span>
          <p>{result.short_explanation}</p>
          <ContextualActions
            text={result.short_explanation}
            label="Explanation"
            speechKey="short-explanation"
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        </div>
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
      <div className="result-heading-row">
        <span className="result-kicker">Expression</span>
      </div>
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

      <div className="result-section">
        <span className="result-kicker">Meaning in this context</span>
        <div className="natural-sentence action-block">
          <p>{interpretation.meaning_in_context}</p>
          <ContextualActions
            text={interpretation.meaning_in_context}
            label="Meaning in this context"
            speechKey="interpretation-meaning"
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        </div>
      </div>

      <div className="result-section">
        <span className="result-kicker">Usage / reference</span>
        <div className="natural-sentence action-block">
          <p>{interpretation.usage_or_reference}</p>
          <ContextualActions
            text={interpretation.usage_or_reference}
            label="Usage / reference"
            speechKey="interpretation-usage"
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        </div>
      </div>

      {interpretation.example && (
        <div className="explanation action-block">
          <span className="result-kicker">Example</span>
          <p>{interpretation.example}</p>
          <ContextualActions
            text={interpretation.example}
            label="Example"
            speechKey="interpretation-example"
            copiedLabel={copiedLabel}
            speakingKey={speakingKey}
            pronunciationErrorKey={pronunciationErrorKey}
            onCopy={onCopy}
            onSpeak={onSpeak}
          />
        </div>
      )}
    </div>
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

interface CopyButtonProps {
  label: string;
  copied: boolean;
  onCopy: () => void;
}

function CopyButton({ label, copied, onCopy }: CopyButtonProps) {
  return (
    <button
      className={`copy-button ${copied ? "copied" : ""}`}
      type="button"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? "Copied" : "Copy"}
      onClick={onCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
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
  return (
    <div className="pronunciation-controls" aria-label="Pronunciation settings">
      <label>
        <span>Accent</span>
        <select
          value={preferences.accent}
          onChange={(event) =>
            onChange({
              ...preferences,
              accent: event.target.value as PronunciationPreferences["accent"],
            })
          }
        >
          <option value="us">US</option>
          <option value="uk">UK</option>
        </select>
      </label>
      <label>
        <span>Speed</span>
        <select
          value={preferences.speed}
          onChange={(event) =>
            onChange({
              ...preferences,
              speed: event.target.value as PronunciationPreferences["speed"],
            })
          }
        >
          <option value="normal">Normal</option>
          <option value="slow">Slow</option>
        </select>
      </label>
    </div>
  );
}

interface SpeakButtonProps {
  text: string;
  label: string;
  speaking: boolean;
  error: boolean;
  onSpeak: (text: string, key: string) => void;
  speechKey?: string;
}

function SpeakButton({
  text,
  label,
  speaking,
  error,
  onSpeak,
  speechKey = label.toLowerCase().replaceAll(" ", "-"),
}: SpeakButtonProps) {
  return (
    <button
      className={`speak-button ${speaking ? "speaking" : ""} ${
        error ? "error" : ""
      }`}
      type="button"
      aria-label={
        error
          ? `Pronunciation unavailable for ${label}`
          : `${speaking ? "Playing" : "Listen to"} ${label}`
      }
      aria-pressed={speaking}
      title={error ? "Listen unavailable" : speaking ? "Playing" : "Listen"}
      onClick={() => onSpeak(text, speechKey)}
    >
      {error ? <ErrorIcon /> : speaking ? <StopIcon /> : <SpeakerIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect x="5.25" y="2.25" width="8.5" height="9.5" rx="1.5" />
      <path d="M10.75 13.75H3.5A1.25 1.25 0 0 1 2.25 12.5V5.25" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="m3.25 8.25 3 3 6.5-6.5" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M2.5 6.25h2l3-2.5v8.5l-3-2.5h-2z" />
      <path d="M10 5.5a3.5 3.5 0 0 1 0 5" />
      <path d="M11.75 3.75a6 6 0 0 1 0 8.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M8 2.25 14 13.5H2z" />
      <path d="M8 6v3.25M8 11.5v.25" />
    </svg>
  );
}

export default App;

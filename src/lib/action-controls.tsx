import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDefinitionForSurface,
  isDictionaryLoaded,
  prefetchDictionary,
  type DictionaryDefinition,
} from "./local-dictionary";
import { getIPA } from "./ipa";
import type { PronunciationAccent } from "./pronunciation";

export interface CopyButtonProps {
  label: string;
  copied: boolean;
  onCopy: () => void;
}

export function CopyButton({ label, copied, onCopy }: CopyButtonProps) {
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

export interface SpeakButtonProps {
  text: string;
  label: string;
  speaking: boolean;
  error: boolean;
  onSpeak: (text: string, key: string) => void;
  speechKey?: string;
}

export function SpeakButton({
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

export interface SayItButtonProps {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onSayIt: () => void;
}

/**
 * Compact SayIt action built from the SayIt `S` brand mark. It stays an icon
 * control so Reader never grows a second text-button vocabulary.
 */
export function SayItButton({
  label,
  busy = false,
  disabled = false,
  onSayIt,
}: SayItButtonProps) {
  return (
    <button
      className={`sayit-button ${busy ? "is-busy" : ""}`}
      type="button"
      aria-label={label}
      title={busy ? "SayIt is working" : "SayIt"}
      aria-busy={busy}
      disabled={disabled || busy}
      onClick={onSayIt}
    >
      <SayItMarkIcon />
    </button>
  );
}

export function SayItMarkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sayit-mark-icon"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect x="1.4" y="1.4" width="13.2" height="13.2" rx="4" />
      <path
        d="M10.1 5.9c-.5-.6-1.3-.9-2.2-.9-1.4 0-2.3.7-2.3 1.7 0 1 .8 1.4 2.1 1.7 1.5.3 2.5.8 2.5 2 0 1.1-1 1.9-2.6 1.9-1.1 0-2-.3-2.6-1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CopyIcon() {
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

export function CheckIcon() {
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

export function SpeakerIcon() {
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

export function StopIcon() {
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

export function ErrorIcon() {
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

export function HistoryIcon() {
  return (
    <svg aria-hidden="true" className="action-icon" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.5v3.75l2.5 1.5" />
    </svg>
  );
}

export function BookmarkIcon() {
  return (
    <svg aria-hidden="true" className="action-icon" viewBox="0 0 16 16" fill="none">
      <path d="M4 2.25h8a.75.75 0 0 1 .75.75v10.5L8 10.5l-4.75 3V3a.75.75 0 0 1 .75-.75Z" />
    </svg>
  );
}

interface IdleWindow {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

export interface LexicalLookup {
  /** True while the definition is still being resolved. */
  loading: boolean;
  ipa: string | null;
  definition: DictionaryDefinition | null;
}

/**
 * Local pronunciation and dictionary extras for one word, readable by normal
 * SayIt and Reader so both surfaces show the same local-first content.
 */
export function useLexicalLookup(
  surface: string | null,
  accent: PronunciationAccent,
): LexicalLookup {
  const [state, setState] = useState<LexicalLookup>({
    loading: false,
    ipa: null,
    definition: null,
  });

  useEffect(() => {
    if (!surface) {
      setState({ loading: false, ipa: null, definition: null });
      return;
    }

    let cancelled = false;
    setState({ loading: !isDictionaryLoaded(), ipa: null, definition: null });

    const resolveDefinition = () => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        loading: false,
        definition: getDefinitionForSurface(surface),
      }));
    };

    void getIPA(surface, accent)
      .then((value) => {
        if (!cancelled) {
          setState((current) => ({ ...current, ipa: value }));
        }
      })
      .catch(() => undefined);

    if (isDictionaryLoaded()) {
      resolveDefinition();
    } else {
      void prefetchDictionary()
        .then(resolveDefinition)
        .catch(() => {
          if (!cancelled) {
            setState((current) => ({ ...current, loading: false }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [accent, surface]);

  return state;
}

/** Prefetch the local dictionary once a surface that may show it is mounted. */
export function useDictionaryPrefetch(): void {
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
}

/** Copy text with a clipboard fallback that works without the async API. */
export async function copyTextToClipboard(text: string): Promise<void> {
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

/** Shared copy handler with a short-lived "copied" acknowledgement. */
export function useCopyAction(onUnavailable: (message: string) => void) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await copyTextToClipboard(text);
        setCopiedLabel(label);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => setCopiedLabel(null), 1600);
      } catch {
        onUnavailable("Clipboard access is unavailable.");
      }
    },
    [onUnavailable],
  );

  return { copiedLabel, copy };
}

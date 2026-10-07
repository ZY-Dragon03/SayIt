export const PRONUNCIATION_STORAGE_KEY = "sayit.pronunciation.v1";

export type PronunciationAccent = "us" | "uk";
export type PronunciationSpeed = "normal" | "slow";

export interface PronunciationPreferences {
  accent: PronunciationAccent;
  speed: PronunciationSpeed;
}

export const DEFAULT_PRONUNCIATION_PREFERENCES: PronunciationPreferences = {
  accent: "us",
  speed: "normal",
};

const LOCALES: Record<PronunciationAccent, string> = {
  us: "en-US",
  uk: "en-GB",
};

const RATES: Record<PronunciationSpeed, number> = {
  normal: 1,
  slow: 0.8,
};

export interface PronunciationCallbacks {
  onStart: () => void;
  onEnd: () => void;
  onError: () => void;
}

export interface SpeechStartTiming {
  /** Milliseconds between the speak() call and the engine's onstart event. */
  startLatencyMs: number;
  /** Whether the voice list was already warm when the request was made. */
  voicesWarm: boolean;
}

export function loadPronunciationPreferences(
  storage?: Storage | null,
): PronunciationPreferences {
  const target =
    storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) {
    return DEFAULT_PRONUNCIATION_PREFERENCES;
  }

  try {
    const raw = target.getItem(PRONUNCIATION_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PRONUNCIATION_PREFERENCES;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PRONUNCIATION_PREFERENCES;
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      accent: candidate.accent === "uk" ? "uk" : "us",
      speed: candidate.speed === "slow" ? "slow" : "normal",
    };
  } catch {
    return DEFAULT_PRONUNCIATION_PREFERENCES;
  }
}

export function savePronunciationPreferences(
  preferences: PronunciationPreferences,
  storage?: Storage | null,
): void {
  const target =
    storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) {
    return;
  }
  try {
    target.setItem(PRONUNCIATION_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preference persistence is optional; playback continues in memory.
  }
}

export function getPronunciationLocale(
  accent: PronunciationAccent,
): string {
  return LOCALES[accent];
}

export function getPronunciationRate(speed: PronunciationSpeed): number {
  return RATES[speed];
}

export function selectPronunciationVoice(
  voices: readonly SpeechSynthesisVoice[],
  accent: PronunciationAccent,
): SpeechSynthesisVoice | undefined {
  const locale = getPronunciationLocale(accent).toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === locale) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${locale}-`)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
  );
}

type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;

type TimingReporter = (timing: SpeechStartTiming) => void;

/**
 * Shared Web Speech playback service for normal SayIt and Reader.
 *
 * The browser's speech engine can take seconds to answer the first speak()
 * request, so the voice list is resolved once, kept warm through
 * `voiceschanged`, and reused for every later request instead of being
 * rebuilt on each click.
 */
export class PronunciationService {
  private readonly synthesis: SpeechSynthesis | null;
  private readonly createUtterance: UtteranceFactory;
  private readonly reportTiming: TimingReporter | null;
  private requestId = 0;
  private warmed = false;
  private readonly cachedVoices = new Map<
    PronunciationAccent,
    SpeechSynthesisVoice | null
  >();

  constructor(
    synthesis: SpeechSynthesis | null =
      typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis
        : null,
    createUtterance: UtteranceFactory = (text) =>
      new SpeechSynthesisUtterance(text),
    reportTiming: TimingReporter | null = null,
  ) {
    this.synthesis = synthesis;
    this.createUtterance = createUtterance;
    this.reportTiming = reportTiming;
  }

  /** Resolve the voice list once and keep it fresh via `voiceschanged`. */
  warmUp(): void {
    if (this.warmed || !this.synthesis) {
      return;
    }
    this.warmed = true;

    try {
      if (typeof this.synthesis.addEventListener === "function") {
        this.synthesis.addEventListener("voiceschanged", this.handleVoicesChanged);
      } else {
        this.synthesis.onvoiceschanged = this.handleVoicesChanged;
      }
    } catch {
      // Engine change notifications are an optimization, not a requirement.
    }

    this.refreshVoices();
  }

  /** True once a voice list has been read from the engine. */
  get isWarm(): boolean {
    return this.warmed;
  }

  speak(
    text: string,
    preferences: PronunciationPreferences,
    callbacks: PronunciationCallbacks,
  ): void {
    if (!this.synthesis) {
      throw new Error("Speech playback is unavailable in this browser.");
    }

    this.warmUp();

    const requestId = ++this.requestId;
    const voicesWereWarm = this.hasResolvedVoice(preferences.accent);
    const requestedAt = now();

    // Only interrupt playback that actually exists. An unconditional cancel()
    // on every idle click is pure avoidable startup latency.
    try {
      if (this.synthesis.speaking || this.synthesis.pending) {
        this.synthesis.cancel();
      }
      if (this.synthesis.paused) {
        this.synthesis.resume();
      }
    } catch {
      // A status read that fails must not prevent the new utterance.
    }

    const utterance = this.createUtterance(text);
    utterance.lang = getPronunciationLocale(preferences.accent);
    utterance.rate = getPronunciationRate(preferences.speed);
    utterance.voice = this.resolveVoice(preferences.accent);

    utterance.onstart = () => {
      if (requestId !== this.requestId) {
        return;
      }
      this.reportTiming?.({
        startLatencyMs: Math.round((now() - requestedAt) * 100) / 100,
        voicesWarm: voicesWereWarm,
      });
      callbacks.onStart();
    };
    utterance.onend = () => {
      if (requestId === this.requestId) {
        callbacks.onEnd();
      }
    };
    utterance.onerror = () => {
      if (requestId === this.requestId) {
        callbacks.onError();
      }
    };

    try {
      this.synthesis.speak(utterance);
    } catch {
      if (requestId === this.requestId) {
        callbacks.onError();
      }
    }
  }

  stop(): void {
    this.requestId += 1;
    try {
      this.synthesis?.cancel();
    } catch {
      // Nothing to cancel when the engine is unavailable.
    }
  }

  private readonly handleVoicesChanged = (): void => {
    this.refreshVoices();
  };

  private refreshVoices(): void {
    if (!this.synthesis) {
      return;
    }
    this.cachedVoices.clear();
    // Reading the list here populates the engine's internal voice table, which
    // is what keeps the first real speak() call from blocking for seconds.
    this.resolveVoice("us");
    this.resolveVoice("uk");
  }

  private hasResolvedVoice(accent: PronunciationAccent): boolean {
    return this.cachedVoices.has(accent);
  }

  private resolveVoice(accent: PronunciationAccent): SpeechSynthesisVoice | null {
    if (this.cachedVoices.has(accent)) {
      return this.cachedVoices.get(accent) ?? null;
    }
    if (!this.synthesis) {
      return null;
    }

    let voice: SpeechSynthesisVoice | undefined;
    try {
      voice = selectPronunciationVoice(this.synthesis.getVoices(), accent);
    } catch {
      voice = undefined;
    }
    if (!voice) {
      // Do not cache a miss: a late `voiceschanged` may still deliver an
      // English voice, and a miss cached here would outlive it.
      return null;
    }
    this.cachedVoices.set(accent, voice);
    return voice;
  }
}

function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

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

export class PronunciationService {
  private readonly synthesis: SpeechSynthesis | null;
  private readonly createUtterance: UtteranceFactory;
  private requestId = 0;

  constructor(
    synthesis: SpeechSynthesis | null =
      typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis
        : null,
    createUtterance: UtteranceFactory = (text) =>
      new SpeechSynthesisUtterance(text),
  ) {
    this.synthesis = synthesis;
    this.createUtterance = createUtterance;
  }

  speak(
    text: string,
    preferences: PronunciationPreferences,
    callbacks: PronunciationCallbacks,
  ): void {
    if (!this.synthesis) {
      throw new Error("Speech playback is unavailable in this browser.");
    }

    const requestId = ++this.requestId;
    this.synthesis.cancel();
    const utterance = this.createUtterance(text);
    utterance.lang = getPronunciationLocale(preferences.accent);
    utterance.rate = getPronunciationRate(preferences.speed);

    try {
      utterance.voice = selectPronunciationVoice(
        this.synthesis.getVoices(),
        preferences.accent,
      ) ?? null;
    } catch {
      utterance.voice = null;
    }

    utterance.onstart = () => {
      if (requestId === this.requestId) {
        callbacks.onStart();
      }
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
    this.synthesis?.cancel();
  }
}

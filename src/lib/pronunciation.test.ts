import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRONUNCIATION_PREFERENCES,
  PronunciationService,
  loadPronunciationPreferences,
  savePronunciationPreferences,
  selectPronunciationVoice,
} from "./pronunciation";

function createStorage(initial?: string): Storage {
  let value = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  } as unknown as Storage;
}

function createUtterance(text: string): SpeechSynthesisUtterance {
  return {
    text,
    lang: "",
    rate: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
  } as unknown as SpeechSynthesisUtterance;
}

describe("pronunciation preferences", () => {
  it("loads defaults and persists the supported choices", () => {
    const storage = createStorage();
    expect(loadPronunciationPreferences(storage)).toEqual(
      DEFAULT_PRONUNCIATION_PREFERENCES,
    );

    savePronunciationPreferences({ accent: "uk", speed: "slow" }, storage);
    expect(loadPronunciationPreferences(storage)).toEqual({
      accent: "uk",
      speed: "slow",
    });
  });

  it("normalizes invalid persisted choices", () => {
    const storage = createStorage(
      JSON.stringify({ accent: "fr", speed: "fast", extra: true }),
    );
    expect(loadPronunciationPreferences(storage)).toEqual(
      DEFAULT_PRONUNCIATION_PREFERENCES,
    );
  });
});

describe("pronunciation voice and playback", () => {
  it("prefers the selected locale, then another English voice", () => {
    const usVoice = { lang: "en-US", name: "US voice" } as SpeechSynthesisVoice;
    const ukVoice = { lang: "en-GB", name: "UK voice" } as SpeechSynthesisVoice;
    const fallbackVoice = { lang: "en-AU", name: "English voice" } as SpeechSynthesisVoice;

    expect(selectPronunciationVoice([ukVoice, usVoice], "us")).toBe(usVoice);
    expect(selectPronunciationVoice([fallbackVoice], "uk")).toBe(fallbackVoice);
    expect(selectPronunciationVoice([], "us")).toBeUndefined();
  });

  it("cancels the previous utterance before speaking another", () => {
    const first = createUtterance("first");
    const second = createUtterance("second");
    const utterances = [first, second];
    const synthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      }),
    } as unknown as SpeechSynthesis;
    const service = new PronunciationService(
      synthesis,
      vi.fn(() => utterances.shift()!),
    );
    const onStart = vi.fn();

    service.speak("first", DEFAULT_PRONUNCIATION_PREFERENCES, {
      onStart,
      onEnd: vi.fn(),
      onError: vi.fn(),
    });
    service.speak("second", DEFAULT_PRONUNCIATION_PREFERENCES, {
      onStart,
      onEnd: vi.fn(),
      onError: vi.fn(),
    });

    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(first.lang).toBe("en-US");
    expect(first.rate).toBe(1);
    expect(second.lang).toBe("en-US");
    expect(second.rate).toBe(1);
  });
});

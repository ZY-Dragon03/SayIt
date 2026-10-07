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

  it("does not disturb an idle engine and only cancels playback that exists", () => {
    const first = createUtterance("first");
    const second = createUtterance("second");
    const utterances = [first, second];
    const usVoice = { lang: "en-US", name: "US voice" } as SpeechSynthesisVoice;
    const synthesis = {
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      getVoices: vi.fn(() => [usVoice]),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      }),
    } as unknown as SpeechSynthesis;
    const service = new PronunciationService(
      synthesis,
      vi.fn(() => utterances.shift()!),
    );
    const onStart = vi.fn();
    const callbacks = { onStart, onEnd: vi.fn(), onError: vi.fn() };

    service.warmUp();
    expect(synthesis.getVoices).toHaveBeenCalled();

    service.speak("first", DEFAULT_PRONUNCIATION_PREFERENCES, callbacks);
    // Nothing was speaking, so the idle first request must not cancel.
    expect(synthesis.cancel).not.toHaveBeenCalled();
    expect(synthesis.resume).not.toHaveBeenCalled();

    // Only a genuinely active engine is interrupted.
    (synthesis as unknown as { speaking: boolean }).speaking = true;
    service.speak("second", DEFAULT_PRONUNCIATION_PREFERENCES, callbacks);

    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(first.lang).toBe("en-US");
    expect(first.rate).toBe(1);
    expect(second.lang).toBe("en-US");
    expect(second.rate).toBe(1);
    expect(first.voice).toBe(usVoice);
    expect(second.voice).toBe(usVoice);
  });

  it("resumes a paused engine and reuses the voice list instead of re-reading it", () => {
    const synthesis = {
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: true,
      pending: false,
      speaking: false,
      getVoices: vi.fn(() => [
        { lang: "en-GB", name: "UK voice" } as SpeechSynthesisVoice,
      ]),
      speak: vi.fn(),
    } as unknown as SpeechSynthesis;
    const utterance = createUtterance("hello");
    const service = new PronunciationService(synthesis, () => utterance);

    service.warmUp();
    const readsAfterWarmUp = vi.mocked(synthesis.getVoices).mock.calls.length;

    service.speak("hello", { accent: "uk", speed: "slow" }, {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    });

    expect(synthesis.resume).toHaveBeenCalledTimes(1);
    expect(utterance.lang).toBe("en-GB");
    expect(utterance.rate).toBe(0.8);
    expect(utterance.voice?.lang).toBe("en-GB");
    // Voice resolution is cached; the click path adds no further reads.
    expect(vi.mocked(synthesis.getVoices).mock.calls.length).toBe(readsAfterWarmUp);
  });

  it("refreshes the cached voices when the engine reports voiceschanged", () => {
    const listeners: Array<() => void> = [];
    const synthesis = {
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.push(listener);
      }),
      removeEventListener: vi.fn(),
      getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]),
      speak: vi.fn(),
    } as unknown as SpeechSynthesis;
    const service = new PronunciationService(synthesis, (text) =>
      createUtterance(text),
    );

    service.warmUp();
    expect(listeners).toHaveLength(1);
    const readsAfterWarmUp = vi.mocked(synthesis.getVoices).mock.calls.length;

    vi.mocked(synthesis.getVoices).mockReturnValue([
      { lang: "en-US", name: "Late US voice" } as SpeechSynthesisVoice,
    ]);
    listeners[0]();

    expect(
      vi.mocked(synthesis.getVoices).mock.calls.length,
    ).toBeGreaterThan(readsAfterWarmUp);

    // The refreshed list is what the next click uses.
    const utterance = createUtterance("late");
    const lateService = new PronunciationService(synthesis, () => utterance);
    lateService.speak("late", DEFAULT_PRONUNCIATION_PREFERENCES, {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    });
    expect(utterance.voice?.name).toBe("Late US voice");
  });

  it("reports the measured click-to-onstart latency", () => {
    const timings: number[] = [];
    const synthesis = {
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      }),
    } as unknown as SpeechSynthesis;
    const service = new PronunciationService(
      synthesis,
      (text) => createUtterance(text),
      (timing) => timings.push(timing.startLatencyMs),
    );

    service.speak("timed", DEFAULT_PRONUNCIATION_PREFERENCES, {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    });

    expect(timings).toHaveLength(1);
    expect(timings[0]).toBeGreaterThanOrEqual(0);
  });
});

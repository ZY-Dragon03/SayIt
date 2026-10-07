// @vitest-environment jsdom
/**
 * Local measurement of the app-side speech startup cost.
 *
 * The model: the engine's cold path is a slow voice-table read plus an
 * unconditional cancel() before an idle speak(). The "before" helper
 * reproduces the previous click path exactly; the shipped PronunciationService
 * is the "after" case.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRONUNCIATION_PREFERENCES,
  PronunciationService,
  getPronunciationLocale,
  getPronunciationRate,
  selectPronunciationVoice,
} from "./pronunciation";

const COLD_VOICE_TABLE_MS = 900;
const CANCEL_STALL_MS = 260;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function voiceList(): SpeechSynthesisVoice[] {
  return [{ lang: "en-US", name: "US voice" } as SpeechSynthesisVoice];
}

/** The previous click path: unconditional cancel + synchronous getVoices. */
async function previousSpeak(
  synthesis: {
    cancel: () => void;
    getVoices: () => SpeechSynthesisVoice[];
    speak: (utterance: SpeechSynthesisUtterance) => void;
  },
  utterance: SpeechSynthesisUtterance,
): Promise<void> {
  synthesis.cancel();
  utterance.voice = selectPronunciationVoice(synthesis.getVoices(), "us") ?? null;
  synthesis.speak(utterance);
}

describe("speech startup latency", () => {
  it("removes the avoidable app-side cost between click and onstart", async () => {
    const createUtterance = (text: string) =>
      ({
        text,
        lang: "",
        rate: 1,
        voice: null,
        onstart: null,
        onend: null,
        onerror: null,
      }) as unknown as SpeechSynthesisUtterance;

    // "Before": every click pays the cold voice-table read and a cancel stall.
    let coldTableReady = false;
    let beforeStart: number | null = null;
    const beforeSynthesis = {
      cancel: vi.fn(() => {
        const until = performance.now() + CANCEL_STALL_MS;
        while (performance.now() < until) {
          // Busy-wait models a synchronous engine stall on the click thread.
        }
      }),
      getVoices: vi.fn(() => {
        if (!coldTableReady) {
          const until = performance.now() + COLD_VOICE_TABLE_MS;
          while (performance.now() < until) {
            // Synchronous cold read, as the browser does on first use.
          }
          coldTableReady = true;
        }
        return voiceList();
      }),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      }),
    };

    const beforeClick = performance.now();
    const beforeUtterance = createUtterance("psychologically");
    beforeUtterance.onstart = () => {
      beforeStart = performance.now();
    };
    await previousSpeak(beforeSynthesis, beforeUtterance);
    const beforeLatency = (beforeStart ?? performance.now()) - beforeClick;

    // "After": the voice table is warmed once at startup and the idle click
    // neither cancels nor re-reads the voice list.
    let afterColdTableReady = false;
    const afterSynthesis = {
      cancel: vi.fn(),
      resume: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      addEventListener: vi.fn(),
      getVoices: vi.fn(() => {
        if (!afterColdTableReady) {
          const until = performance.now() + COLD_VOICE_TABLE_MS;
          while (performance.now() < until) {
            // Same cold read, but it happens once during warm-up.
          }
          afterColdTableReady = true;
        }
        return voiceList();
      }),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
      }),
    };

    const timings: number[] = [];
    const service = new PronunciationService(
      afterSynthesis as unknown as SpeechSynthesis,
      createUtterance,
      (timing) => timings.push(timing.startLatencyMs),
    );

    const warmUpStarted = performance.now();
    service.warmUp();
    const warmUpCost = performance.now() - warmUpStarted;
    const voiceReadsAtWarmUp = afterSynthesis.getVoices.mock.calls.length;

    const afterClick = performance.now();
    service.speak("psychologically", DEFAULT_PRONUNCIATION_PREFERENCES, {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    });
    const afterLatency = performance.now() - afterClick;

    // The cold cost moved to startup, out of the click path.
    expect(warmUpCost).toBeGreaterThan(COLD_VOICE_TABLE_MS);
    expect(voiceReadsAtWarmUp).toBeGreaterThan(0);
    expect(afterSynthesis.getVoices.mock.calls.length).toBe(voiceReadsAtWarmUp);
    expect(afterSynthesis.cancel).not.toHaveBeenCalled();
    expect(afterLatency).toBeLessThan(50);
    expect(beforeLatency).toBeGreaterThan(1000);
    expect(timings).toHaveLength(1);

    console.info(
      `[speech latency] before=${beforeLatency.toFixed(1)}ms after=${afterLatency.toFixed(1)}ms ` +
        `warmUp=${warmUpCost.toFixed(1)}ms`,
    );
  });

  it("keeps US/UK locales and 1x/0.8x rates unchanged", () => {
    expect(getPronunciationLocale("us")).toBe("en-US");
    expect(getPronunciationLocale("uk")).toBe("en-GB");
    expect(getPronunciationRate("normal")).toBe(1);
    expect(getPronunciationRate("slow")).toBe(0.8);
  });
});

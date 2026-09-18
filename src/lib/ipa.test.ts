import { describe, expect, it, vi } from "vitest";
import {
  createPronunciationLookup,
  getIPACacheKey,
  isClearlyNonLanguageInput,
} from "./ipa";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as unknown as Storage;
}

describe("local IPA lookup", () => {
  it("uses phonemizer's US and UK voice mappings", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const lookup = createPronunciationLookup({
      storage: null,
      loadEngine: async () => ({
        phonemize: vi.fn(async (text: string, language?: string) => {
          calls.push([text, language]);
          return [language === "en-us" ? "ɹˈoʊd haʊs" : "ɹˈəʊd hˈaʊs"];
        }),
      }),
    });

    await expect(lookup.getIPA("Road House", "us")).resolves.toBe(
      "/ɹˈoʊd haʊs/",
    );
    await expect(lookup.getIPA("Road House", "uk")).resolves.toBe(
      "/ɹˈəʊd hˈaʊs/",
    );
    expect(calls).toEqual([
      ["Road House", "en-us"],
      ["Road House", "en"],
    ]);
  });

  it("reuses same-accent entries and keeps US/UK cache keys separate", async () => {
    const storage = createStorage();
    const phonemize = vi.fn(async (_text: string, language?: string) => [
      language === "en-us" ? "kˈɑːɹ" : "kˈɑː",
    ]);
    const firstLookup = createPronunciationLookup({
      storage,
      loadEngine: async () => ({ phonemize }),
    });

    await expect(firstLookup.getIPA(" car ", "us")).resolves.toBe("/kˈɑːɹ/");
    await expect(firstLookup.getIPA("car", "us")).resolves.toBe("/kˈɑːɹ/");
    await expect(firstLookup.getIPA("car", "uk")).resolves.toBe("/kˈɑː/");
    expect(phonemize).toHaveBeenCalledTimes(2);
    expect(getIPACacheKey(" car ", "us")).not.toBe(
      getIPACacheKey("car", "uk"),
    );

    const reloadedLookup = createPronunciationLookup({
      storage,
      loadEngine: async () => ({
        phonemize: vi.fn(async () => ["should not run"]),
      }),
    });
    await expect(reloadedLookup.getIPA("car", "us")).resolves.toBe("/kˈɑːɹ/");
  });

  it("deduplicates concurrent lookups and isolates engine failures", async () => {
    let resolveOutput: ((value: string[]) => void) | undefined;
    const phonemize = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveOutput = resolve;
        }),
    );
    const lookup = createPronunciationLookup({
      storage: null,
      loadEngine: async () => ({ phonemize }),
    });

    const first = lookup.getIPA("categorize", "us");
    const second = lookup.getIPA("categorize", "us");
    await vi.waitFor(() => {
      expect(phonemize).toHaveBeenCalledTimes(1);
    });
    resolveOutput?.(["kˈætəɡəɹaɪz"]);
    await expect(first).resolves.toBe("/kˈætəɡəɹaɪz/");
    await expect(second).resolves.toBe("/kˈætəɡəɹaɪz/");

    const failingLookup = createPronunciationLookup({
      storage: null,
      loadEngine: async () => ({
        phonemize: vi.fn(async () => {
          throw new Error("engine unavailable");
        }),
      }),
    });
    await expect(failingLookup.getIPA("Road House", "us")).resolves.toBeNull();

    const emptyLookup = createPronunciationLookup({
      storage: null,
      loadEngine: async () => ({
        phonemize: vi.fn(async () => ["", "  "]),
      }),
    });
    await expect(emptyLookup.getIPA("Road House", "us")).resolves.toBeNull();
  });

  it("keeps lookup available when cache storage fails", async () => {
    const storage = {
      getItem: () => {
        throw new Error("storage read failed");
      },
      setItem: () => {
        throw new Error("storage write failed");
      },
    } as unknown as Storage;
    const lookup = createPronunciationLookup({
      storage,
      loadEngine: async () => ({
        phonemize: vi.fn(async () => ["kˈɑːɹ"]),
      }),
    });

    await expect(lookup.getIPA("car", "us")).resolves.toBe("/kˈɑːɹ/");
  });

  it("filters empty and clearly code-like input without loading the engine", async () => {
    const loadEngine = vi.fn(async () => ({
      phonemize: vi.fn(async () => ["should not run"]),
    }));
    const lookup = createPronunciationLookup({
      storage: null,
      loadEngine,
    });

    await expect(lookup.getIPA("   ", "us")).resolves.toBeNull();
    await expect(lookup.getIPA("https://example.com", "us")).resolves.toBeNull();
    await expect(lookup.getIPA("{ foo: bar }", "us")).resolves.toBeNull();
    expect(isClearlyNonLanguageInput("12345")).toBe(true);
    expect(isClearlyNonLanguageInput("I")).toBe(false);
    expect(loadEngine).not.toHaveBeenCalled();
  });
});

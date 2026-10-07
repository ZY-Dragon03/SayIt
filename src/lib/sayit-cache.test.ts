import { describe, expect, it, vi } from "vitest";
import {
  SAYIT_CACHE_SCHEMA_VERSION,
  SAYIT_CACHE_STORAGE_KEY,
  buildSayItCacheIdentity,
  LocalSayItCacheRepository,
} from "./sayit-cache";
import { resolveSayItRequest } from "./sayit-resolver";
import type { SayItResult } from "../shared/contract";

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

const successResult: SayItResult = {
  schema_version: "1",
  mode: "retrieve",
  status: "success",
  normalized_input: "psychologically",
  inferred_intent: "Find a natural expression.",
  best_match: { text: "psychologically", expression_type: "word" },
  alternatives: [],
  natural_sentence: "She approached it psychologically.",
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: null,
};

const clarificationResult: SayItResult = {
  schema_version: "1",
  mode: "retrieve",
  status: "needs_clarification",
  normalized_input: "bank",
  inferred_intent: "Ambiguous.",
  best_match: null,
  alternatives: [],
  natural_sentence: null,
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: "Which sense of bank do you mean?",
};

describe("SayIt cache identity", () => {
  it("normalizes a single lexical word to one shared identity", () => {
    const identities = [
      "Psychologically",
      " psychologically ",
      "PSYCHOLOGICALLY",
    ].map((selection) =>
      buildSayItCacheIdentity({ selection, source: "sayit" }),
    );

    expect(new Set(identities).size).toBe(1);
    expect(identities[0]).toBe("word:psychologically");
    // Reader and normal SayIt must agree on the word identity.
    expect(
      buildSayItCacheIdentity({
        selection: "PSYCHOLOGICALLY",
        source: "reader",
        context: "She explained the result psychologically.",
      }),
    ).toBe("word:psychologically");
  });

  it("keeps context-sensitive phrases apart and context-free input together", () => {
    const firstSentence = buildSayItCacheIdentity({
      selection: "held rates steady",
      source: "reader",
      context: "The bank held rates steady after the vote.",
    });
    const secondSentence = buildSayItCacheIdentity({
      selection: "held rates steady",
      source: "reader",
      context: "Markets held rates steady through the summer.",
    });

    expect(firstSentence).not.toBe(secondSentence);
    expect(
      buildSayItCacheIdentity({
        selection: "  Sort   ideas by shared traits ",
        source: "sayit",
      }),
    ).toBe("sayit:sort ideas by shared traits");
  });

  it("bumps the schema version independently of History storage", () => {
    expect(SAYIT_CACHE_STORAGE_KEY).not.toContain("history");
    expect(SAYIT_CACHE_SCHEMA_VERSION).toBe(1);
  });
});

describe("shared SayIt result cache", () => {
  it("stores only validated successful results", () => {
    const cache = new LocalSayItCacheRepository(createStorage());

    expect(cache.put("word:bank", clarificationResult)).toBeNull();
    expect(cache.get("word:bank")).toBeNull();

    expect(cache.put("word:psychologically", successResult)).toEqual(
      successResult,
    );
    expect(cache.get("word:psychologically")).toEqual(successResult);
  });

  it("persists across repository instances and ignores stale schema versions", () => {
    const storage = createStorage();
    const first = new LocalSayItCacheRepository(storage);
    first.put("word:psychologically", successResult);

    const second = new LocalSayItCacheRepository(storage);
    expect(second.get("word:psychologically")).toEqual(successResult);

    storage.setItem(
      SAYIT_CACHE_STORAGE_KEY,
      JSON.stringify({ version: 0, entries: [] }),
    );
    expect(new LocalSayItCacheRepository(storage).get("word:psychologically")).toBeNull();
  });
});

describe("resolveSayItRequest", () => {
  it("calls the provider once and serves the repeat from local cache", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(successResult);

    const first = await resolveSayItRequest({
      selection: "Psychologically",
      source: "sayit",
      cache,
      retrieve,
    });
    const second = await resolveSayItRequest({
      selection: " psychologically ",
      source: "sayit",
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.cacheIdentity).toBe(first.cacheIdentity);
  });

  it("lets Reader and normal SayIt share one word entry", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(successResult);

    await resolveSayItRequest({
      selection: "psychologically",
      source: "reader",
      contextText: "She explained the result psychologically.",
      requestInput: "Interpret the selected expression …",
      cache,
      retrieve,
    });
    await resolveSayItRequest({
      selection: "PSYCHOLOGICALLY",
      source: "sayit",
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("sends the Reader prompt while keying on the selection and sentence", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(successResult);
    const prompt = "Interpret the selected expression “held rates steady”.";

    await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: "The bank held rates steady after the vote.",
      requestInput: prompt,
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledWith(prompt, []);
    // The stored identity is the selection + context, never the prompt text.
    expect(cache.list()[0]?.key).toContain("held rates steady");
    expect(cache.list()[0]?.key).not.toContain("Interpret the selected");
  });

  it("never caches a clarification or no-match answer", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(clarificationResult);

    await resolveSayItRequest({
      selection: "bank",
      source: "sayit",
      cache,
      retrieve,
    });
    await resolveSayItRequest({
      selection: "bank",
      source: "sayit",
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(cache.list()).toHaveLength(0);
  });

  it("does not answer a different Reader context from the same phrase entry", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(successResult);

    await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: "The bank held rates steady after the vote.",
      cache,
      retrieve,
    });
    await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: "Markets held rates steady through the summer.",
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});

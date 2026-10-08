import { describe, expect, it, vi } from "vitest";
import {
  SAYIT_CACHE_SCHEMA_VERSION,
  SAYIT_CACHE_STORAGE_KEY,
  SUPERSEDED_SAYIT_CACHE_STORAGE_KEYS,
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
    expect(firstSentence).toBe(
      "reader:held rates steady:the bank held rates steady after the vote.",
    );
    expect(
      buildSayItCacheIdentity({
        selection: "  Sort   ideas by shared traits ",
        source: "sayit",
      }),
    ).toBe("sayit:sort ideas by shared traits");
  });

  it("includes the selection so equal-length phrases in one sentence differ", () => {
    const sentence = "The bank held rates steady after the vote.";
    const heldRatesSteady = buildSayItCacheIdentity({
      selection: "held rates steady",
      source: "reader",
      context: sentence,
    });
    const afterTheVote = buildSayItCacheIdentity({
      selection: "after the vote",
      source: "reader",
      context: sentence,
    });
    const differentLength = buildSayItCacheIdentity({
      selection: "the vote",
      source: "reader",
      context: sentence,
    });

    // Regression: the previous identity was `reader:<wordCount>:<context>`, so
    // all three of these collapsed into the same entry.
    expect(new Set([heldRatesSteady, afterTheVote, differentLength]).size).toBe(3);
    expect(heldRatesSteady).toBe(
      "reader:held rates steady:the bank held rates steady after the vote.",
    );
    expect(afterTheVote).toBe(
      "reader:after the vote:the bank held rates steady after the vote.",
    );
    // Normal SayIt multi-word identity stays unchanged.
    expect(
      buildSayItCacheIdentity({ selection: "after the vote", source: "sayit" }),
    ).toBe("sayit:after the vote");
  });

  it("bounds over-long contextual identities while keeping them distinct", () => {
    const longContext = `${"word ".repeat(200)}end`.trim();
    const first = buildSayItCacheIdentity({
      selection: "held rates steady",
      source: "reader",
      context: longContext,
    });
    const second = buildSayItCacheIdentity({
      selection: "after the vote",
      source: "reader",
      context: longContext,
    });

    expect(first.length).toBeLessThanOrEqual(640);
    expect(second.length).toBeLessThanOrEqual(640);
    expect(first).not.toBe(second);
  });

  it("carries a schema version that invalidates superseded contextual entries", () => {
    expect(SAYIT_CACHE_STORAGE_KEY).not.toContain("history");
    expect(SAYIT_CACHE_STORAGE_KEY).toBe("sayit.result-cache.v2");
    expect(SAYIT_CACHE_SCHEMA_VERSION).toBe(2);
    expect(SUPERSEDED_SAYIT_CACHE_STORAGE_KEYS).toContain(
      "sayit.result-cache.v1",
    );
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

  it("persists across repository instances and ignores a mismatched envelope version", () => {
    const storage = createStorage();
    const first = new LocalSayItCacheRepository(storage);
    first.put("word:psychologically", successResult);

    const second = new LocalSayItCacheRepository(storage);
    expect(second.get("word:psychologically")).toEqual(successResult);

    storage.setItem(
      SAYIT_CACHE_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [] }),
    );
    expect(
      new LocalSayItCacheRepository(storage).get("word:psychologically"),
    ).toBeNull();
  });

  it("does not consume superseded version 1 contextual entries", () => {
    const storage = createStorage();
    const sentence = "The bank held rates steady after the vote.";
    // A version 1 entry as this app wrote it: word count instead of selection.
    storage.setItem(
      "sayit.result-cache.v1",
      JSON.stringify({
        version: 1,
        entries: [
          {
            key: `reader:3:${sentence.toLowerCase()}`,
            created_at: new Date().toISOString(),
            result: successResult,
          },
          {
            key: "word:psychologically",
            created_at: new Date().toISOString(),
            result: successResult,
          },
        ],
      }),
    );

    const cache = new LocalSayItCacheRepository(storage);
    const identity = buildSayItCacheIdentity({
      selection: "held rates steady",
      source: "reader",
      context: sentence,
    });

    // Nothing from the old schema is readable, and the old key is discarded.
    expect(cache.get(identity)).toBeNull();
    expect(cache.get("word:psychologically")).toBeNull();
    expect(storage.getItem("sayit.result-cache.v1")).toBeNull();
    expect(cache.list()).toEqual([]);
  });

  it("keeps the context-free word entry shared across Reader and SayIt", () => {
    const storage = createStorage();
    const cache = new LocalSayItCacheRepository(storage);
    const readerIdentity = buildSayItCacheIdentity({
      selection: "  psychologically ",
      source: "reader",
      context: "She explained the result psychologically.",
    });
    const sayItIdentity = buildSayItCacheIdentity({
      selection: "PSYCHOLOGICALLY",
      source: "sayit",
    });

    expect(readerIdentity).toBe("word:psychologically");
    expect(cache.put(readerIdentity, successResult)).toEqual(successResult);
    expect(cache.get(sayItIdentity)).toEqual(successResult);
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

  it("resolves the same Reader phrase and sentence from one entry", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const retrieve = vi.fn().mockResolvedValue(successResult);
    const sentence = "The bank held rates steady after the vote.";

    const first = await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });
    const second = await resolveSayItRequest({
      selection: " held   rates steady ",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.cacheIdentity).toBe(first.cacheIdentity);
  });

  it("never answers two same-length Reader selections in one sentence from one entry", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const sentence = "The bank held rates steady after the vote.";
    const threeWordResult: SayItResult = {
      ...successResult,
      normalized_input: "held rates steady",
      best_match: { text: "held rates steady", expression_type: "phrase" },
    };
    const otherThreeWordResult: SayItResult = {
      ...successResult,
      normalized_input: "after the vote",
      best_match: { text: "after the vote", expression_type: "phrase" },
    };
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(threeWordResult)
      .mockResolvedValueOnce(otherThreeWordResult);

    const first = await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });
    const second = await resolveSayItRequest({
      selection: "after the vote",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });

    // Regression: identical word count in the same sentence used to collide, so
    // the second selection was answered from the first selection's entry.
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(second.cacheHit).toBe(false);
    expect(second.cacheIdentity).not.toBe(first.cacheIdentity);
    expect(
      second.result.mode === "retrieve"
        ? second.result.best_match?.text
        : second.result.interpretation?.expression,
    ).toBe("after the vote");
    expect(cache.list().map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "reader:held rates steady:the bank held rates steady after the vote.",
        "reader:after the vote:the bank held rates steady after the vote.",
      ]),
    );

    // Both entries stay usable for their own selection.
    const repeatFirst = await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });
    const repeatSecond = await resolveSayItRequest({
      selection: "after the vote",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(
      repeatFirst.result.mode === "retrieve"
        ? repeatFirst.result.best_match?.text
        : repeatFirst.result.interpretation?.expression,
    ).toBe("held rates steady");
    expect(
      repeatSecond.result.mode === "retrieve"
        ? repeatSecond.result.best_match?.text
        : repeatSecond.result.interpretation?.expression,
    ).toBe("after the vote");
  });

  it("never answers a different-length Reader selection from another entry", async () => {
    const cache = new LocalSayItCacheRepository(createStorage());
    const sentence = "The bank held rates steady after the vote.";
    const retrieve = vi.fn().mockResolvedValue(successResult);

    await resolveSayItRequest({
      selection: "held rates steady",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });
    const shorter = await resolveSayItRequest({
      selection: "the vote",
      source: "reader",
      contextText: sentence,
      cache,
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(shorter.cacheHit).toBe(false);
  });
});

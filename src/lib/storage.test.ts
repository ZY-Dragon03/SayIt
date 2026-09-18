import { describe, expect, it } from "vitest";
import { LocalMemoryRepository, savedExpressionStorageKey } from "./storage";
import type { RetrievalResult } from "../shared/contract";

const result: RetrievalResult = {
  schema_version: "1",
  status: "success",
  normalized_input: "type on keyboard and make mistakes",
  inferred_intent: "describe making typing mistakes",
  best_match: {
    text: "make typos",
    base_form: "make typos",
    expression_type: "lexical_chunk",
  },
  alternatives: [],
  natural_sentence: "I make typos when typing in English.",
  short_explanation: null,
  typo_corrections: [
    { original: "keybroad", corrected: "keyboard", kind: "spelling_noise" },
  ],
  learnable_items: [
    { text: "make typos", expression_type: "lexical_chunk", why: null },
  ],
  clarifying_question: null,
};

function createStorage() {
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

describe("LocalMemoryRepository", () => {
  it("saves, lists, reloads, and removes a result", () => {
    const storage = createStorage();
    const repository = new LocalMemoryRepository(storage);
    const saved = repository.save("type in keybroad", result);

    expect(repository.list()).toHaveLength(1);
    expect(repository.list()[0].result.best_match?.text).toBe("make typos");

    const reloaded = new LocalMemoryRepository(storage);
    expect(reloaded.list()[0].id).toBe(saved.id);
    reloaded.remove(saved.id);
    expect(reloaded.list()).toHaveLength(0);
  });

  it("ignores a damaged storage envelope", () => {
    const storage = createStorage();
    storage.setItem(savedExpressionStorageKey, "{not-json");
    const repository = new LocalMemoryRepository(storage);
    expect(repository.list()).toEqual([]);
  });

  it("clears all saved results", () => {
    const storage = createStorage();
    const repository = new LocalMemoryRepository(storage);
    repository.save("one", result);
    repository.save("two", result);
    repository.clear();
    expect(repository.list()).toEqual([]);
  });
});

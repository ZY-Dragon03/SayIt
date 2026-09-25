import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  LocalHistoryRepository,
  localHistoryStorageKey,
} from "./history";
import type { SayItResult } from "../shared/contract";

const retrieveResult: SayItResult = {
  schema_version: "1",
  mode: "retrieve",
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
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: null,
};

const interpretResult: SayItResult = {
  schema_version: "1",
  mode: "interpret",
  status: "success",
  normalized_input: "Road House",
  inferred_intent: "ask about a movie phrase",
  interpretation: {
    expression: "Road House",
    kind: "cultural_reference",
    meaning_in_context: "A direct and forceful response.",
    usage_or_reference: "The phrase comes from a film title.",
    example: "He told them to be nice.",
  },
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

describe("LocalHistoryRepository", () => {
  it("skips a consecutive duplicate successful interaction", () => {
    const repository = new LocalHistoryRepository(createStorage());

    const first = repository.append("  Type on keyboard  ", retrieveResult);
    const duplicate = repository.append("type on keyboard", retrieveResult);

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(repository.list()).toHaveLength(1);
  });

  it("keeps only the newest 200 records", () => {
    const repository = new LocalHistoryRepository(createStorage());

    for (let index = 1; index <= HISTORY_LIMIT + 1; index += 1) {
      repository.append(`entry ${index}`, retrieveResult);
    }

    const items = repository.list();
    expect(items).toHaveLength(HISTORY_LIMIT);
    expect(items[0].input).toBe("entry 201");
    expect(items.at(-1)?.input).toBe("entry 2");
  });

  it("restores one context seed from an interpret result", () => {
    const repository = new LocalHistoryRepository(createStorage());
    const record = repository.append("Road House", interpretResult);
    expect(record).not.toBeNull();

    const restored = repository.restore(record!.id, () => "Only the restored result.");

    expect(restored?.record.result).toEqual(interpretResult);
    expect(restored?.context).toEqual([
      {
        input: "Road House",
        mode: "interpret",
        assistant_summary: "Only the restored result.",
      },
    ]);
  });

  it("does not append a failed result and ignores a damaged envelope", () => {
    const storage = createStorage();
    storage.setItem(localHistoryStorageKey, "{not-json");
    const repository = new LocalHistoryRepository(storage);

    expect(repository.list()).toEqual([]);
    expect(
      repository.append("type on keyboard", {
        ...retrieveResult,
        status: "no_match",
        best_match: null,
        natural_sentence: null,
      }),
    ).toBeNull();
    expect(repository.list()).toEqual([]);
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRetrieveHandler,
} from "./api";
import { ProviderError, type ExpressionProvider } from "./provider";
import type { RetrievalResult } from "../src/shared/contract";

const successfulResult: RetrievalResult = {
  schema_version: "1",
  status: "success",
  normalized_input: "organize items by shared features",
  inferred_intent: "put similar items into categories",
  best_match: {
    text: "categorize",
    base_form: "categorize",
    expression_type: "word",
  },
  alternatives: [],
  natural_sentence: "Categorize the items by their shared features.",
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [
    { text: "categorize", expression_type: "word", why: null },
  ],
  clarifying_question: null,
};

const clarificationResult: RetrievalResult = {
  schema_version: "1",
  status: "needs_clarification",
  normalized_input: "that thing with the words",
  inferred_intent: "an unclear reference to an expression",
  best_match: null,
  alternatives: [
    { text: "phrase", expression_type: "word" },
    { text: "wording", expression_type: "word" },
  ],
  natural_sentence: null,
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: "Are you looking for a word or a phrase?",
};

const noMatchResult: RetrievalResult = {
  schema_version: "1",
  status: "no_match",
  normalized_input: "blue triangle memory thunder",
  inferred_intent: "no reliable English expression found",
  best_match: null,
  alternatives: [],
  natural_sentence: null,
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [],
  clarifying_question: null,
};

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function requestWith(
  provider: ExpressionProvider,
  init: RequestInit = {},
): Promise<Response> {
  const server = createServer((request, response) => {
    void createRetrieveHandler(provider)(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}/api/retrieve`, init);
}

describe("retrieve API", () => {
  it("returns a validated result for valid input", async () => {
    const provider = {
      retrieve: vi.fn(async () => successfulResult),
    };
    const response = await requestWith(provider, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "put many things in some category" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "success",
      best_match: { text: "categorize" },
    });
    expect(provider.retrieve).toHaveBeenCalledWith(
      "put many things in some category",
    );
  });

  it("rejects empty input before calling the provider", async () => {
    const provider = {
      retrieve: vi.fn(async () => successfulResult),
    };
    const response = await requestWith(provider, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: " " }),
    });

    expect(response.status).toBe(400);
    expect(provider.retrieve).not.toHaveBeenCalled();
  });

  it("maps provider failures to a retryable API error", async () => {
    const provider = {
      retrieve: vi.fn(async () => {
        throw new ProviderError(
          "provider_timeout",
          "DeepSeek took too long to respond.",
          504,
        );
      }),
    };
    const response = await requestWith(provider, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "find a natural expression" }),
    });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "provider_timeout", retryable: true },
    });
  });

  it("passes clarification and no-match statuses through unchanged", async () => {
    for (const expected of [clarificationResult, noMatchResult]) {
      const provider = {
        retrieve: vi.fn(async () => expected),
      };
      const response = await requestWith(provider, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: expected.normalized_input }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: expected.status,
      });
    }
  });
});

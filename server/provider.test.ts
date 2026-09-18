import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  ProviderError,
  type ProviderDiagnostic,
} from "./provider";

function modelPayload(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

const validContent = JSON.stringify({
  schema_version: "1",
  mode: "retrieve",
  status: "success",
  normalized_input: "organize items",
  inferred_intent: "put similar items into categories",
  best_match: {
    text: "categorize",
    base_form: "categorize",
    expression_type: "word",
  },
  alternatives: [],
  natural_sentence: "Categorize the items.",
  short_explanation: null,
  typo_corrections: [],
  learnable_items: [
    { text: "categorize", expression_type: "word", why: null },
  ],
  clarifying_question: null,
});

const validInterpretationContent = JSON.stringify({
  schema_version: "1",
  mode: "interpret",
  status: "success",
  normalized_input: "road house",
  inferred_intent: "asking about a cultural reference",
  interpretation: {
    expression: "Road House",
    kind: "catchphrase",
    meaning_in_context:
      "A catchphrase or cultural reference, not a literal house beside a road.",
    usage_or_reference:
      "Peter Griffin uses it as a running gag referencing the movie Road House.",
    example: null,
  },
  clarifying_question: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeekProvider", () => {
  it("calls DeepSeek server-side and validates the structured response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => modelPayload(validContent),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({
      apiKey: "server-only-test-key",
      model: "deepseek-flash",
      baseUrl: "https://example.test",
    });
    const result = await provider.retrieve("put things into categories");

    expect(result.mode).toBe("retrieve");
    if (result.mode !== "retrieve") {
      throw new Error("Expected a retrieve result.");
    }
    expect(result.best_match?.text).toBe("categorize");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer server-only-test-key",
    });
    expect(String(init.body)).toContain("schema_version");
    expect(String(init.body)).toContain("make typos");
    expect(String(init.body)).toContain("slack off");
    expect(JSON.parse(String(init.body)).thinking).toEqual({
      type: "disabled",
    });
    expect(JSON.parse(String(init.body)).response_format).toEqual({
      type: "json_object",
    });
  });

  it("returns an interpretation result and includes bounded session context", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => modelPayload(validInterpretationContent),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({
      apiKey: "server-only-test-key",
      diagnostics: true,
    });
    const context = [
      {
        input: "road house",
        mode: "retrieve" as const,
        assistant_summary: "Best match: a house beside a road.",
      },
    ];
    const result = await provider.retrieve(
      "no, I mean what Peter says in the cartoon",
      context,
    );

    expect(result.mode).toBe("interpret");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[1].content).toContain("road house");
    expect(body.messages[1].content).toContain("Peter says in the cartoon");
  });

  it("repairs one invalid model response and then validates it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelPayload("not json"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelPayload(validContent),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({ apiKey: "server-only-test-key" });
    const result = await provider.retrieve("organize items");

    expect(result.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies empty and malformed content without logging content", async () => {
    for (const [invalidContent, expectedKind] of [
      ["", "empty_content"],
      ["not json", "malformed_json"],
    ] as const) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelPayload(invalidContent),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelPayload(validContent),
        });
      vi.stubGlobal("fetch", fetchMock);
      const diagnostics: ProviderDiagnostic[] = [];
      const provider = new DeepSeekProvider({
        apiKey: "server-only-test-key",
        diagnostics: true,
        diagnosticLogger: (diagnostic) => diagnostics.push(diagnostic),
      });

      await provider.retrieve("organize items");

      expect(diagnostics[0]?.kind).toBe(expectedKind);
      if (invalidContent) {
        expect(JSON.stringify(diagnostics)).not.toContain(invalidContent);
      }
    }
  });

  it("records safe diagnostics when repair remains schema-invalid", async () => {
    const invalidInterpretation = JSON.stringify({
      schema_version: "1",
      mode: "interpret",
      status: "success",
      normalized_input: "road house",
      inferred_intent: "asking about a reference",
      interpretation: {
        expression: "Road House",
        kind: "unsupported_category",
        meaning_in_context: "A reference.",
        usage_or_reference: "A reference.",
        example: null,
      },
      clarifying_question: null,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => modelPayload(invalidInterpretation),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const diagnostics: ProviderDiagnostic[] = [];

    const provider = new DeepSeekProvider({
      apiKey: "server-only-test-key",
      diagnostics: true,
      diagnosticLogger: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(provider.retrieve("road house")).rejects.toMatchObject({
      code: "invalid_provider_response",
      retryable: true,
    });
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      kind: "schema_invalid",
    });
    expect(
      diagnostics[0]?.issues?.some(
        (issue) => issue.path === "interpretation.kind",
      ),
    ).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("road house");
  });

  it("fails clearly when the server has no DeepSeek key", async () => {
    const provider = new DeepSeekProvider({});

    await expect(provider.retrieve("find an expression")).rejects.toMatchObject({
      code: "configuration_error",
      retryable: false,
    } satisfies Partial<ProviderError>);
  });
});

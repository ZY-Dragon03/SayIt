import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider, ProviderError } from "./provider";

function modelPayload(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

const validContent = JSON.stringify({
  schema_version: "1",
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

    expect(result.best_match?.text).toBe("categorize");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer server-only-test-key",
    });
    expect(String(init.body)).toContain("schema_version");
    expect(String(init.body)).toContain("make typos");
    expect(String(init.body)).toContain("slack off");
    expect(JSON.parse(String(init.body)).response_format).toEqual({
      type: "json_object",
    });
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

  it("fails clearly when the server has no DeepSeek key", async () => {
    const provider = new DeepSeekProvider({});

    await expect(provider.retrieve("find an expression")).rejects.toMatchObject({
      code: "configuration_error",
      retryable: false,
    } satisfies Partial<ProviderError>);
  });
});

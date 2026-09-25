import { describe, expect, it } from "vitest";
import { trimDictionaryGloss } from "./local-dictionary";

describe("trimDictionaryGloss", () => {
  it("removes recognized metadata and a trailing semicolon clause", () => {
    expect(
      trimDictionaryGloss('(linguistics) a morpheme; "a word example"'),
    ).toBe("a morpheme");
  });

  it("preserves dictionary wording and non-metadata parentheticals", () => {
    expect(
      trimDictionaryGloss("a humorous anecdote or remark intended to provoke laughter"),
    ).toBe("a humorous anecdote or remark intended to provoke laughter");
    expect(trimDictionaryGloss("(of quantities) imprecise but fairly close"))
      .toBe("(of quantities) imprecise but fairly close");
  });

  it("applies a word-boundary length cap without rewriting the text", () => {
    const gloss = "a clear dictionary definition with several ordinary words ".repeat(4);
    const trimmed = trimDictionaryGloss(gloss);

    expect(trimmed).not.toBeNull();
    expect(trimmed?.length).toBeLessThanOrEqual(121);
    expect(trimmed?.endsWith("…")).toBe(true);
    expect(trimmed?.slice(0, -1).endsWith(" ")).toBe(false);
  });
});

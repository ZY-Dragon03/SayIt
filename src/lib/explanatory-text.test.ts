import { describe, expect, it } from "vitest";
import { segmentExplanatoryText } from "./explanatory-text";

describe("segmentExplanatoryText", () => {
  it("keeps contractions and hyphenated words as one hover target", () => {
    const text = "Don't ask the co-worker.";
    const parts = segmentExplanatoryText(text);

    expect(parts).not.toBeNull();
    expect(parts?.filter((part) => part.isWordLike).map((part) => part.text)).toEqual([
      "Don't",
      "ask",
      "the",
      "co-worker",
    ]);
    expect(parts?.map((part) => part.text).join("")).toBe(text);
  });

  it("preserves punctuation and whitespace in the rendered sequence", () => {
    const text = "It's—well, a first-rate example!";
    const parts = segmentExplanatoryText(text);

    expect(parts?.map((part) => part.text).join("")).toBe(text);
    expect(parts?.filter((part) => part.isWordLike).map((part) => part.text)).toContain(
      "first-rate",
    );
  });
});

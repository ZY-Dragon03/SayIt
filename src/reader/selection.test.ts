import { describe, expect, it } from "vitest";
import {
  buildReaderInterpretationInput,
  expandTextSelection,
  findContainingSentence,
  isSingleWordSelection,
} from "./selection";

describe("Reader selection helpers", () => {
  it("expands partial endpoints to lexical word boundaries", () => {
    expect(expandTextSelection("investment", 2, 6)).toEqual({
      start: 0,
      end: 10,
      text: "investment",
    });
    expect(expandTextSelection("investment", 2, 10).text).toBe("investment");
    expect(expandTextSelection("global investment markets", 9, 22).text).toBe(
      "investment markets",
    );
    expect(expandTextSelection("don't", 1, 3).text).toBe("don't");
    expect(expandTextSelection("well-being", 1, 4).text).toBe("well-being");
    expect(expandTextSelection("investment", 0, 10).text).toBe("investment");
  });

  it("recognizes a single selected word without sending it to an interpretation flow", () => {
    expect(isSingleWordSelection("  policy  ")).toBe(true);
    expect(isSingleWordSelection("well-being")).toBe(true);
    expect(isSingleWordSelection("policy choice")).toBe(false);
    expect(isSingleWordSelection("policy,")).toBe(false);
  });

  it("finds the sentence containing the selected phrase", () => {
    expect(
      findContainingSentence(
        "Markets rose in the morning. The bank held rates steady after the vote. Traders adjusted their forecasts.",
        "held rates steady",
      ),
    ).toBe("The bank held rates steady after the vote.");
  });

  it("builds an explicit interpretation request with just the article sentence", () => {
    expect(
      buildReaderInterpretationInput(
        "held rates steady",
        "The bank held rates steady after the vote.",
      ),
    ).toBe(
      "Interpret the selected expression “held rates steady” in the context of this article sentence: “The bank held rates steady after the vote.”",
    );
  });

  it("never creates a request beyond SayIt's input limit", () => {
    const bounded = buildReaderInterpretationInput(
      "policy",
      `policy ${"context ".repeat(200)}`,
    );
    expect(bounded).not.toBeNull();
    expect(bounded!.length).toBeLessThanOrEqual(500);
    expect(bounded).toContain("policy");
    expect(buildReaderInterpretationInput("x".repeat(600), "A sentence.")).toBeNull();
    expect(buildReaderInterpretationInput("", "A sentence." )).toBeNull();
  });
});

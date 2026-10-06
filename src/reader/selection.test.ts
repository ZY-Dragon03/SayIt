import { describe, expect, it } from "vitest";
import {
  buildReaderInterpretationInput,
  findContainingSentence,
  isSingleWordSelection,
} from "./selection";

describe("Reader selection helpers", () => {
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

import { describe, expect, it } from "vitest";
import {
  morphologyCandidates,
  normalizeLexicalSurface,
  resolveLemma,
} from "./lemma-core.mjs";

const dictionary = new Set([
  "gag",
  "grant",
  "use",
  "reference",
  "kick",
  "child",
  "gas",
]);
const hasLemma = (lemma: string) => dictionary.has(lemma);

describe("resolveLemma", () => {
  it.each([
    ["granted", "grant"],
    ["uses", "use"],
    ["referencing", "reference"],
    ["kicked", "kick"],
    ["children", "child"],
  ])("resolves %s to %s", (surface, lemma) => {
    expect(resolveLemma(surface, hasLemma)).toBe(lemma);
  });

  it("checks an exact normalized token before morphology", () => {
    expect(resolveLemma("  GAG! ", hasLemma)).toBe("gag");
    expect(resolveLemma("gases", (lemma) => lemma === "gases" || lemma === "gas"))
      .toBe("gases");
  });

  it("uses a fixed candidate order and returns null when nothing matches", () => {
    expect(morphologyCandidates("uses").slice(0, 2)).toEqual(["use", "us"]);
    expect(normalizeLexicalSurface("‘Gag!’")).toBe("gag");
    expect(resolveLemma("xyznotaword", hasLemma)).toBeNull();
  });
});

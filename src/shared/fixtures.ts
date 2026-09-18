export const dogfoodFixtures = [
  {
    id: "concept-to-word",
    input: "put many things in some category by same feature",
    expectedStatus: "success",
    expectedBestMatch: "categorize",
  },
  {
    id: "typing-noise-to-chunk",
    input: "type in keybroad also make mistake",
    expectedStatus: "success",
    expectedBestMatch: "make typos",
  },
  {
    id: "semantic-noise-to-phrasal-verb",
    input: "nobody could say im hangging out",
    expectedStatus: "success",
    expectedBestMatch: "slack off",
  },
  {
    id: "ambiguous-input",
    input: "that thing with the words",
    expectedStatus: "needs_clarification",
  },
  {
    id: "no-reliable-match",
    input: "blue triangle memory thunder",
    expectedStatus: "no_match",
  },
  {
    id: "provider-timeout",
    input: "find a natural expression",
    expectedErrorCode: "provider_timeout",
  },
] as const;

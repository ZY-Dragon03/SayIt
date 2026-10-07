import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { assertFrozenCandidate } from "./candidate-guard";

assertFrozenCandidate();

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(acceptanceDirectory, "../../..");

export default defineConfig({
  root: candidateRoot,
  test: {
    include: ["artifacts/sayit-reader-v11/acceptance/**/*.acceptance.ts"],
    testTimeout: 90_000,
  },
});

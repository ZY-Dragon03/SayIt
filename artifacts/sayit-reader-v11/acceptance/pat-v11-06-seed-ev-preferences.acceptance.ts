import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ReaderStore } from "../../../server/reader/store";
import { readerPreferencesSchema } from "../../../src/shared/reader-contract";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(acceptanceDirectory, "../../..");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

it("seeds only saved EV battery preferences in a fresh isolated Reader store", async () => {
  const candidate = assertFrozenCandidate();
  const dataDirectory = process.env.SAYIT_ACCEPTANCE_READER_DATA_DIR;
  if (!dataDirectory) throw new Error("SAYIT_ACCEPTANCE_READER_DATA_DIR is required.");
  if (existsSync(dataDirectory)) throw new Error("The acceptance data directory already exists; refusing to reuse it.");

  const preferences = readerPreferencesSchema.parse({
    topics: ["Electric vehicle batteries"],
    dailyArticleCount: 1,
    difficulty: "Intermediate",
    readingBudgetMinutes: 60,
    collectionTime: "23:59",
    timezone: "Asia/Shanghai",
  });
  const currentLocalTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  expect(preferences.collectionTime > currentLocalTime).toBe(true);

  const editorialPath = path.join(candidateRoot, "server", "reader", "editorial.ts");
  const editorialSource = readFileSync(editorialPath);
  const editorialText = editorialSource.toString("utf8");
  const mapBlock = editorialText.match(
    /const ESTABLISHED_EDITORIAL_PUBLISHER_NAMES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/u,
  )?.[1];
  if (!mapBlock) throw new Error("Could not snapshot the candidate publisher-name normalization map.");
  const publisherNameMap = Object.fromEntries(
    [...mapBlock.matchAll(/^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/gmu)].map((match) => [match[1], match[2]]),
  );
  if (Object.keys(publisherNameMap).length === 0) throw new Error("The publisher-name map snapshot is empty.");

  const store = new ReaderStore({ directory: dataDirectory });
  await store.initialize();
  await store.update((state) => {
    state.preferences = preferences;
    state.preferencesConfigured = true;
  });
  const state = store.snapshot();
  expect(state.preferencesConfigured).toBe(true);
  expect(state.preferences).toEqual(preferences);
  expect(state.issues).toHaveLength(0);
  expect(state.attempts).toHaveLength(0);
  expect(state.traces).toHaveLength(0);

  const recordedAt = new Date().toISOString();
  const suffix = recordedAt.replaceAll(/[-:.]/gu, "").replace("T", "T").replace("Z", "Z");
  const evidencePath = path.join(acceptanceDirectory, `pat-v11-06-ev-preferences-seed-a33e7ff1-${suffix}.json`);
  const evidence = {
    candidate,
    observation: "PAT-V11-06 saved preferences seed; no collection or article URL input occurred in this setup step",
    recordedAt,
    isolatedDataDirectory: dataDirectory,
    savedPreferences: state.preferences,
    preferencesConfigured: state.preferencesConfigured,
    startupControl: {
      intendedLocalTimeAtSeed: currentLocalTime,
      collectionTimeIsFuture: true,
      collectionTime: preferences.collectionTime,
      attemptsBeforeServerStart: state.attempts.length,
      tracesBeforeServerStart: state.traces.length,
      issuesBeforeServerStart: state.issues.length,
      articleUrlListProvided: false,
    },
    productionPublisherNormalizationSnapshot: {
      source: "server/reader/editorial.ts#ESTABLISHED_EDITORIAL_PUBLISHER_NAMES",
      sourceSha256: sha256(editorialSource),
      mapBlockSha256: sha256(mapBlock),
      domains: Object.keys(publisherNameMap),
      publisherNames: Object.values(publisherNameMap),
    },
  };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { encoding: "utf8", flag: "wx" });
  process.stdout.write(`Seed evidence: ${path.basename(evidencePath)}\n`);
});

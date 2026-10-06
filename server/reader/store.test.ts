import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArticleSummary, DailyIssue } from "../../src/shared/reader-contract";
import { ReaderStore, ReaderStoreError } from "./store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-test-"));
  directories.push(directory);
  return directory;
}

function article(cachePermission: ArticleSummary["cachePermission"] = "PERMITTED"): ArticleSummary {
  return {
    id: "article-test-1",
    title: "A verified English article about technology",
    originalPublication: "Example News",
    originalUrl: "https://example.com/story",
    accessiblePublication: "Example News",
    accessibleUrl: "https://example.com/story",
    contentStatus: "FULL_TEXT",
    wordCount: 800,
    fkglWordCount: 790,
    sentenceCount: 30,
    syllableCount: 1_100,
    readingMinutes: 4,
    fkgl: 9.2,
    readState: "UNREAD",
    cachePermission,
    topics: ["Technology"],
    difficulty: "Intermediate",
    paragraphCount: 8,
  };
}

function issue(summary: ArticleSummary): DailyIssue {
  const timestamp = "2026-10-04T00:00:00.000Z";
  return {
    id: "issue-2026-10-04-Asia-Shanghai",
    localDate: "2026-10-04",
    timezone: "Asia/Shanghai",
    edition: 1,
    status: "PARTIAL",
    target: {
      topics: ["Technology"],
      dailyArticleCount: 3,
      difficulty: "Intermediate",
      readingBudgetMinutes: 20,
      collectionTime: "08:00",
      timezone: "Asia/Shanghai",
    },
    actual: {
      count: 1,
      topics: ["Technology"],
      difficulty: "Intermediate",
      readingMinutes: 4,
    },
    unmetConstraints: ["Article count: 1/3 verified full-text articles."],
    articles: [summary],
    createdAt: timestamp,
    updatedAt: timestamp,
    priorEditions: [],
  };
}

describe("Reader versioned local store", () => {
  it("persists preferences and metadata in a schema-versioned envelope", async () => {
    const directory = await createDirectory();
    const store = new ReaderStore({ directory, now: () => new Date("2026-10-04T00:00:00Z") });
    await store.initialize();
    await store.update((state) => {
      state.preferences = {
        ...state.preferences,
        topics: ["Technology", "Economy"],
        collectionTime: "18:15",
        timezone: "Asia/Shanghai",
      };
      state.preferencesConfigured = true;
    });

    const saved = JSON.parse(await readFile(path.join(directory, "reader-state.json"), "utf8"));
    expect(saved.schema_version).toBe(1);
    expect(saved.state.preferences.topics).toEqual(["Technology", "Economy"]);
    expect(saved.state.preferences.collectionTime).toBe("18:15");
    expect(saved.state.preferencesConfigured).toBe(true);
  });

  it("caches article bodies only when a full-text record explicitly permits it", async () => {
    const directory = await createDirectory();
    const store = new ReaderStore({ directory, now: () => new Date("2026-10-04T00:00:00Z") });
    await store.initialize();
    const allowed = article("PERMITTED");
    await store.update((state) => state.issues.push(issue(allowed)));
    const body = ["Authorized article paragraph.".repeat(20), "Second paragraph.", "Third paragraph."];
    const hash = "a".repeat(64);
    await store.saveCache(allowed.id, 1, hash, body);
    expect(await store.readCache(allowed.id, 1, hash)).toEqual(body);

    const stateFile = await readFile(path.join(directory, "reader-state.json"), "utf8");
    expect(stateFile).not.toContain("Authorized article paragraph");
    const reopened = new ReaderStore({ directory });
    await reopened.initialize();
    expect(await reopened.readCache(allowed.id, 1, hash)).toEqual(body);

    const deniedStore = new ReaderStore({ directory: await createDirectory() });
    await deniedStore.initialize();
    const denied = article("UNKNOWN");
    await deniedStore.update((state) => state.issues.push(issue(denied)));
    await expect(
      deniedStore.saveCache(denied.id, 1, hash, body),
    ).rejects.toBeInstanceOf(ReaderStoreError);
  });

  it("preserves a corrupt state file and fails closed instead of overwriting it", async () => {
    const directory = await createDirectory();
    const file = path.join(directory, "reader-state.json");
    await writeFile(file, "{not valid json", "utf8");
    const store = new ReaderStore({ directory });

    await expect(store.initialize()).rejects.toMatchObject({ code: "reader_store_unavailable" });
    expect(await readFile(file, "utf8")).toBe("{not valid json");
  });
});

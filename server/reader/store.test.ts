import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArticleSummary, DailyIssue } from "../../src/shared/reader-contract";
import { ReaderStore, ReaderStoreError } from "./store";

const directories: string[] = [];
const stores: ReaderStore[] = [];

afterEach(async () => {
  // SQLite keeps the file handle open, so every store must be closed before the
  // directory can be removed on Windows.
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5 }),
    ),
  );
});

/** Every store opened by a test, so the SQLite handle is closed before cleanup. */
function track<T extends ReaderStore>(store: T): T {
  stores.push(store);
  return store;
}

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
  it("applies a mutation on the committed version, not on the snapshot it was holding", async () => {
    const directory = await createDirectory();
    const now = () => new Date("2026-10-04T00:00:00Z");
    const server = track(new ReaderStore({ directory, now }));
    const task = track(new ReaderStore({ directory, now }));
    await server.initialize();
    await task.initialize();

    // A completed scheduled collection is committed by the other process...
    await task.update((state) => {
      state.issues.push(issue(article()));
      state.occurrences.push({
        id: "occurrence-2026-10-04-Asia-Shanghai",
        localDate: "2026-10-04",
        timezone: "Asia/Shanghai",
        localTime: "08:00",
        scheduledAt: "2026-10-04T00:00:00.000Z",
        status: "COMPLETED",
        scheduledAttemptCount: 1,
        maxScheduledAttempts: 3,
        nextAttemptAt: null,
        lastAttemptId: "attempt:one",
        updatedAt: "2026-10-04T00:00:00.000Z",
      });
    });
    // ...while the server still holds the version from before it.
    expect(server.snapshot().issues).toHaveLength(0);

    await server.update((state) => {
      state.progress.push({
        issueId: "issue-2026-10-04-Asia-Shanghai",
        articleId: "article-test-1",
        edition: 1,
        scrollRatio: 0.5,
        scrollTop: 100,
        firstVisibleParagraph: 3,
        paragraphOffset: 0,
        readState: "IN_PROGRESS",
        updatedAt: "2026-10-04T00:00:00.000Z",
      });
    });

    // The committed collection survives the stale process's unrelated write.
    const committed = track(new ReaderStore({ directory, now }));
    await committed.initialize();
    expect(committed.snapshot().issues).toHaveLength(1);
    expect(committed.snapshot().occurrences[0]).toMatchObject({ status: "COMPLETED" });
    expect(committed.snapshot().progress).toHaveLength(1);
  });

  it("never falls back to a stale in-memory copy when the committed state cannot be read", async () => {
    const directory = await createDirectory();
    const now = () => new Date("2026-10-04T00:00:00Z");
    const store = track(new ReaderStore({ directory, now }));
    await store.initialize();
    await store.update((state) => {
      state.issues.push(issue(article()));
    });
    expect(store.snapshot().issues).toHaveLength(1);

    // Corrupt the committed record behind the store's back.
    const database = new DatabaseSync(join(directory, "reader-state.db"));
    database.exec("UPDATE issues SET payload = '{not valid json'");
    database.close();

    // The failed read must surface, never silently reuse the stale copy.
    await expect(store.update((state) => state.issues.length)).rejects.toMatchObject({
      code: "reader_store_unavailable",
    });
    await expect(store.reload()).rejects.toMatchObject({
      code: "reader_store_unavailable",
    });
    // The stale copy was never written back over the committed record.
    expect(store.snapshot().issues).toHaveLength(1);
  });

  it("lets exactly one process claim the same attempt", async () => {
    const directory = await createDirectory();
    const now = () => new Date("2026-10-04T00:00:00Z");
    const server = track(new ReaderStore({ directory, now }));
    const task = track(new ReaderStore({ directory, now }));
    await server.initialize();
    await task.initialize();
    const request = {
      attemptId: "attempt:one",
      durationMs: 120_000,
      now: "2026-10-04T00:00:00.000Z",
    };

    const first = await server.claimRunLease({
      ...request,
      ownerId: "server:1",
      pid: 1,
      hostname: "host",
    });
    const second = await task.claimRunLease({
      ...request,
      ownerId: "task:2",
      pid: 2,
      hostname: "host",
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    // The loser is told who holds the work instead of taking it over.
    expect(second.lease).toMatchObject({ ownerId: "server:1" });
    // Once the claim lapses the other process may take it.
    const later = await task.claimRunLease({
      ...request,
      ownerId: "task:2",
      pid: 2,
      hostname: "host",
      now: "2026-10-04T00:03:00.000Z",
    });
    expect(later.claimed).toBe(true);
    await task.releaseRunLease("attempt:one", "task:2");
    // The releasing process sees it immediately; the other one adopts it on its
    // next read or write, because a snapshot is never authoritative.
    expect(task.snapshot().runLeases).toHaveLength(0);
    await server.reload();
    expect(server.snapshot().runLeases).toHaveLength(0);
  });

  it("never lets a stale process snapshot erase work another process committed", async () => {
    const directory = await createDirectory();
    const now = () => new Date("2026-10-04T00:00:00Z");

    // The development server and the scheduled task are separate processes
    // sharing this file. Both load it, then each writes.
    const devServer = track(new ReaderStore({ directory, now }));
    const scheduledTask = track(new ReaderStore({ directory, now }));
    await devServer.initialize();
    await scheduledTask.initialize();
    await devServer.update((state) => {
      state.preferencesConfigured = true;
    });

    // The task commits a completed collection, which the server never saw.
    await scheduledTask.update((state) => {
      state.issues.push(issue(article()));
      state.occurrences.push({
        id: "occurrence-2026-10-04-Asia-Shanghai",
        localDate: "2026-10-04",
        timezone: "Asia/Shanghai",
        localTime: "08:00",
        scheduledAt: "2026-10-04T00:00:00.000Z",
        status: "COMPLETED",
        scheduledAttemptCount: 1,
        maxScheduledAttempts: 3,
        nextAttemptAt: null,
        lastAttemptId: "attempt:one",
        updatedAt: "2026-10-04T00:00:00.000Z",
      });
    });

    // The server then writes an unrelated progress update from its old snapshot.
    await devServer.update((state) => {
      state.progress.push({
        issueId: "issue-2026-10-04-Asia-Shanghai",
        articleId: "article-test-1",
        edition: 1,
        scrollRatio: 0.5,
        scrollTop: 100,
        firstVisibleParagraph: 3,
        paragraphOffset: 0,
        readState: "IN_PROGRESS",
        updatedAt: "2026-10-04T00:00:00.000Z",
      });
    });

    // The committed collection must survive, and the progress update lands too.
    const committed = track(new ReaderStore({ directory, now }));
    await committed.initialize();
    expect(committed.snapshot().issues).toHaveLength(1);
    expect(committed.snapshot().occurrences[0]).toMatchObject({
      status: "COMPLETED",
      scheduledAttemptCount: 1,
    });
    expect(committed.snapshot().progress).toHaveLength(1);
  });

  it("gives a long-lived reader a fresh view of another process's writes", async () => {
    const directory = await createDirectory();
    const now = () => new Date("2026-10-04T00:00:00Z");
    const longLived = track(new ReaderStore({ directory, now }));
    await longLived.initialize();

    const writer = track(new ReaderStore({ directory, now }));
    await writer.initialize();
    await writer.update((state) => {
      state.issues.push(issue(article()));
    });

    // Without a reload the long-lived process would keep serving its startup copy.
    expect(longLived.snapshot().issues).toHaveLength(0);
    await longLived.reload();
    expect(longLived.snapshot().issues).toHaveLength(1);
  });

  it("persists preferences and metadata in a schema-versioned envelope", async () => {
    const directory = await createDirectory();
    const store = track(new ReaderStore({ directory, now: () => new Date("2026-10-04T00:00:00Z") }));
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

    const stored = track(new ReaderStore({ directory, now: () => new Date("2026-10-04T00:00:00Z") }));
    await stored.initialize();
    expect(stored.snapshot().preferences.topics).toEqual(["Technology", "Economy"]);
    expect(stored.snapshot().preferences.collectionTime).toBe("18:15");
    expect(stored.snapshot().preferencesConfigured).toBe(true);
  });

  it("caches article bodies only when a full-text record explicitly permits it", async () => {
    const directory = await createDirectory();
    const store = track(new ReaderStore({ directory, now: () => new Date("2026-10-04T00:00:00Z") }));
    await store.initialize();
    const allowed = article("PERMITTED");
    await store.update((state) => state.issues.push(issue(allowed)));
    const body = ["Authorized article paragraph.".repeat(20), "Second paragraph.", "Third paragraph."];
    const hash = "a".repeat(64);
    await store.saveCache(allowed.id, 1, hash, body);
    expect(await store.readCache(allowed.id, 1, hash)).toEqual(body);

    // The permitted body is preserved for the reader across a restart.
    const reopened = track(new ReaderStore({ directory }));
    await reopened.initialize();
    expect(await reopened.readCache(allowed.id, 1, hash)).toEqual(body);

    const deniedStore = track(new ReaderStore({ directory: await createDirectory() }));
    await deniedStore.initialize();
    const denied = article("UNKNOWN");
    await deniedStore.update((state) => state.issues.push(issue(denied)));
    await expect(
      deniedStore.saveCache(denied.id, 1, hash, body),
    ).rejects.toBeInstanceOf(ReaderStoreError);
  });

  it("persists editorial rationale and provenance across restart while reading historical records", async () => {
    const directory = await createDirectory();
    const store = track(new ReaderStore({ directory }));
    await store.initialize();
    const accepted = {
      ...article("NOT_PERMITTED"),
      provenance: {
        publisherIdentity: "Example News",
        publisherIdentitySources: ["open_graph_site_name" as const],
        canonicalRelationship: "original_url" as const,
        standaloneArticleVerified: true as const,
        titleAgreementVerified: true as const,
        bodyCompletenessVerified: true as const,
      },
      editorial: {
        contractVersion: "reader-editorial-curation.v1" as const,
        decision: "APPROVE" as const,
        topicFit: "YES" as const,
        matchedTopics: ["Technology"],
        relevance: "high" as const,
        editorialValue: "high" as const,
        analysisDepth: "medium" as const,
        novelty: "high" as const,
        overlap: "none" as const,
        contributionType: "analysis" as const,
        rationale: "It explains how regional evidence changes the energy market.",
      },
    };
    const semantic = {
      contractVersion: "reader-editorial-curation.v1" as const,
      status: "SUCCEEDED" as const,
      provider: "DeepSeek",
      model: "deepseek-flash",
      candidateIds: ["candidate-1"],
      inputSha256: "a".repeat(64),
      requestIds: ["request-1"],
      requestCount: 1,
      elapsedMs: 100,
      reason: null,
      decisions: [{ candidateId: "candidate-1", editorial: accepted.editorial }],
    };
    await store.update((state) => {
      state.issues.push(issue(accepted));
      state.traces.push({
        id: "trace:editorial-1",
        issueId: "issue-2026-10-04-Asia-Shanghai",
        edition: 1,
        createdAt: "2026-10-04T00:00:00.000Z",
        queries: [],
        candidates: [],
        decisions: [],
        semantic,
      });
    });

    const reopened = track(new ReaderStore({ directory }));
    await reopened.initialize();
    expect(reopened.snapshot().issues[0]?.articles[0]).toMatchObject({
      editorial: { rationale: accepted.editorial.rationale, contributionType: "analysis" },
      provenance: { publisherIdentity: "Example News", canonicalRelationship: "original_url" },
    });
    expect(reopened.snapshot().traces[0]?.semantic).toMatchObject({
      contractVersion: "reader-editorial-curation.v1",
      status: "SUCCEEDED",
      decisions: [{ editorial: { rationale: accepted.editorial.rationale } }],
    });

    // A record written by an earlier version — an older schema without
    // editorial metadata — still opens, and is adopted exactly once.
    const legacyDirectory = await createDirectory();
    const reduced = {
      schema_version: 1,
      updatedAt: "2026-10-04T00:00:00.000Z",
      state: {
        ...reopened.snapshot(),
        issues: reopened.snapshot().issues.map((item) => ({
          ...item,
          articles: item.articles.map(({ editorial: _editorial, provenance: _provenance, ...rest }) => rest),
        })),
        traces: reopened.snapshot().traces.map(({ semantic: _semantic, ...rest }) => rest),
      },
    };
    const legacyFile = join(legacyDirectory, "reader-state.json");
    await writeFile(legacyFile, JSON.stringify(reduced), "utf8");
    const historical = track(new ReaderStore({ directory: legacyDirectory }));
    await historical.initialize();
    expect(historical.snapshot().issues[0]?.articles[0]).toMatchObject({
      id: "article-test-1",
      contentStatus: "FULL_TEXT",
    });
    expect(historical.snapshot().traces[0]).not.toHaveProperty("semantic");
    expect(historical.snapshot().issues[0]?.articles[0]).not.toHaveProperty("editorial");

    // A second start does not re-adopt the file, so a later edit cannot
    // silently change committed history.
    await writeFile(legacyFile, JSON.stringify({ ...reduced, state: { ...reduced.state, issues: [] } }), "utf8");
    const restarted = track(new ReaderStore({ directory: legacyDirectory }));
    await restarted.initialize();
    expect(restarted.snapshot().issues).toHaveLength(1);
  });

  it("preserves a corrupt state file and fails closed instead of overwriting it", async () => {
    const directory = await createDirectory();
    const file = join(directory, "reader-state.json");
    await writeFile(file, "{not valid json", "utf8");
    const store = track(new ReaderStore({ directory }));

    // The unreadable history is never adopted, never overwritten, and never
    // replaced by an empty state.
    await expect(store.initialize()).rejects.toMatchObject({ code: "reader_store_unavailable" });
    expect(await readFile(file, "utf8")).toBe("{not valid json");
  });
});

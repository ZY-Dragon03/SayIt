import { homedir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { matchesArticleSummaryBody } from "./article-body";
import {
  articleSummarySchema,
  dailyIssueSchema,
  occurrenceSchema,
  readerPreferencesSchema,
  readingProgressSchema,
  readerSemanticRuntimeTraceSchema,
  runAttemptSchema,
  type ArticleSummary,
  type DailyIssue,
  type Occurrence,
  type ReaderPreferences,
  type ReadingProgress,
  type ReaderSemanticRuntimeTrace,
  type RunAttempt,
} from "../../src/shared/reader-contract";

export interface CandidateTrace {
  url: string;
  publication: string;
  outcome: "DISCOVERED" | "ACCEPTED" | "REJECTED" | "DUPLICATE";
  reason: string;
  statusCode: number | null;
  articleId: string | null;
}

export interface ReaderTrace {
  id: string;
  issueId: string;
  edition: number;
  createdAt: string;
  queries: string[];
  candidates: CandidateTrace[];
  decisions: string[];
  semantic?: ReaderSemanticRuntimeTrace;
}

const candidateTraceSchema = z.object({
  url: z.string().url().max(2048),
  publication: z.string().max(160),
  outcome: z.enum(["DISCOVERED", "ACCEPTED", "REJECTED", "DUPLICATE"]),
  reason: z.string().max(500),
  statusCode: z.number().int().nullable(),
  articleId: z.string().nullable(),
});
const readerTraceSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  edition: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }),
  queries: z.array(z.string().max(300)),
  candidates: z.array(candidateTraceSchema),
  decisions: z.array(z.string().max(500)),
  semantic: readerSemanticRuntimeTraceSchema.optional(),
});

const cachedBodyMetaSchema = z.object({
  articleId: z.string(),
  edition: z.number().int().min(1),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: z.string().datetime({ offset: true }),
});
export type CachedBodyMeta = z.infer<typeof cachedBodyMetaSchema>;

export interface ArticleBodyWrite {
  articleId: string;
  edition: number;
  bodyHash: string;
  paragraphs: string[];
}

export interface ReaderState {
  preferences: ReaderPreferences;
  preferencesConfigured: boolean;
  issues: DailyIssue[];
  occurrences: Occurrence[];
  attempts: RunAttempt[];
  /** Ownership of live collection attempts, so no process recovers another's work. */
  runLeases: RunLease[];
  progress: ReadingProgress[];
  traces: ReaderTrace[];
  cachedBodies: CachedBodyMeta[];
  lastLocalDateByTimezone: Record<string, string>;
}

/**
 * A claim on one live collection attempt.
 *
 * A process that starts, resumes or writes an attempt owns it for a bounded
 * window. Any other process must treat the attempt as live until the window
 * lapses, so starting the development server during a scheduled run cannot
 * mistake that run for an orphan and fail it.
 */
export interface RunLease {
  attemptId: string;
  ownerId: string;
  pid: number;
  hostname: string;
  expiresAt: string;
}

export interface RunLeaseRequest {
  attemptId: string;
  ownerId: string;
  pid: number;
  hostname: string;
  /** How long the claim stays valid without a heartbeat. */
  durationMs: number;
  now: string;
  /** Take the claim even if another process holds it. */
  force?: boolean;
}

const runLeaseSchema = z
  .object({
    attemptId: z.string().min(1).max(128),
    ownerId: z.string().min(1).max(200),
    pid: z.number().int().positive(),
    hostname: z.string().min(1).max(200),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const stateSchema = z
  .object({
    preferences: readerPreferencesSchema,
    preferencesConfigured: z.boolean(),
    issues: z.array(dailyIssueSchema),
    occurrences: z.array(occurrenceSchema),
    attempts: z.array(runAttemptSchema),
    runLeases: z.array(runLeaseSchema),
    progress: z.array(readingProgressSchema),
    traces: z.array(readerTraceSchema),
    cachedBodies: z.array(cachedBodyMetaSchema),
    lastLocalDateByTimezone: z.record(z.string(), z.string()),
  })
  .strict();
const envelopeSchema = z
  .object({
    schema_version: z.literal(1),
    updatedAt: z.string().datetime({ offset: true }),
    state: stateSchema,
  })
  .strict();

function defaultPreferences(): ReaderPreferences {
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return readerPreferencesSchema.parse({
    topics: ["Technology"],
    dailyArticleCount: 3,
    difficulty: "Intermediate",
    readingBudgetMinutes: 20,
    collectionTime: "08:00",
    timezone,
  });
}

function emptyState(): ReaderState {
  return {
    preferences: defaultPreferences(),
    preferencesConfigured: false,
    issues: [],
    occurrences: [],
    attempts: [],
    runLeases: [],
    progress: [],
    traces: [],
    cachedBodies: [],
    lastLocalDateByTimezone: {},
  };
}

export function defaultReaderDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) return path.join(localAppData, "SayIt", "Reader");
  }
  return path.join(homedir(), ".local", "share", "sayit", "reader");
}

export interface ReaderStoreOptions {
  directory?: string;
  now?: () => Date;
  /** How long a writer waits for another process's SQLite transaction. */
  busyTimeoutMs?: number;
}

/** Metadata keys inside the database. */
const LEGACY_IMPORT_KEY = "legacy_json_imported_at";
const LAST_LOCAL_DATE_KEY = "last_local_date_by_timezone";

/** The largest legacy JSON state file this store will adopt. */
const LEGACY_MAX_STATE_BYTES = 32 * 1024 * 1024;

/**
 * Persistence is one SQLite database in WAL mode.
 *
 * Every mutation runs inside `BEGIN IMMEDIATE`, which takes SQLite's write lock
 * before the read. Two processes — the development server and the scheduled
 * task — therefore cannot both read one version, compute independent mutations
 * and overwrite each other: the second blocks until the first commits and then
 * reads the committed result. A file rewritten wholesale could not offer that,
 * which is how a stale development-server copy once erased a completed
 * scheduled collection.
 *
 * A failure to read the committed state always throws; it never falls back to a
 * process's in-memory copy, because that copy is exactly what would silently
 * resurrect the lost data.
 */
export class ReaderStore {
  readonly directory: string;
  readonly databaseFile: string;
  private readonly legacyStateFile: string;
  private readonly cacheDirectory: string;
  private readonly now: () => Date;
  private readonly busyTimeoutMs: number;
  private database: DatabaseSync | null = null;
  private state = emptyState();
  private initialized = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ReaderStoreOptions = {}) {
    this.directory = options.directory ?? defaultReaderDirectory();
    this.databaseFile = path.join(this.directory, "reader-state.db");
    this.legacyStateFile = path.join(this.directory, "reader-state.json");
    this.cacheDirectory = path.join(this.directory, "cache");
    this.now = options.now ?? (() => new Date());
    this.busyTimeoutMs = options.busyTimeoutMs ?? 15_000;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directory, { recursive: true });
    await mkdir(this.cacheDirectory, { recursive: true });
    const created = !existsSync(this.databaseFile);
    let database: DatabaseSync;
    try {
      database = new DatabaseSync(this.databaseFile);
    } catch {
      throw new ReaderStoreError("reader_store_unavailable");
    }
    this.database = database;
    try {
      await this.prepareDatabase(database);
      this.createSchema();
      await this.importLegacyStateIfPresent(created);
      this.state = this.readCommittedState();
    } catch (error) {
      database.close();
      this.database = null;
      if (error instanceof ReaderStoreError) throw error;
      throw new ReaderStoreError("reader_store_unavailable");
    }
    this.initialized = true;
  }

  /**
   * Put the database into the durability mode this store relies on.
   *
   * Switching journal mode takes an exclusive lock, and SQLite does not apply
   * the busy handler to that particular pragma, so two processes opening a
   * brand-new state file at the same instant would otherwise fail instead of
   * taking turns. The switch is therefore retried within the same budget the
   * busy timeout expresses.
   */
  private async prepareDatabase(database: DatabaseSync): Promise<void> {
    database.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    const deadline = Date.now() + this.busyTimeoutMs;
    for (;;) {
      try {
        const applied = database.prepare("PRAGMA journal_mode = WAL").get() as
          | { journal_mode?: string }
          | undefined;
        const mode = applied ? Object.values(applied)[0] : undefined;
        // Already in WAL: another process switched it, so there is nothing to do.
        if (mode === undefined || String(mode).toLowerCase() === "wal") break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "ERR_SQLITE_ERROR" || Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) {
        throw new ReaderStoreError("reader_store_unavailable");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // WAL with synchronous=NORMAL is durable across process crashes, which is
    // the failure this store must survive, and keeps a commit from stalling on
    // an fsync while another process holds the lock.
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec("PRAGMA foreign_keys = ON");
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.initialized = false;
  }

  /**
   * Adopt whatever another process last committed.
   *
   * The development server is long-lived, so it must not keep serving the state
   * it happened to load at startup.
   */
  async reload(): Promise<void> {
    this.assertInitialized();
    const execute = async (): Promise<void> => {
      this.state = this.readCommittedState();
    };
    const current = this.queue.then(execute, execute);
    this.queue = current.catch(() => undefined);
    await current;
  }

  snapshot(): ReaderState {
    this.assertInitialized();
    return structuredClone(this.state);
  }

  /**
   * Apply one mutation atomically against the newest committed state.
   *
   * The transaction is opened before the state is read and held until the
   * result is committed, so concurrent writers serialize instead of clobbering.
   */
  async update<T>(
    mutator: (state: ReaderState) => T | Promise<T>,
    articleBodies:
      | readonly ArticleBodyWrite[]
      | ((state: ReaderState, result: T) => readonly ArticleBodyWrite[]) = [],
  ): Promise<T> {
    this.assertInitialized();
    const execute = async (): Promise<T> => {
      const database = this.requireDatabase();
      let transactionOpen = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        const committed = this.readCommittedState();
        const next = structuredClone(committed);
        const result = await mutator(next);
        const requestedBodies =
          typeof articleBodies === "function"
            ? articleBodies(next, result)
            : articleBodies;
        const bodyWrites = new Map<string, ArticleBodyWrite>();
        for (const body of requestedBodies) {
          const key = `${body.articleId}|${body.edition}`;
          if (bodyWrites.has(key)) throw new ReaderStoreError("duplicate_article_body");
          const article = next.issues
            .find((issue) =>
              issue.edition === body.edition &&
              issue.articles.some((item) => item.id === body.articleId),
            )
            ?.articles.find((item) => item.id === body.articleId);
          if (!article || !matchesArticleSummaryBody(article, body.paragraphs, body.bodyHash)) {
            throw new ReaderStoreError("article_body_invalid");
          }
          const verifiedAt = this.now().toISOString();
          next.cachedBodies = next.cachedBodies.filter(
            (item) => item.articleId !== body.articleId || item.edition !== body.edition,
          );
          next.cachedBodies.push({
            articleId: body.articleId,
            edition: body.edition,
            bodyHash: body.bodyHash,
            verifiedAt,
          });
          bodyWrites.set(key, { ...body, paragraphs: [...body.paragraphs] });
        }
        const parsed = stateSchema.safeParse(next);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 6)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(" | ");
          throw new ReaderStoreError("reader_state_invalid", new Error(issues));
        }
        // Rewriting every table on every write would hold the write lock for
        // work nobody asked for, so a progress save or a heartbeat would stall
        // the UI for as long as the whole state took to rewrite. The version this
        // transaction read says exactly which tables changed.
        this.writeState(parsed.data, committed);
        if (bodyWrites.size > 0) {
          const insertBody = database.prepare(
            `INSERT OR REPLACE INTO article_bodies
               (article_id, edition, body_hash, verified_at, paragraphs)
             VALUES (?, ?, ?, ?, ?)`,
          );
          for (const body of bodyWrites.values()) {
            const meta = parsed.data.cachedBodies.find(
              (item) => item.articleId === body.articleId && item.edition === body.edition,
            );
            if (!meta) throw new ReaderStoreError("article_body_invalid");
            insertBody.run(
              body.articleId,
              body.edition,
              body.bodyHash,
              meta.verifiedAt,
              JSON.stringify(body.paragraphs),
            );
          }
        }
        database.exec("COMMIT");
        transactionOpen = false;
        this.state = parsed.data;
        return result;
      } catch (error) {
        if (transactionOpen) {
          try {
            database.exec("ROLLBACK");
          } catch {
            // The transaction is already gone; the original error is what matters.
          }
        }
        if (error instanceof ReaderStoreError) throw error;
        throw new ReaderStoreError("reader_store_unavailable", error);
      }
    };
    const current = this.queue.then(execute, execute);
    this.queue = current.catch(() => undefined);
    return current;
  }

  /**
   * Take ownership of a live attempt, or report who already owns it.
   *
   * The check and the claim happen in one transaction, so two processes racing
   * for the same attempt cannot both win: exactly one claims it and the other is
   * told who holds it.
   */
  async claimRunLease(
    request: RunLeaseRequest,
  ): Promise<{ claimed: boolean; lease: RunLease | null }> {
    this.assertInitialized();
    return this.update((state) => {
      const existing = state.runLeases.find(
        (item) => item.attemptId === request.attemptId,
      );
      const stillValid = Boolean(
        existing && Date.parse(existing.expiresAt) > Date.parse(request.now),
      );
      // A valid claim held by anyone — including this same process — is not
      // re-claimed: two callers must never both believe they own the attempt.
      if (existing && stillValid && !request.force) {
        return { claimed: false, lease: existing };
      }
      const lease: RunLease = {
        attemptId: request.attemptId,
        ownerId: request.ownerId,
        pid: request.pid,
        hostname: request.hostname,
        expiresAt: new Date(
          Date.parse(request.now) + request.durationMs,
        ).toISOString(),
      };
      state.runLeases = state.runLeases.filter(
        (item) => item.attemptId !== request.attemptId,
      );
      state.runLeases.push(lease);
      return { claimed: true, lease };
    });
  }

  /** Extend a claim this process already holds. */
  async refreshRunLease(
    request: Omit<RunLeaseRequest, "force">,
  ): Promise<boolean> {
    this.assertInitialized();
    return this.update((state) => {
      const existing = state.runLeases.find(
        (item) => item.attemptId === request.attemptId,
      );
      if (!existing || existing.ownerId !== request.ownerId) return false;
      existing.expiresAt = new Date(
        Date.parse(request.now) + request.durationMs,
      ).toISOString();
      return true;
    });
  }

  async releaseRunLease(attemptId: string, ownerId: string): Promise<void> {
    this.assertInitialized();
    await this.update((state) => {
      state.runLeases = state.runLeases.filter(
        (item) => item.attemptId !== attemptId || item.ownerId !== ownerId,
      );
    });
  }

  /** Whether a live claim exists right now, and who holds it. */
  runLeaseHolder(attemptId: string, now: string): RunLease | null {
    this.assertInitialized();
    const lease = this.state.runLeases.find((item) => item.attemptId === attemptId);
    if (!lease) return null;
    return Date.parse(lease.expiresAt) > Date.parse(now) ? lease : null;
  }

  private createSchema(): void {
    this.requireDatabase().exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        configured INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT NOT NULL,
        edition INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (id, edition)
      );
      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_leases (
        attempt_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS progress (
        issue_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        edition INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (issue_id, article_id, edition)
      );
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS article_bodies (
        article_id TEXT NOT NULL,
        edition INTEGER NOT NULL,
        body_hash TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        paragraphs TEXT NOT NULL,
        PRIMARY KEY (article_id, edition)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Bring an existing JSON state file into the database exactly once.
   *
   * This is also how a deliberately reduced historical record — an older schema
   * without editorial metadata — reaches a fresh database, so the reader still
   * opens records written by an earlier version.
   */
  private async importLegacyStateIfPresent(
    databaseWasCreated: boolean,
  ): Promise<void> {
    const database = this.requireDatabase();
    const marker = database
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(LEGACY_IMPORT_KEY) as { value: string } | undefined;
    if (marker) return;
    let bytes: Buffer;
    try {
      bytes = await readFile(this.legacyStateFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (databaseWasCreated) {
          this.writeState(emptyState());
        }
        database
          .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
          .run(LEGACY_IMPORT_KEY, this.now().toISOString());
        return;
      }
      throw new ReaderStoreError("reader_store_unavailable");
    }

    // A malformed state file is preserved exactly as it is and never adopted.
    let adopted: ReaderState;
    try {
      if (bytes.byteLength > LEGACY_MAX_STATE_BYTES) throw new Error("too_large");
      adopted = envelopeSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown).state;
    } catch {
      throw new ReaderStoreError("reader_store_unavailable");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      this.writeState(adopted);
      database
        .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
        .run(LEGACY_IMPORT_KEY, this.now().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Nothing left to roll back.
      }
      throw error;
    }
    // Keep the imported file as the operator's record; the marker prevents a
    // second import, so a later edit to it is not silently adopted.
  }

  private readCommittedState(): ReaderState {
    try {
      return this.readCommittedStateUnchecked();
    } catch (error) {
      if (error instanceof ReaderStoreError) throw error;
      // A committed record that cannot be read is a hard failure: it is never
      // replaced by an in-memory copy, which is what would resurrect lost data.
      throw new ReaderStoreError("reader_store_unavailable");
    }
  }

  private readCommittedStateUnchecked(): ReaderState {
    const database = this.requireDatabase();
    const preferencesRow = database
      .prepare("SELECT configured, payload FROM preferences WHERE singleton = 1")
      .get() as { configured: number; payload: string } | undefined;
    const parse = <T>(payload: string): T => JSON.parse(payload) as T;
    const state: ReaderState = {
      preferences: preferencesRow
        ? parse<ReaderPreferences>(preferencesRow.payload)
        : defaultPreferences(),
      preferencesConfigured: preferencesRow ? preferencesRow.configured === 1 : false,
      issues: (
        database.prepare("SELECT payload FROM issues ORDER BY rowid").all() as {
          payload: string;
        }[]
      ).map((row) => parse<DailyIssue>(row.payload)),
      occurrences: (
        database.prepare("SELECT payload FROM occurrences ORDER BY rowid").all() as {
          payload: string;
        }[]
      ).map((row) => parse<Occurrence>(row.payload)),
      attempts: (
        database.prepare("SELECT payload FROM attempts ORDER BY rowid").all() as {
          payload: string;
        }[]
      ).map((row) => parse<RunAttempt>(row.payload)),
      runLeases: (
        database
          .prepare(
            `SELECT attempt_id, owner_id, owner_pid, hostname, expires_at
               FROM run_leases ORDER BY rowid`,
          )
          .all() as {
          attempt_id: string;
          owner_id: string;
          owner_pid: number;
          hostname: string;
          expires_at: string;
        }[]
      ).map((row) => ({
        attemptId: row.attempt_id,
        ownerId: row.owner_id,
        pid: row.owner_pid,
        hostname: row.hostname,
        expiresAt: row.expires_at,
      })),
      progress: (
        database.prepare("SELECT payload FROM progress ORDER BY rowid").all() as {
          payload: string;
        }[]
      ).map((row) => parse<ReadingProgress>(row.payload)),
      traces: (
        database.prepare("SELECT payload FROM traces ORDER BY rowid").all() as {
          payload: string;
        }[]
      ).map((row) => parse<ReaderTrace>(row.payload)),
      cachedBodies: (
        database
          .prepare(
            "SELECT article_id, edition, body_hash, verified_at FROM article_bodies ORDER BY rowid",
          )
          .all() as {
          article_id: string;
          edition: number;
          body_hash: string;
          verified_at: string;
        }[]
      ).map((row) => ({
        articleId: row.article_id,
        edition: row.edition,
        bodyHash: row.body_hash,
        verifiedAt: row.verified_at,
      })),
      lastLocalDateByTimezone: JSON.parse(
        (database
          .prepare("SELECT value FROM metadata WHERE key = ?")
          .get(LAST_LOCAL_DATE_KEY) as { value: string } | undefined)?.value ?? "{}",
      ) as Record<string, string>,
    };
    const parsed = stateSchema.safeParse(state);
    if (!parsed.success) throw new ReaderStoreError("reader_store_unavailable");
    return parsed.data;
  }

  /**
   * Persist the differences between the version this transaction read and the
   * version it produced, leaving untouched tables alone.
   */
  private writeState(state: ReaderState, committed?: ReaderState): void {
    const database = this.requireDatabase();
    const changed = (selector: (value: ReaderState) => unknown): boolean =>
      !committed || JSON.stringify(selector(committed)) !== JSON.stringify(selector(state));

    if (changed((value) => value.issues)) {
      database.prepare("DELETE FROM issues").run();
      const insertIssue = database.prepare(
        "INSERT INTO issues (id, edition, payload) VALUES (?, ?, ?)",
      );
      for (const issue of state.issues) {
        insertIssue.run(issue.id, issue.edition, JSON.stringify(issue));
      }
    }

    if (changed((value) => value.occurrences)) {
      database.prepare("DELETE FROM occurrences").run();
      const insertOccurrence = database.prepare(
        "INSERT INTO occurrences (id, payload) VALUES (?, ?)",
      );
      for (const occurrence of state.occurrences) {
        insertOccurrence.run(occurrence.id, JSON.stringify(occurrence));
      }
    }

    if (changed((value) => value.attempts)) {
      database.prepare("DELETE FROM attempts").run();
      const insertAttempt = database.prepare(
        "INSERT INTO attempts (id, payload) VALUES (?, ?)",
      );
      for (const attempt of state.attempts) {
        insertAttempt.run(attempt.id, JSON.stringify(attempt));
      }
    }

    if (changed((value) => value.runLeases)) {
      database.prepare("DELETE FROM run_leases").run();
      const insertLease = database.prepare(
        `INSERT INTO run_leases (attempt_id, owner_id, owner_pid, hostname, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const lease of state.runLeases) {
        // Only a run that is still live can hold a claim; a finished attempt's
        // claim is dropped so it cannot block the next collection.
        const attempt = state.attempts.find((item) => item.id === lease.attemptId);
        if (attempt && attempt.state !== "RUNNING") continue;
        insertLease.run(
          lease.attemptId,
          lease.ownerId,
          lease.pid,
          lease.hostname,
          lease.expiresAt,
        );
      }
    }

    if (changed((value) => value.progress)) {
      database.prepare("DELETE FROM progress").run();
      const insertProgress = database.prepare(
        "INSERT INTO progress (issue_id, article_id, edition, payload) VALUES (?, ?, ?, ?)",
      );
      for (const record of state.progress) {
        insertProgress.run(
          record.issueId,
          record.articleId,
          record.edition,
          JSON.stringify(record),
        );
      }
    }

    if (changed((value) => value.traces)) {
      database.prepare("DELETE FROM traces").run();
      const insertTrace = database.prepare(
        "INSERT INTO traces (id, payload) VALUES (?, ?)",
      );
      for (const trace of state.traces) {
        insertTrace.run(trace.id, JSON.stringify(trace));
      }
    }

    if (changed((value) => value.cachedBodies)) {
      const retiredBodies = database
        .prepare("SELECT article_id, edition FROM article_bodies")
        .all() as { article_id: string; edition: number }[];
      const keep = new Set(
        state.cachedBodies.map((item) => `${item.articleId}|${item.edition}`),
      );
      const removeBody = database.prepare(
        "DELETE FROM article_bodies WHERE article_id = ? AND edition = ?",
      );
      for (const row of retiredBodies) {
        if (!keep.has(`${row.article_id}|${row.edition}`)) {
          removeBody.run(row.article_id, row.edition);
        }
      }
    }

    if (
      changed(
        (value) =>
          [value.preferences, value.preferencesConfigured] as const,
      )
    ) {
      database
        .prepare(
          "INSERT OR REPLACE INTO preferences (singleton, configured, payload) VALUES (1, ?, ?)",
        )
        .run(
          state.preferencesConfigured ? 1 : 0,
          JSON.stringify(state.preferences),
        );
    }
    if (changed((value) => value.lastLocalDateByTimezone)) {
      database
        .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
        .run(LAST_LOCAL_DATE_KEY, JSON.stringify(state.lastLocalDateByTimezone));
    }
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new ReaderStoreError("reader_store_not_ready");
    return this.database;
  }

  async saveCache(
    articleId: string,
    edition: number,
    bodyHash: string,
    paragraphs: string[],
    verifiedMetrics?: Pick<
      ArticleSummary,
      | "wordCount"
      | "fkglWordCount"
      | "sentenceCount"
      | "syllableCount"
      | "readingMinutes"
      | "fkgl"
      | "difficulty"
      | "paragraphCount"
      | "accessiblePublication"
      | "accessibleUrl"
    >,
  ): Promise<void> {
    this.assertInitialized();
    await this.update(
      (state) => {
        if (!verifiedMetrics) return;
        const issue = state.issues.find((item) =>
          item.edition === edition && item.articles.some((candidate) => candidate.id === articleId),
        );
        const article = issue?.articles.find((item) => item.id === articleId);
        if (!article || article.contentStatus !== "FULL_TEXT") {
          throw new ReaderStoreError("article_body_invalid");
        }
        Object.assign(article, verifiedMetrics);
      },
      [{ articleId, edition, bodyHash, paragraphs }],
    );
  }

  async readCache(
    articleId: string,
    edition: number,
    expectedHash?: string,
  ): Promise<string[] | null> {
    this.assertInitialized();
    await this.reload();
    const article = this.state.issues
      .find((issue) =>
        issue.edition === edition && issue.articles.some((item) => item.id === articleId),
      )
      ?.articles.find((item) => item.id === articleId);
    if (!article || article.contentStatus !== "FULL_TEXT") return null;
    const meta = this.state.cachedBodies.find(
      (item) =>
        item.articleId === articleId &&
        item.edition === edition &&
          (expectedHash === undefined || item.bodyHash === expectedHash),
    );
    if (!meta) return null;
    const row = this.requireDatabase()
      .prepare(
        "SELECT body_hash, paragraphs FROM article_bodies WHERE article_id = ? AND edition = ?",
      )
      .get(articleId, edition) as
      | { body_hash: string; paragraphs: string }
      | undefined;
    if (
      !row ||
      row.body_hash !== meta.bodyHash ||
      (expectedHash !== undefined && row.body_hash !== expectedHash)
    ) return null;
    try {
      const decoded = JSON.parse(row.paragraphs) as unknown;
      return matchesArticleSummaryBody(article, decoded, row.body_hash)
        ? decoded
        : null;
    } catch {
      return null;
    }
  }

  async removeCache(articleId: string, edition: number): Promise<void> {
    this.assertInitialized();
    this.requireDatabase()
      .prepare("DELETE FROM article_bodies WHERE article_id = ? AND edition = ?")
      .run(articleId, edition);
    await this.update((state) => {
      state.cachedBodies = state.cachedBodies.filter(
        (item) => item.articleId !== articleId || item.edition !== edition,
      );
    });
  }

  findArticle(
    issueId: string,
    edition: number,
    articleId: string,
  ): ArticleSummary | null {
    this.assertInitialized();
    const issue = this.state.issues.find(
      (item) => item.id === issueId && item.edition === edition,
    );
    return issue?.articles.find((article) => article.id === articleId) ?? null;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new ReaderStoreError("reader_store_not_ready");
  }
}

export class ReaderStoreError extends Error {
  constructor(readonly code: string, readonly cause?: unknown) {
    // The cause carries the underlying failure, so it is surfaced here rather
    // than hidden behind a generic sentence when a collection needs diagnosing.
    const detail =
      cause instanceof Error
        ? `: ${cause.message}`
        : typeof cause === "string"
          ? `: ${cause}`
          : "";
    super(`Reader local storage could not complete this request (${code})${detail}`);
    this.name = "ReaderStoreError";
  }
}

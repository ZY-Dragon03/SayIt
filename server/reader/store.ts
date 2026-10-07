import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
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

export interface ReaderState {
  preferences: ReaderPreferences;
  preferencesConfigured: boolean;
  issues: DailyIssue[];
  occurrences: Occurrence[];
  attempts: RunAttempt[];
  progress: ReadingProgress[];
  traces: ReaderTrace[];
  cachedBodies: CachedBodyMeta[];
  lastLocalDateByTimezone: Record<string, string>;
}

const stateSchema = z
  .object({
    preferences: readerPreferencesSchema,
    preferencesConfigured: z.boolean(),
    issues: z.array(dailyIssueSchema),
    occurrences: z.array(occurrenceSchema),
    attempts: z.array(runAttemptSchema),
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
  maxStateBytes?: number;
}

export class ReaderStore {
  readonly directory: string;
  private readonly stateFile: string;
  private readonly cacheDirectory: string;
  private readonly now: () => Date;
  private readonly maxStateBytes: number;
  private state = emptyState();
  private initialized = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ReaderStoreOptions = {}) {
    this.directory = options.directory ?? defaultReaderDirectory();
    this.stateFile = path.join(this.directory, "reader-state.json");
    this.cacheDirectory = path.join(this.directory, "cache");
    this.now = options.now ?? (() => new Date());
    this.maxStateBytes = options.maxStateBytes ?? 32 * 1024 * 1024;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directory, { recursive: true });
    await mkdir(this.cacheDirectory, { recursive: true });
    try {
      const bytes = await readFile(this.stateFile);
      if (bytes.byteLength > this.maxStateBytes) {
        throw new Error("state_too_large");
      }
      const decoded = JSON.parse(bytes.toString("utf8")) as unknown;
      const parsed = envelopeSchema.safeParse(decoded);
      if (!parsed.success) throw new Error("state_invalid");
      this.state = parsed.data.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Preserve a malformed or unreadable state file; never overwrite it.
        throw new ReaderStoreError("reader_store_unavailable");
      }
      this.state = emptyState();
      await this.writeState(this.state);
    }
    this.initialized = true;
  }

  snapshot(): ReaderState {
    this.assertInitialized();
    return structuredClone(this.state);
  }

  async update<T>(mutator: (state: ReaderState) => T | Promise<T>): Promise<T> {
    this.assertInitialized();
    const execute = async (): Promise<T> => {
      const next = structuredClone(this.state);
      const result = await mutator(next);
      const parsed = stateSchema.safeParse(next);
      if (!parsed.success) throw new ReaderStoreError("reader_state_invalid");
      await this.writeState(parsed.data);
      this.state = parsed.data;
      return result;
    };
    const current = this.queue.then(execute, execute);
    this.queue = current.catch(() => undefined);
    return current;
  }

  async saveCache(
    articleId: string,
    edition: number,
    bodyHash: string,
    paragraphs: string[],
  ): Promise<void> {
    this.assertInitialized();
    const cacheAllowed = this.state.issues.some(
      (issue) =>
        issue.edition === edition &&
        issue.articles.some(
          (article) =>
            article.id === articleId &&
            article.contentStatus === "FULL_TEXT" &&
            article.cachePermission === "PERMITTED",
        ),
    );
    if (!cacheAllowed) throw new ReaderStoreError("cache_not_permitted");
    const payload = JSON.stringify({
      schema_version: 1,
      bodyHash,
      paragraphs,
    });
    await this.atomicWrite(this.cachePath(articleId, edition), payload);
    await this.update((state) => {
      state.cachedBodies = state.cachedBodies.filter(
        (item) => item.articleId !== articleId || item.edition !== edition,
      );
      state.cachedBodies.push({
        articleId,
        edition,
        bodyHash,
        verifiedAt: this.now().toISOString(),
      });
    });
  }

  async readCache(
    articleId: string,
    edition: number,
    expectedHash: string,
  ): Promise<string[] | null> {
    this.assertInitialized();
    const cacheStillAllowed = this.state.issues.some(
      (issue) =>
        issue.edition === edition &&
        issue.articles.some(
          (article) =>
            article.id === articleId &&
            article.contentStatus === "FULL_TEXT" &&
            article.cachePermission === "PERMITTED",
        ),
    );
    if (!cacheStillAllowed) return null;
    const meta = this.state.cachedBodies.find(
      (item) =>
        item.articleId === articleId &&
        item.edition === edition &&
        item.bodyHash === expectedHash,
    );
    if (!meta) return null;
    try {
      const decoded = JSON.parse(
        await readFile(this.cachePath(articleId, edition), "utf8"),
      ) as { schema_version?: unknown; bodyHash?: unknown; paragraphs?: unknown };
      if (
        decoded.schema_version !== 1 ||
        decoded.bodyHash !== expectedHash ||
        !Array.isArray(decoded.paragraphs) ||
        decoded.paragraphs.some((item) => typeof item !== "string")
      ) {
        return null;
      }
      return decoded.paragraphs as string[];
    } catch {
      return null;
    }
  }

  async removeCache(articleId: string, edition: number): Promise<void> {
    this.assertInitialized();
    await rm(this.cachePath(articleId, edition), { force: true });
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

  private cachePath(articleId: string, edition: number): string {
    const safeId = articleId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.cacheDirectory, `${safeId}-${edition}.json`);
  }

  private async writeState(state: ReaderState): Promise<void> {
    const payload = JSON.stringify({
      schema_version: 1,
      updatedAt: this.now().toISOString(),
      state,
    });
    if (Buffer.byteLength(payload, "utf8") > this.maxStateBytes) {
      throw new ReaderStoreError("reader_state_too_large");
    }
    await this.atomicWrite(this.stateFile, payload);
  }

  private async atomicWrite(target: string, payload: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, payload, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new ReaderStoreError("reader_store_unavailable");
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new ReaderStoreError("reader_store_not_ready");
  }
}

export class ReaderStoreError extends Error {
  constructor(readonly code: string) {
    super("Reader local storage could not complete this request.");
    this.name = "ReaderStoreError";
  }
}

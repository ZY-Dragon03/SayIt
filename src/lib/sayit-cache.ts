import { z } from "zod";
import { sayItResultSchema, type SayItResult } from "../shared/contract";
import {
  isSingleWordSelection,
  normalizeCacheText,
} from "./selection-normalize";

/**
 * Shared persistent SayIt result cache.
 *
 * History answers "what did I ask/use?". This cache answers "do we already
 * have a valid model answer for this request?" — so a repeated successful
 * SayIt query can be shown immediately without spending another LLM call.
 *
 * Both normal SayIt and Reader read and write this one cache.
 */

export const SAYIT_CACHE_STORAGE_KEY = "sayit.result-cache.v1";

/** Bump to invalidate older entries after prompt/model/result changes. */
export const SAYIT_CACHE_SCHEMA_VERSION = 1 as const;

const MAX_CACHE_ENTRIES = 120;
const MAX_CACHE_KEY_LENGTH = 640;

export type SayItCacheSource = "sayit" | "reader";

export interface SayItCacheIdentityInput {
  /** The expression the user actually selected or typed. */
  selection: string;
  source: SayItCacheSource;
  /**
   * The effective context the interpretation depends on. Empty for a
   * context-free request.
   */
  context?: string;
}

const cacheEntrySchema = z
  .object({
    key: z.string().min(1).max(MAX_CACHE_KEY_LENGTH),
    created_at: z.string().datetime(),
    result: sayItResultSchema,
  })
  .strict();

const cacheEnvelopeSchema = z
  .object({
    version: z.literal(SAYIT_CACHE_SCHEMA_VERSION),
    entries: z.array(cacheEntrySchema).max(MAX_CACHE_ENTRIES),
  })
  .strict();

export type SayItCacheEntry = z.infer<typeof cacheEntrySchema>;

/**
 * Cache identity policy:
 * - a single lexical word is context-free and shared across SayIt and Reader,
 *   so `Psychologically`, ` psychologically `, and `PSYCHOLOGICALLY` collide;
 * - a Reader phrase or sentence keeps a normalized context fingerprint so a
 *   context-specific interpretation is never reused in an unrelated context;
 * - an ordinary multi-word SayIt request is keyed on its normalized input.
 */
export function buildSayItCacheIdentity(input: SayItCacheIdentityInput): string {
  const normalizedSelection = normalizeCacheText(input.selection);
  const wordCount = normalizedSelection.split(" ").filter(Boolean).length;

  if (isSingleWordSelection(input.selection) || wordCount === 1) {
    return `word:${normalizedSelection}`;
  }
  if (input.source === "reader") {
    const context = normalizeCacheText(input.context ?? "");
    const bucket = context ? `reader:${wordCount}:${context}` : `reader:${wordCount}`;
    return bucket.length > MAX_CACHE_KEY_LENGTH
      ? `${bucket.slice(0, MAX_CACHE_KEY_LENGTH - 9)}~${fingerprint(bucket)}`
      : bucket;
  }
  return `sayit:${normalizedSelection}`;
}

/** Stable short hash used only to keep over-long identity strings bounded. */
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function isCacheableSayItResult(result: SayItResult): boolean {
  return result.status === "success";
}

function emptyEnvelope(): z.infer<typeof cacheEnvelopeSchema> {
  return { version: SAYIT_CACHE_SCHEMA_VERSION, entries: [] };
}

export class LocalSayItCacheRepository {
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.storage =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  }

  get(identity: string): SayItResult | null {
    const entry = this.readEnvelope().entries.find(
      (candidate) => candidate.key === identity,
    );
    return entry && isCacheableSayItResult(entry.result) ? entry.result : null;
  }

  has(identity: string): boolean {
    return this.get(identity) !== null;
  }

  /** Store only validated successful results. Returns the stored result. */
  put(identity: string, result: SayItResult): SayItResult | null {
    const parsed = sayItResultSchema.safeParse(result);
    if (!parsed.success || !isCacheableSayItResult(parsed.data)) {
      return null;
    }
    const entry = cacheEntrySchema.safeParse({
      key: identity,
      created_at: new Date().toISOString(),
      result: parsed.data,
    });
    if (!entry.success) {
      return null;
    }

    const envelope = this.readEnvelope();
    const rest = envelope.entries.filter(
      (candidate) => candidate.key !== entry.data.key,
    );
    this.writeEnvelope({
      version: SAYIT_CACHE_SCHEMA_VERSION,
      entries: [entry.data, ...rest].slice(0, MAX_CACHE_ENTRIES),
    });
    return entry.data.result;
  }

  list(): SayItCacheEntry[] {
    return this.readEnvelope().entries;
  }

  clear(): void {
    try {
      this.storage?.removeItem(SAYIT_CACHE_STORAGE_KEY);
    } catch {
      // Clearing is optional; the current session still works.
    }
  }

  private readEnvelope(): z.infer<typeof cacheEnvelopeSchema> {
    if (!this.storage) return emptyEnvelope();

    let raw: string | null;
    try {
      raw = this.storage.getItem(SAYIT_CACHE_STORAGE_KEY);
    } catch {
      return emptyEnvelope();
    }
    if (!raw) return emptyEnvelope();

    try {
      const parsed = cacheEnvelopeSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : emptyEnvelope();
    } catch {
      return emptyEnvelope();
    }
  }

  private writeEnvelope(envelope: z.infer<typeof cacheEnvelopeSchema>): void {
    try {
      this.storage?.setItem(SAYIT_CACHE_STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // A full or unavailable cache never blocks a fresh SayIt request.
    }
  }
}

import { z } from "zod";
import {
  isSuccessfulResult,
  retrievalResultSchema,
  type RetrievalResult,
} from "../shared/contract";

const STORAGE_KEY = "sayit.saved.v1";

const savedExpressionSchema = z
  .object({
    id: z.string().min(1),
    created_at: z.string().datetime(),
    input: z.string().trim().min(1).max(500),
    result: retrievalResultSchema,
  })
  .strict();

const storageEnvelopeSchema = z
  .object({
    version: z.literal(1),
    items: z.array(savedExpressionSchema).max(500),
  })
  .strict();

export type SavedExpression = z.infer<typeof savedExpressionSchema>;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export interface MemoryRepository {
  list(): SavedExpression[];
  save(input: string, result: RetrievalResult): SavedExpression;
  remove(id: string): void;
  clear(): void;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class LocalMemoryRepository implements MemoryRepository {
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.storage =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  }

  list(): SavedExpression[] {
    const envelope = this.readEnvelope();
    return [...envelope.items].sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at),
    );
  }

  save(input: string, result: RetrievalResult): SavedExpression {
    if (!this.storage) {
      throw new StorageError("Local storage is unavailable.");
    }
    if (!isSuccessfulResult(result)) {
      throw new StorageError("Only successful results can be saved.");
    }

    const item: SavedExpression = {
      id: createId(),
      created_at: new Date().toISOString(),
      input,
      result,
    };
    const envelope = this.readEnvelope();
    this.writeEnvelope({ version: 1, items: [item, ...envelope.items] });
    return item;
  }

  remove(id: string): void {
    if (!this.storage) {
      throw new StorageError("Local storage is unavailable.");
    }
    const envelope = this.readEnvelope();
    this.writeEnvelope({
      version: 1,
      items: envelope.items.filter((item) => item.id !== id),
    });
  }

  clear(): void {
    if (!this.storage) {
      throw new StorageError("Local storage is unavailable.");
    }
    try {
      this.storage.removeItem(STORAGE_KEY);
    } catch {
      throw new StorageError("Could not clear local saved expressions.");
    }
  }

  private readEnvelope(): z.infer<typeof storageEnvelopeSchema> {
    if (!this.storage) {
      return { version: 1, items: [] };
    }

    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return { version: 1, items: [] };
    }
    if (!raw) {
      return { version: 1, items: [] };
    }

    try {
      const parsed = storageEnvelopeSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : { version: 1, items: [] };
    } catch {
      return { version: 1, items: [] };
    }
  }

  private writeEnvelope(
    envelope: z.infer<typeof storageEnvelopeSchema>,
  ): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      throw new StorageError("Could not save this expression locally.");
    }
  }
}

export const savedExpressionStorageKey = STORAGE_KEY;

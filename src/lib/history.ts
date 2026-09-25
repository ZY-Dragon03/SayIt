import { z } from "zod";
import {
  MAX_CONTEXT_SUMMARY_LENGTH,
  resultModeSchema,
  sayItResultSchema,
  sessionContextTurnSchema,
  type SayItResult,
  type SessionContextTurn,
} from "../shared/contract";
import { StorageError } from "./storage";

const STORAGE_KEY = "sayit.history.v1";
export const HISTORY_LIMIT = 200;

const historyRecordSchema = z
  .object({
    id: z.string().min(1),
    created_at: z.string().datetime(),
    input: z.string().trim().min(1).max(500),
    result: sayItResultSchema,
    mode: resultModeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.result.status !== "success") {
      context.addIssue({
        code: "custom",
        path: ["result", "status"],
        message: "Only successful results can be stored in history.",
      });
    }
    if (record.result.mode !== record.mode) {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "History mode must match the stored result mode.",
      });
    }
  });

const storageEnvelopeSchema = z
  .object({
    version: z.literal(1),
    items: z.array(historyRecordSchema).max(HISTORY_LIMIT),
  })
  .strict();

export type HistoryRecord = z.infer<typeof historyRecordSchema>;
export type HistoryRestore = {
  record: HistoryRecord;
  context: SessionContextTurn[];
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeFingerprintPart(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeKey(input: string, result: SayItResult): string {
  const normalizedInput = normalizeFingerprintPart(input);
  const resultFingerprint =
    result.mode === "retrieve"
      ? [
          result.best_match?.text ?? "",
          result.natural_sentence ?? "",
        ].map(normalizeFingerprintPart).join("|")
      : [
          result.interpretation?.expression ?? "",
          result.interpretation?.meaning_in_context.slice(0, 120) ?? "",
        ].map(normalizeFingerprintPart).join("|");
  return `${normalizedInput}|${result.mode}|${resultFingerprint}`;
}

function emptyEnvelope(): z.infer<typeof storageEnvelopeSchema> {
  return { version: 1, items: [] };
}

export class LocalHistoryRepository {
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.storage =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  }

  list(): HistoryRecord[] {
    return [...this.readEnvelope().items].sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at),
    );
  }

  append(input: string, result: SayItResult): HistoryRecord | null {
    if (!this.storage) {
      throw new StorageError("Local storage is unavailable.");
    }

    const parsedResult = sayItResultSchema.safeParse(result);
    if (!parsedResult.success || parsedResult.data.status !== "success") {
      return null;
    }

    const envelope = this.readEnvelope();
    const trimmedInput = input.trim();
    const previous = envelope.items[0];
    if (
      previous &&
      dedupeKey(previous.input, previous.result) ===
        dedupeKey(trimmedInput, parsedResult.data)
    ) {
      return null;
    }

    const parsedRecord = historyRecordSchema.safeParse({
      id: createId(),
      created_at: new Date().toISOString(),
      input: trimmedInput,
      result: parsedResult.data,
      mode: parsedResult.data.mode,
    });
    if (!parsedRecord.success) {
      return null;
    }

    this.writeEnvelope({
      version: 1,
      items: [parsedRecord.data, ...envelope.items].slice(0, HISTORY_LIMIT),
    });
    return parsedRecord.data;
  }

  restore(
    id: string,
    summarizeResult: (result: SayItResult) => string,
  ): HistoryRestore | null {
    const record = this.list().find((item) => item.id === id);
    if (!record) return null;

    const turn = sessionContextTurnSchema.parse({
      input: record.input,
      mode: record.mode,
      assistant_summary: summarizeResult(record.result).slice(
        0,
        MAX_CONTEXT_SUMMARY_LENGTH,
      ),
    });
    return { record, context: [turn] };
  }

  private readEnvelope(): z.infer<typeof storageEnvelopeSchema> {
    if (!this.storage) return emptyEnvelope();

    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return emptyEnvelope();
    }
    if (!raw) return emptyEnvelope();

    try {
      const parsed = storageEnvelopeSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : emptyEnvelope();
    } catch {
      return emptyEnvelope();
    }
  }

  private writeEnvelope(
    envelope: z.infer<typeof storageEnvelopeSchema>,
  ): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      throw new StorageError("Could not save local history.");
    }
  }
}

export const localHistoryStorageKey = STORAGE_KEY;

import { z } from "zod";
import {
  normalizeLexicalSurface,
  resolveLemma as resolveLemmaWithLookup,
} from "./lemma-core.mjs";

const LEXICON_URL = "/data/sayit-lexicon.v1.json";
const MAX_CACHED_LEMMAS = 256;
const MAX_DEFINITION_LENGTH = 120;

const lexiconEntrySchema = z
  .object({
    primary: z.string().trim().min(1),
    secondary: z.string().trim().min(1).optional(),
  })
  .strict();

const lexiconSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), lexiconEntrySchema),
  })
  .strict();

export interface DictionaryDefinition {
  primary: string;
  secondary?: string;
}

type LexiconEntries = z.infer<typeof lexiconSchema>["entries"];

const LEXICOGRAPHER_LABELS = new Set([
  "anatomy",
  "biology",
  "botany",
  "chemistry",
  "computing",
  "grammar",
  "linguistics",
  "law",
  "mathematics",
  "medicine",
  "music",
  "physics",
  "physiology",
  "slang",
  "zoology",
]);

let dictionaryEntries: LexiconEntries | null = null;
let dictionaryPromise: Promise<LexiconEntries> | null = null;
const definitionCache = new Map<string, DictionaryDefinition | null>();

export function trimDictionaryGloss(gloss: string): string | null {
  let text = gloss.trim();
  const metadataPrefix = /^\(([^)]+)\)\s*/.exec(text);
  if (
    metadataPrefix &&
    LEXICOGRAPHER_LABELS.has(metadataPrefix[1].trim().toLowerCase())
  ) {
    text = text.slice(metadataPrefix[0].length);
  }

  text = text.split(";")[0].trim();
  if (!text) return null;
  if (text.length > MAX_DEFINITION_LENGTH) {
    const boundary = text.lastIndexOf(" ", MAX_DEFINITION_LENGTH);
    const cutAt = boundary > 80 ? boundary : MAX_DEFINITION_LENGTH;
    text = `${text.slice(0, cutAt).trimEnd()}…`;
  }
  return text;
}

export function isDictionaryLoaded(): boolean {
  return dictionaryEntries !== null;
}

export function prefetchDictionary(): Promise<LexiconEntries> {
  if (dictionaryEntries) return Promise.resolve(dictionaryEntries);
  if (dictionaryPromise) return dictionaryPromise;

  dictionaryPromise = fetch(LEXICON_URL, {
    method: "GET",
    credentials: "same-origin",
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Local dictionary could not load (${response.status}).`);
      }
      const parsed = lexiconSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("Local dictionary data is invalid.");
      }
      dictionaryEntries = parsed.data.entries;
      definitionCache.clear();
      return dictionaryEntries;
    })
    .catch((error: unknown) => {
      dictionaryPromise = null;
      throw error;
    });

  return dictionaryPromise;
}

export function resolveLemma(surface: string): string | null {
  const entries = dictionaryEntries;
  if (!entries) return null;
  return resolveLemmaWithLookup(surface, (lemma) =>
    Object.hasOwn(entries, lemma),
  );
}

export function getDefinition(
  resolvedLemma: string,
): DictionaryDefinition | null {
  const entries = dictionaryEntries;
  if (!entries) return null;
  const lemma = normalizeLexicalSurface(resolvedLemma);
  if (!lemma) return null;

  if (definitionCache.has(lemma)) {
    const cached = definitionCache.get(lemma) ?? null;
    definitionCache.delete(lemma);
    definitionCache.set(lemma, cached);
    return cached;
  }

  const raw = Object.hasOwn(entries, lemma)
    ? entries[lemma]
    : undefined;
  const primary = raw ? trimDictionaryGloss(raw.primary) : null;
  const secondary = raw?.secondary
    ? trimDictionaryGloss(raw.secondary)
    : null;
  const definition = primary
    ? {
        primary,
        ...(secondary && secondary !== primary ? { secondary } : {}),
      }
    : null;

  definitionCache.set(lemma, definition);
  if (definitionCache.size > MAX_CACHED_LEMMAS) {
    const oldest = definitionCache.keys().next().value;
    if (oldest) definitionCache.delete(oldest);
  }
  return definition;
}

export function getDefinitionForSurface(
  surface: string,
): DictionaryDefinition | null {
  const lemma = resolveLemma(surface);
  return lemma ? getDefinition(lemma) : null;
}

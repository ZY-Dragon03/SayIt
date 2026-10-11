import type { PronunciationAccent } from "./pronunciation";

// Bumped from `sayit.ipa.v1` together with the engine swap recorded in
// `openspec/changes/replace-llm-ipa-with-local-lookup/design.md`: the GPL-3.0
// derived eSpeak NG build was replaced by the MIT `phonemize` engine, and v1
// entries were produced by the old engine.
export const IPA_CACHE_STORAGE_KEY = "sayit.ipa.v2";

const MAX_CACHE_ENTRIES = 128;
const MAX_IPA_LENGTH = 160;

const ENGINE_LANGUAGES: Record<PronunciationAccent, string> = {
  us: "en-US",
  uk: "en-GB",
};

const IPA_SIGNAL_PATTERN =
  /[A-Za-zɑɐɒɔəɛɜɝɞɪʊʌɹʃʒθðŋɾɲɳʔˈˌːˑæœɶɨʉɵɫ]/u;

// A transcription may not carry the punctuation or the typographic quotes of the
// source text. `phonemize` echoes characters it has no pronunciation for, and the
// engine may pass a word straight back for an input it does not know, so anything
// that is not a phoneme hides the IPA line instead of being rendered as one.
const IPA_UNSUPPORTED_PATTERN =
  /[\u0000-\u001f{}<>`\\[\]/!?,.;:()"\u2013\u2014\u2018\u2019\u201C\u201D]/u;

interface PhonemizerModule {
  phonemize(
    text: string,
    language?: string,
  ): string | string[] | Promise<string | string[]>;
}

type EngineLoader = () => Promise<PhonemizerModule>;

interface PronunciationLookupOptions {
  storage?: Storage | null;
  loadEngine?: EngineLoader;
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// SayIt bundles no phonemization engine of its own: the free English
// grapheme-to-phoneme engines are GPL/AGPL derived (eSpeak NG and the
// `phonemizer` package that wraps it, `ephone`,
// `@jocelyn-stericker/espeak-phonemes`), and a GPL-derived engine cannot be
// shipped inside this MIT project. `phonemize` is MIT with MIT-only transitive
// dependencies, and is the permissively licensed replacement that
// `openspec/changes/replace-llm-ipa-with-local-lookup/design.md` named as the
// alternative to the engine it originally selected. See THIRD-PARTY-NOTICES.md.
async function loadPhonemize(): Promise<PhonemizerModule> {
  return import("phonemize");
}

export function normalizeIPAInput(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// What the engine is actually asked to transcribe: letters, digits, spaces and
// apostrophes. Accents are folded (`café` -> `cafe`), typographic apostrophes are
// normalised so contractions survive, and every other mark becomes a word break.
// This keeps source punctuation out of the transcription while still producing a
// pronunciation for loanwords and punctuated sentences.
export function toEngineInput(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/gu, "'")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getIPACacheKey(
  text: string,
  accent: PronunciationAccent,
): string {
  return `${accent}:${normalizeIPAInput(text).toLocaleLowerCase("en-US")}`;
}

export function isClearlyNonLanguageInput(text: string): boolean {
  const normalized = normalizeIPAInput(text);
  if (!normalized || !/[A-Za-z]/u.test(normalized)) {
    return true;
  }

  if (
    /^(?:https?:\/\/|www\.)/iu.test(normalized) ||
    /[{}<>`\\]/u.test(normalized) ||
    normalized.includes("[") ||
    normalized.includes("]") ||
    /=>|(?:^|;)\s*(?:\/\/|$)/u.test(normalized)
  ) {
    return true;
  }

  const letters = (normalized.match(/[A-Za-z]/gu) ?? []).length;
  const nonWhitespaceLength = normalized.replace(/\s/gu, "").length;
  return letters / Math.max(nonWhitespaceLength, 1) < 0.45;
}

function formatIPA(value: string): string | null {
  const trimmed = value.trim().replace(/^\/|\/$/g, "");
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_IPA_LENGTH ||
    !IPA_SIGNAL_PATTERN.test(trimmed) ||
    IPA_UNSUPPORTED_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return `/${trimmed}/`;
}

function isStoredIPA(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IPA_LENGTH + 2 &&
    value.startsWith("/") &&
    value.endsWith("/") &&
    formatIPA(value) !== null
  );
}

function loadStoredCache(
  storage: Storage | null,
  cache: Map<string, string>,
): void {
  if (!storage) {
    return;
  }

  try {
    const raw = storage.getItem(IPA_CACHE_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!entries || typeof entries !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(entries)) {
      if (/^(?:us|uk):/u.test(key) && isStoredIPA(value)) {
        cache.set(key, value);
      }
    }
  } catch {
    // A damaged or unavailable cache never blocks IPA lookup.
  }
}

function persistCache(
  storage: Storage | null,
  cache: Map<string, string>,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      IPA_CACHE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: Object.fromEntries(cache),
      }),
    );
  } catch {
    // Persistence is optional; the in-memory cache remains usable.
  }
}

function remember(
  key: string,
  value: string,
  storage: Storage | null,
  cache: Map<string, string>,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
  persistCache(storage, cache);
}

export function createPronunciationLookup(
  options: PronunciationLookupOptions = {},
): { getIPA: (text: string, accent: PronunciationAccent) => Promise<string | null> } {
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage;
  const loadEngine = options.loadEngine ?? loadPhonemize;
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<string | null>>();
  let cacheLoaded = false;
  let enginePromise: Promise<PhonemizerModule> | null = null;

  const ensureCacheLoaded = () => {
    if (!cacheLoaded) {
      cacheLoaded = true;
      loadStoredCache(storage, cache);
    }
  };

  const getIPA = async (
    text: string,
    accent: PronunciationAccent,
  ): Promise<string | null> => {
    const normalized = normalizeIPAInput(text);
    if (isClearlyNonLanguageInput(normalized)) {
      return null;
    }

    ensureCacheLoaded();
    const key = getIPACacheKey(normalized, accent);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }

    const engineInput = toEngineInput(normalized);
    if (engineInput.length === 0) {
      return null;
    }

    const request = (async () => {
      try {
        enginePromise ??= loadEngine();
        const engine = await enginePromise;
        const output = await engine.phonemize(
          engineInput,
          ENGINE_LANGUAGES[accent],
        );
        const candidate = (Array.isArray(output) ? output : [output]).find(
          (value) => typeof value === "string" && value.trim().length > 0,
        );
        // An engine with no processor for the requested language echoes the word
        // back unchanged; that is not a transcription, so it is hidden.
        const echoed =
          typeof candidate === "string" &&
          candidate.trim().toLocaleLowerCase("en-US") ===
            engineInput.toLocaleLowerCase("en-US");
        const ipa = candidate && !echoed ? formatIPA(candidate) : null;
        if (ipa) {
          remember(key, ipa, storage, cache);
        }
        return ipa;
      } catch {
        return null;
      }
    })();

    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  };

  return { getIPA };
}

const defaultLookup = createPronunciationLookup();

export function getIPA(
  text: string,
  accent: PronunciationAccent,
): Promise<string | null> {
  return defaultLookup.getIPA(text, accent);
}

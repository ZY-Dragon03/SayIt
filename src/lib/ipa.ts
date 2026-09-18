import type { PronunciationAccent } from "./pronunciation";

export const IPA_CACHE_STORAGE_KEY = "sayit.ipa.v1";

const MAX_CACHE_ENTRIES = 128;
const MAX_IPA_LENGTH = 160;

const ENGINE_LANGUAGES: Record<PronunciationAccent, string> = {
  us: "en-us",
  // phonemizer's Great Britain voice is selected by the `en` identifier.
  uk: "en",
};

const IPA_SIGNAL_PATTERN =
  /[A-Za-zɑɐɒɔəɛɜɝɞɪʊʌɹʃʒθðŋɾɲɳʔˈˌːˑæœɶɨʉɵ]/u;

interface PhonemizerModule {
  phonemize(text: string, language?: string): Promise<string[]>;
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

async function loadPhonemizer(): Promise<PhonemizerModule> {
  return import("phonemizer");
}

export function normalizeIPAInput(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
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
    /[\u0000-\u001f{}<>`\\]/u.test(trimmed) ||
    trimmed.includes("[") ||
    trimmed.includes("]")
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
  const loadEngine = options.loadEngine ?? loadPhonemizer;
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

    const request = (async () => {
      try {
        enginePromise ??= loadEngine();
        const engine = await enginePromise;
        const outputs = await engine.phonemize(
          normalized,
          ENGINE_LANGUAGES[accent],
        );
        const output = outputs.find((candidate) => candidate.trim().length > 0);
        const ipa = output ? formatIPA(output) : null;
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

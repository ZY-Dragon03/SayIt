import type { SayItResult, SessionContextTurn } from "../shared/contract";
import {
  buildSayItCacheIdentity,
  isCacheableSayItResult,
  type LocalSayItCacheRepository,
  type SayItCacheSource,
} from "./sayit-cache";
import { requestRetrieval } from "./sayit-request";

export interface ResolveSayItRequestOptions {
  /** The expression the user typed or selected — this drives the cache identity. */
  selection: string;
  source: SayItCacheSource;
  /** Effective context the interpretation depends on. */
  contextText?: string;
  /**
   * The prompt actually sent to the provider. Reader sends an
   * interpretation prompt containing the article sentence; it defaults to the
   * raw selection for ordinary SayIt requests.
   */
  requestInput?: string;
  context?: SessionContextTurn[];
  cache: LocalSayItCacheRepository;
  /** Transport override; defaults to the shared /api/retrieve call. */
  retrieve?: (
    input: string,
    context: SessionContextTurn[],
  ) => Promise<SayItResult>;
}

export interface ResolvedSayItRequest {
  result: SayItResult;
  cacheIdentity: string;
  /** True when the result came from local storage and no API call was made. */
  cacheHit: boolean;
}

/**
 * Resolve one explicit SayIt action through the shared cache.
 *
 * A local hit returns synchronously without touching the network; a miss calls
 * the provider once and stores the validated successful result. Only successes
 * are cached, so clarification and no-match answers are always re-asked.
 */
export async function resolveSayItRequest(
  options: ResolveSayItRequestOptions,
): Promise<ResolvedSayItRequest> {
  const cacheIdentity = buildSayItCacheIdentity({
    selection: options.selection,
    source: options.source,
    context: options.contextText,
  });

  const cached = options.cache.get(cacheIdentity);
  if (cached) {
    return { result: cached, cacheIdentity, cacheHit: true };
  }

  const retrieve =
    options.retrieve ??
    ((input: string, context: SessionContextTurn[]) =>
      requestRetrieval({ input, context }));
  const result = await retrieve(
    options.requestInput ?? options.selection,
    options.context ?? [],
  );
  if (isCacheableSayItResult(result)) {
    options.cache.put(cacheIdentity, result);
  }
  return { result, cacheIdentity, cacheHit: false };
}

/** Peek at the shared cache without performing any request. */
export function peekSayItCache(
  cache: LocalSayItCacheRepository,
  options: Omit<ResolveSayItRequestOptions, "cache" | "retrieve">,
): SayItResult | null {
  return cache.get(
    buildSayItCacheIdentity({
      selection: options.selection,
      source: options.source,
      context: options.contextText,
    }),
  );
}

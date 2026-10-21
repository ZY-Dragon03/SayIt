import { createHash } from "node:crypto";
import http from "node:http";
import tls from "node:tls";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { JsonCompletionClient } from "../provider";
import {
  MAX_SEMANTIC_ARTICLE_EVIDENCE_CHARS,
  MAX_SEMANTIC_EXISTING_ARTICLES,
  reviewSemanticCandidates,
  SemanticReviewError,
  type SemanticEditorialRecord,
  type SemanticExistingArticleInput,
  type SemanticRuntimeTrace,
} from "./semantic";

export type ReaderDifficulty = "Easy" | "Intermediate" | "Advanced";
export type CandidateContentStatus = "FULL_TEXT" | "EXTERNAL_ONLY" | "SUMMARY" | "UNAVAILABLE";
export type CandidateOutcome = "DISCOVERED" | "ACCEPTED" | "REJECTED" | "DUPLICATE";
export type CachePermission = "PERMITTED" | "NOT_PERMITTED" | "UNKNOWN";

/** Structural input contract; the service passes only saved preferences here. */
export interface EditorialPreferences {
  topics: string[];
  dailyArticleCount: number;
  difficulty: ReaderDifficulty;
  readingBudgetMinutes: number;
}

export interface SearchCandidate {
  url: string;
  title: string;
  snippet: string;
  publication?: string;
}

/** Adapter implemented by the Reader service with safeFetchArticle. */
export interface FetchedArticlePage {
  statusCode: number;
  headers: { [name: string]: string | string[] | undefined };
  body: Buffer;
  finalUrl: string;
}

export interface EditorialArticle {
  id: string;
  title: string;
  originalPublication: string;
  originalUrl: string;
  accessiblePublication: string;
  accessibleUrl: string;
  contentStatus: CandidateContentStatus;
  wordCount: number;
  fkglWordCount: number;
  sentenceCount: number;
  syllableCount: number;
  readingMinutes: number;
  fkgl: number | null;
  readState: "UNREAD";
  cachePermission: CachePermission;
  topics: string[];
  difficulty: ReaderDifficulty | null;
  paragraphCount: number;
  paragraphs?: string[];
  bodyHash?: string;
  /**
   * When the publisher says the article was published, when its page states it.
   * Used to refuse placing a newer article into an earlier day's issue.
   */
  publishedAt?: string | null;
  provenance?: {
    publisherIdentity: string;
    publisherIdentitySources: Array<
      | "structured_publisher"
      | "citation_publication_title"
      | "article_publisher"
      | "open_graph_site_name"
    >;
    canonicalRelationship:
      | "original_url"
      | "accessible_url"
      | "publisher_canonical";
    standaloneArticleVerified: true;
    titleAgreementVerified: true;
    bodyCompletenessVerified: true;
  };
  editorial?: SemanticEditorialRecord;
}

export interface EditorialCandidateTrace {
  url: string;
  publication: string;
  outcome: CandidateOutcome;
  reason: string;
  statusCode: number | null;
  articleId: string | null;
}

export interface EditorialTrace {
  queries: string[];
  candidates: EditorialCandidateTrace[];
  decisions: string[];
  semantic?: SemanticRuntimeTrace;
}

export interface EditorialCollection {
  status: "COMPLETE" | "PARTIAL" | "NOT_DELIVERED";
  articles: EditorialArticle[];
  /** Non-full-text cards are useful for an honest shortage view, but never count as delivered. */
  candidates: EditorialArticle[];
  actual: {
    count: number;
    topics: string[];
    difficulty: ReaderDifficulty | null;
    readingMinutes: number;
  };
  unmetConstraints: string[];
  trace: EditorialTrace;
}

export interface EditorialSearchProvider {
  (query: string, signal?: AbortSignal): Promise<SearchCandidate[]>;
}

export interface EditorialArticleFetcher {
  (url: string, signal?: AbortSignal): Promise<FetchedArticlePage>;
}

export interface EditorialOptions {
  /** Dynamic search may be overridden in deterministic tests; production defaults to DuckDuckGo. */
  search?: EditorialSearchProvider;
  /**
   * Official publisher feeds, read alongside search and merged into the same
   * deduplicated candidate set. Overridable so tests need no network.
   */
  feedDiscovery?: (
    topics: string[],
    signal?: AbortSignal,
  ) => Promise<{ candidates: SearchCandidate[]; decisions: string[] }>;
  /** Required so article URLs always pass through the service's SSRF-safe, pinned-IP adapter. */
  fetchArticle: EditorialArticleFetcher;
  now?: () => Date;
  maxArticleChecks?: number;
  signal?: AbortSignal;
  semanticClient?: JsonCompletionClient;
  alreadyDelivered?: SemanticExistingArticleInput[];
  /**
   * Refuse any article the publisher says was published after this instant.
   *
   * Discovery always runs now, so a dated recovery of an earlier issue needs
   * this bound; without it a newly published article could be presented as an
   * older day's reading.
   */
  publishedNotAfter?: string;
}

export type EditorialCollectionFailureCode =
  | "reader_discovery_unavailable"
  | "reader_source_unavailable"
  | "reader_semantic_unavailable";

export class EditorialCollectionError extends Error {
  constructor(
    readonly code: EditorialCollectionFailureCode,
    message: string,
    readonly retryable = true,
    readonly trace?: EditorialTrace,
  ) {
    super(message);
    this.name = "EditorialCollectionError";
  }
}

const SEARCH_TIMEOUT_MS = 12_000;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS_PER_QUERY = 12;
const MAX_QUERIES = 12;
const MAX_SHINGLE_CANDIDATES = 36;
// This map normalizes visible publisher names only. It never grants trust or
// determines FULL_TEXT eligibility.
const ESTABLISHED_EDITORIAL_PUBLISHER_NAMES: Record<string, string> = {
  "theguardian.com": "The Guardian",
  "theconversation.com": "The Conversation",
  "apnews.com": "Associated Press",
  "reuters.com": "Reuters",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "npr.org": "NPR",
  "nature.com": "Nature",
  "sciencedaily.com": "ScienceDaily",
  "arstechnica.com": "Ars Technica",
  "economist.com": "The Economist",
  "ft.com": "Financial Times",
  "nytimes.com": "The New York Times",
  "washingtonpost.com": "The Washington Post",
  "scientificamerican.com": "Scientific American",
  "aljazeera.com": "Al Jazeera",
  "cnbc.com": "CNBC",
  "theverge.com": "The Verge",
  "foreignaffairs.com": "Foreign Affairs",
};
const ENGLISH_MARKERS = new Set([
  "a", "about", "after", "all", "an", "and", "are", "as", "at", "be", "been",
  "but", "by", "can", "could", "for", "from", "had", "has", "have", "he", "her",
  "his", "if", "in", "into", "is", "it", "its", "may", "more", "most", "not",
  "of", "on", "one", "or", "our", "out", "said", "she", "so", "some", "than",
  "that", "the", "their", "them", "there", "these", "they", "this", "through", "to",
  "up", "was", "we", "were", "what", "when", "which", "while", "who", "will", "with",
  "would", "you", "your",
]);

const TOPIC_TERMS: Record<string, string[]> = {
  politics: ["politic", "election", "government", "parliament", "congress", "president", "minister", "legislation", "policy", "campaign", "vote", "senate"],
  economy: ["econom", "gdp", "inflation", "employment", "unemployment", "recession", "growth", "consumer prices", "trade", "productivity", "central bank"],
  finance: ["finance", "financial", "market", "stock", "bond", "investment", "investor", "bank", "interest rate", "credit", "currency", "fund", "earnings"],
  geopolitics: ["geopolit", "diplomacy", "diplomatic", "sanction", "military", "conflict", "war", "alliance", "foreign policy", "territory", "security", "treaty", "summit"],
  technology: ["technology", "technolog", "tech", "software", "artificial intelligence", "machine learning", "semiconductor", "chip", "computing", "cyber", "robot", "data center", "internet"],
  science: ["science", "scientific", "research", "study", "climate", "biology", "physics", "discovery", "scientist"],
  health: ["health", "medical", "medicine", "hospital", "patient", "disease", "public health", "clinical"],
  environment: ["environment", "climate", "emissions", "energy", "renewable", "pollution", "conservation", "wildlife"],
  business: ["business", "company", "corporate", "industry", "executive", "startup", "merger", "acquisition", "revenue"],
};

const QUERY_VARIANTS = [
  "latest news in-depth article",
  "recent news analysis long-form article",
  "explainer reporting English article",
  "independent analysis reporting",
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isTransientSourceStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function wordTokens(value: string): string[] {
  return value.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
}

function whitespaceWordCount(value: string): number {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.split(" ").length : 0;
}

export function countSentenceEnds(value: string): number {
  const endings = value.match(/(?<!\d)[.!?]+(?:["'’”’»)\]]*)(?=\s|$)/gu) ?? [];
  return Math.max(1, endings.length);
}

export function countSyllablesInWord(value: string): number {
  const word = value.toLowerCase().replace(/[^a-z]/gu, "");
  if (!word) return 0;
  let groups = (word.match(/[aeiouy]+/gu) ?? []).length;
  const consonantLe = /[^aeiouy]le$/u.test(word);
  if (word.length > 2 && /e$/u.test(word) && !consonantLe) groups -= 1;
  return Math.max(1, groups);
}

export function readingMetrics(body: string): {
  wordCount: number;
  fkglWordCount: number;
  sentenceCount: number;
  syllableCount: number;
  readingMinutes: number;
  fkgl: number | null;
  difficulty: ReaderDifficulty | null;
} {
  const words = wordTokens(body);
  const wordCount = whitespaceWordCount(body);
  const fkglWordCount = words.length;
  const sentenceCount = countSentenceEnds(body);
  const syllableCount = words.reduce((sum, word) => sum + countSyllablesInWord(word), 0);
  const readingMinutes = wordCount / 200;
  if (fkglWordCount === 0 || sentenceCount === 0) {
    return { wordCount, fkglWordCount, sentenceCount, syllableCount, readingMinutes, fkgl: null, difficulty: null };
  }
  const fkgl =
    0.39 * (fkglWordCount / sentenceCount) +
    11.8 * (syllableCount / fkglWordCount) -
    15.59;
  const difficulty: ReaderDifficulty =
    fkgl <= 8 ? "Easy" : fkgl <= 12 ? "Intermediate" : "Advanced";
  return { wordCount, fkglWordCount, sentenceCount, syllableCount, readingMinutes, fkgl, difficulty };
}

function displayPublication(hostname: string): string {
  const knownPublisher = Object.entries(ESTABLISHED_EDITORIAL_PUBLISHER_NAMES).find(
    ([root]) => hostname === root || hostname.endsWith(`.${root}`),
  )?.[1];
  if (knownPublisher) return knownPublisher;
  const labels = hostname.toLowerCase().replace(/^www\./u, "").split(".");
  const compoundTlds = new Set(["co.uk", "com.au", "co.nz", "com.br", "co.jp", "com.sg"]);
  const suffix = labels.slice(-2).join(".");
  const brandLabels = compoundTlds.has(suffix) ? labels.slice(-3, -2) : labels.slice(-2, -1);
  return (brandLabels[0] || hostname).replace(/[-_]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    const removable = [...url.searchParams.keys()].filter((key) =>
      /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/iu.test(key),
    );
    for (const key of removable) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function queryVariants(topics: string[]): string[] {
  const variants: string[] = [];
  for (let variantIndex = 0; variantIndex < QUERY_VARIANTS.length && variants.length < MAX_QUERIES; variantIndex += 1) {
    for (const topic of topics) {
      if (variants.length >= MAX_QUERIES) break;
      variants.push(`${topic} ${QUERY_VARIANTS[variantIndex]}`);
    }
  }
  return [...new Set(variants)].slice(0, MAX_QUERIES);
}

async function readBounded(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw new Error("Search response exceeds the size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Search response exceeds the size limit.");
    }
    chunks.push(value);
  }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

const SEARCH_USER_AGENT = "SayItReader/1.0 (local English reading workspace)";

function proxyBypassesHost(hostname: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env.no_proxy || env.NO_PROXY;
  if (!raw) return false;
  const host = hostname.toLowerCase();
  return raw.split(",").some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*") return true;
    const trimmed = pattern.replace(/^\*\./, ".");
    if (trimmed.startsWith(".")) {
      return host === trimmed.slice(1) || host.endsWith(trimmed);
    }
    return host === trimmed;
  });
}

function httpsProxyFor(hostname: string, env: NodeJS.ProcessEnv = process.env): URL | undefined {
  const value = env.https_proxy || env.HTTPS_PROXY;
  if (!value || proxyBypassesHost(hostname, env)) return undefined;
  let proxy: URL;
  try {
    proxy = new URL(value);
  } catch {
    return undefined;
  }
  if (proxy.protocol !== "http:") return undefined;
  return proxy;
}

function parseSearchHttpResponse(raw: Buffer): { status: number; location?: string; body: Buffer } {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error("Search response was incomplete.");
  const lines = raw.subarray(0, headerEnd).toString("latin1").split("\r\n");
  const status = Number(lines[0]?.split(" ")[1] ?? 0);
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  let body = raw.subarray(headerEnd + 4);
  if ((headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) {
    body = decodeChunkedSearchBody(body);
  } else if (headers.has("content-length")) {
    const length = Number(headers.get("content-length"));
    if (Number.isFinite(length) && length >= 0) body = body.subarray(0, length);
  }
  if (body.byteLength > MAX_SEARCH_BYTES) throw new Error("Search response exceeds the size limit.");
  const location = headers.get("location");
  return { status, body, ...(location ? { location } : {}) };
}

function decodeChunkedSearchBody(raw: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < raw.length) {
    const lineEnd = raw.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const size = Number.parseInt(raw.subarray(offset, lineEnd).toString("latin1").split(";")[0]?.trim() ?? "", 16);
    if (!Number.isFinite(size)) throw new Error("Search response was incomplete.");
    offset = lineEnd + 2;
    if (size === 0) break;
    parts.push(raw.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(parts);
}

function allowedSearchHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith("duckduckgo.com") || host.endsWith("bing.com") || host.endsWith("google.com");
}

interface SearchHttpRequest {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

function fetchSearchThroughProxy(
  target: URL,
  proxy: URL,
  signal: AbortSignal,
  redirects: number,
  request?: SearchHttpRequest,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Search was aborted."));
      return;
    }
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: "CONNECT",
      path: `${target.hostname}:443`,
      headers: { Host: `${target.hostname}:443` },
    });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      connectReq.destroy();
      reject(error);
    };
    const onAbort = () => fail(new Error("Search was aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    connectReq.setTimeout(SEARCH_TIMEOUT_MS, () => fail(new Error("Search proxy timed out.")));
    connectReq.on("error", fail);
    connectReq.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`Search proxy rejected the connection (HTTP ${response.statusCode ?? 0}).`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname });
      const chunks: Buffer[] = [];
      let received = 0;
      const destroyBoth = () => {
        tlsSocket.destroy();
        socket.destroy();
      };
      signal.addEventListener("abort", destroyBoth, { once: true });
      tlsSocket.setTimeout(SEARCH_TIMEOUT_MS, destroyBoth);
      tlsSocket.on("secureConnect", () => {
        const method = request?.method ?? "GET";
        const body = request?.body ?? "";
        const headerLines = [
          `${method} ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.hostname}`,
          "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding: identity",
          `User-Agent: ${SEARCH_USER_AGENT}`,
          ...Object.entries(request?.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
        ];
        if (body) headerLines.push(`Content-Length: ${Buffer.byteLength(body)}`);
        headerLines.push("Connection: close");
        tlsSocket.write(`${headerLines.join("\r\n")}\r\n\r\n${body}`);
      });
      tlsSocket.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > MAX_SEARCH_BYTES + 64 * 1024) {
          destroyBoth();
          fail(new Error("Search response exceeds the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      tlsSocket.on("error", (error) => fail(error));
      tlsSocket.on("end", () => {
        if (settled) return;
        try {
          const parsed = parseSearchHttpResponse(Buffer.concat(chunks));
          if (parsed.status >= 300 && parsed.status < 400 && parsed.location && redirects < 3) {
            const next = new URL(parsed.location, target);
            if (next.protocol !== "https:" || !allowedSearchHost(next.hostname)) {
              fail(new Error(`Search provider returned HTTP ${parsed.status}.`));
              return;
            }
            settled = true;
            signal.removeEventListener("abort", onAbort);
            resolve(fetchSearchThroughProxy(next, proxy, signal, redirects + 1));
            return;
          }
          if (parsed.status < 200 || parsed.status >= 300) {
            fail(new Error(`Search provider returned HTTP ${parsed.status}.`));
            return;
          }
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(new Response(new Uint8Array(parsed.body), { status: parsed.status }));
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Search response could not be read."));
        }
      });
    });
    connectReq.end();
  });
}

async function fetchSearchDocument(
  url: string,
  signal: AbortSignal,
  request?: SearchHttpRequest,
): Promise<Response> {
  const target = new URL(url);
  const proxy = httpsProxyFor(target.hostname);
  if (proxy) return fetchSearchThroughProxy(target, proxy, signal, 0, request);
  return fetch(url, {
    method: request?.method ?? "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1",
      "User-Agent": SEARCH_USER_AGENT,
      ...request?.headers,
    },
    body: request?.body,
    redirect: "follow",
    signal,
  });
}

function candidateFromResolvedUrl(resolved: string, title: string, snippet: string): SearchCandidate | null {
  const normalized = normalizeUrl(resolved);
  if (!normalized || !title) return null;
  return {
    url: normalized,
    title,
    snippet,
    // Search result breadcrumbs may contain path text or a display alias. Keep the
    // discovered host as the original-source attribution and track redirects separately.
    publication: hostOf(normalized) ? displayPublication(hostOf(normalized)!) : undefined,
  };
}

function parseDuckDuckGoResults(html: string): SearchCandidate[] {
  const document = new JSDOM(html).window.document;
  const candidates: SearchCandidate[] = [];
  for (const result of document.querySelectorAll<HTMLElement>(".result")) {
    const anchor = result.querySelector<HTMLAnchorElement>("a.result__a");
    const title = normalizeWhitespace(anchor?.textContent ?? "");
    const href = anchor?.getAttribute("href");
    const snippet = normalizeWhitespace(result.querySelector(".result__snippet")?.textContent ?? "");
    if (!href || !title) continue;
    let resolved: string;
    try {
      const link = new URL(href, "https://html.duckduckgo.com");
      const wrapped = link.searchParams.get("uddg");
      resolved = wrapped ? new URL(wrapped).toString() : link.toString();
    } catch {
      continue;
    }
    const candidate = candidateFromResolvedUrl(resolved, title, snippet);
    if (!candidate) continue;
    candidates.push(candidate);
    if (candidates.length >= MAX_RESULTS_PER_QUERY) break;
  }
  return candidates;
}

function searchPageIsChallenge(html: string): boolean {
  return /anomaly-modal|challenge-form|cc=botnet/i.test(html);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function parseBingNewsRss(xml: string): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? "";
    const title = normalizeWhitespace(decodeXmlEntities(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
    const rawLink = decodeXmlEntities(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    const snippet = normalizeWhitespace(
      decodeXmlEntities(block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? "").replace(/<[^>]+>/g, ""),
    );
    let resolved = "";
    try {
      resolved = new URL(rawLink).searchParams.get("url") ?? "";
    } catch {
      continue;
    }
    const candidate = candidateFromResolvedUrl(resolved, title, snippet);
    if (!candidate) continue;
    candidates.push(candidate);
    if (candidates.length >= MAX_RESULTS_PER_QUERY) break;
  }
  return candidates;
}

async function searchBingNews(query: string, signal: AbortSignal): Promise<SearchCandidate[]> {
  const response = await fetchSearchDocument(
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
    signal,
  );
  if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}.`);
  const xml = await readBounded(response, MAX_SEARCH_BYTES);
  return parseBingNewsRss(xml);
}

function articleCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  return candidates.filter((candidate) => {
    try {
      const segments = new URL(candidate.url).pathname.replace(/\/+$/u, "").split("/").filter(Boolean);
      return segments.length >= 2;
    } catch {
      return false;
    }
  });
}

async function decodeGoogleNewsArticle(link: string, signal: AbortSignal): Promise<string | null> {
  const id = new URL(link).pathname.split("/").pop();
  if (!id) return null;
  const page = await fetchSearchDocument(link, signal);
  if (!page.ok) return null;
  const html = await readBounded(page, MAX_SEARCH_BYTES);
  const timestamp = html.match(/data-n-a-ts="(\d+)"/)?.[1];
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  if (!timestamp || !signature) return null;
  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ]);
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const decoded = await fetchSearchDocument(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    signal,
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Referer: "https://news.google.com/",
      },
    },
  );
  if (!decoded.ok) return null;
  const text = await readBounded(decoded, MAX_SEARCH_BYTES);
  return text.match(/https:\/\/[^"\\]+/)?.[0] ?? null;
}

async function searchGoogleNews(query: string, signal: AbortSignal): Promise<SearchCandidate[]> {
  const response = await fetchSearchDocument(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    signal,
  );
  if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}.`);
  const xml = await readBounded(response, MAX_SEARCH_BYTES);
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 3);
  const candidates: SearchCandidate[] = [];
  for (const match of items) {
    if (signal.aborted) break;
    const block = match[1] ?? "";
    const title = normalizeWhitespace(decodeXmlEntities(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
    const link = decodeXmlEntities(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    if (!title || !link) continue;
    try {
      const resolved = await decodeGoogleNewsArticle(link, signal);
      const candidate = resolved ? candidateFromResolvedUrl(resolved, title, "") : null;
      if (!candidate || !articleCandidates([candidate]).length) continue;
      candidates.push(candidate);
    } catch {
      continue;
    }
  }
  return candidates;
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  try {
    let discovered: SearchCandidate[] = [];
    let primaryError: Error | null = null;
    try {
      const response = await fetchSearchDocument(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        controller.signal,
      );
      if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}.`);
      const html = await readBounded(response, MAX_SEARCH_BYTES);
      discovered = articleCandidates(parseDuckDuckGoResults(html));
      if (discovered.length === 0 && searchPageIsChallenge(html)) {
        primaryError = new Error("Search provider returned a bot challenge instead of results.");
      }
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error("Search provider could not be reached.");
    }
    if (discovered.length === 0) {
      try {
        discovered = articleCandidates(await searchBingNews(query, controller.signal));
      } catch (error) {
        if (!primaryError) primaryError = error instanceof Error ? error : new Error("Search provider could not be reached.");
      }
    }
    if (discovered.length === 0) {
      try {
        discovered = await searchGoogleNews(query, controller.signal);
      } catch (error) {
        if (primaryError) throw primaryError;
        throw error;
      }
    }
    if (discovered.length === 0 && primaryError) throw primaryError;
    return discovered;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
  }
}

function extractStructuredArticle(document: Document): {
  publisher: string | null;
  articleBody: string | null;
  headline: string | null;
  publishedAt: string | null;
  licenses: string[];
  hasArticleType: boolean;
} {
  const records: unknown[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const decoded: unknown = JSON.parse(raw);
      records.push(decoded);
    } catch {
      // One malformed analytics block must not hide other valid structured data.
    }
  }
  const articles: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((item) => typeof item === "string" && /article|reportage|blogposting/iu.test(item))) {
      articles.push(record);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "@graph" || key === "mainEntity" || key === "mainEntityOfPage") visit(child, depth + 1);
    }
  };
  for (const record of records) visit(record);
  const textValue = (value: unknown): string | null => {
    if (typeof value === "string") return normalizeWhitespace(value) || null;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      if (typeof nested.name === "string") return normalizeWhitespace(nested.name) || null;
    }
    return null;
  };
  const article = articles.find((item) => item.articleBody || item.headline || item.publisher);
  const licenseValues = articles
    .map((item) => textValue(item.license))
    .filter((value): value is string => Boolean(value));
  // The publisher's own statement of when the article was published, so a dated
  // recovery can refuse to present a newer article as an older day's reading.
  const publishedAt =
    articleDate(article?.datePublished) ??
    articleDate(article?.dateCreated) ??
    (normalizeWhitespace(
      document.querySelector<HTMLMetaElement>('meta[property="article:published_time"]')
        ?.content ?? "",
    ) ||
      null);
  return {
    publisher: textValue(article?.publisher),
    articleBody: textValue(article?.articleBody),
    headline: textValue(article?.headline),
    publishedAt,
    licenses: licenseValues,
    hasArticleType: articles.length > 0,
  };
}

/** Read a structured publication date in a form that can be compared. */
function articleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function publisherMetadata(document: Document): {
  publisher: string | null;
  publisherSource: "structured_publisher" | "citation_publication_title" | "article_publisher" | null;
  siteName: string | null;
  canonicalUrl: string | null;
  licenses: string[];
  robots: string;
} {
  const structured = extractStructuredArticle(document);
  const meta = (selector: string) =>
    normalizeWhitespace(document.querySelector<HTMLMetaElement>(selector)?.content ?? "") || null;
  const citationPublisher = meta('meta[name="citation_publication_title"]');
  const articlePublisher = meta('meta[property="article:publisher"]');
  const publisher = structured.publisher ?? citationPublisher ?? articlePublisher;
  const publisherSource = structured.publisher
    ? "structured_publisher"
    : citationPublisher
      ? "citation_publication_title"
      : articlePublisher
        ? "article_publisher"
        : null;
  const siteName = meta('meta[property="og:site_name"]');
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  const licenses = [
    ...structured.licenses,
    ...[...document.querySelectorAll<HTMLLinkElement>('link[rel~="license"]')].map((link) => link.href),
    ...[...document.querySelectorAll<HTMLMetaElement>('meta[name="license"], meta[property="article:license"]')]
      .map((item) => item.content),
  ].map(normalizeWhitespace).filter(Boolean);
  const robots = [
    ...[...document.querySelectorAll<HTMLMetaElement>('meta[name="robots"], meta[name="googlebot"]')]
      .map((item) => item.content.toLowerCase()),
  ].join(" ");
  return { publisher, publisherSource, siteName, canonicalUrl: canonical, licenses, robots };
}

function titleMetadata(document: Document, structuredHeadline: string | null): string[] {
  const values = [
    structuredHeadline,
    normalizeWhitespace(document.querySelector<HTMLMetaElement>('meta[name="citation_title"]')?.content ?? "") || null,
    normalizeWhitespace(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? "") || null,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(values.map(normalizeWhitespace))];
}

function publisherNamesConflict(first: string | null, second: string | null): boolean {
  if (!first || !second) return false;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/&/gu, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const left = normalize(first);
  const right = normalize(second);
  if (!left || !right || left === right || left.includes(right) || right.includes(left)) return false;
  const ignored = new Set(["the", "news", "media", "group", "inc", "ltd", "limited", "company", "co", "corp", "corporation"]);
  const leftTokens = left.split(/\s+/u).filter((token) => token.length > 2 && !ignored.has(token));
  const rightTokens = new Set(right.split(/\s+/u).filter((token) => token.length > 2 && !ignored.has(token)));
  return leftTokens.length > 0 && !leftTokens.some((token) => rightTokens.has(token));
}

function cachePermission(values: string[], robots: string): CachePermission {
  if (/\bnoarchive\b/u.test(robots)) return "NOT_PERMITTED";
  const license = values.join(" ").toLowerCase();
  if (
    /creativecommons\.org\/(?:licenses\/(?:by|by-sa|zero)\/|publicdomain\/(?:zero|mark)\/)/u.test(license) ||
    /opensource\.org\/licenses\//u.test(license)
  ) {
    return "PERMITTED";
  }
  if (/all rights reserved|no reproduction|no redistribution/u.test(license)) return "NOT_PERMITTED";
  return "UNKNOWN";
}

function englishConfidence(body: string, declaredLanguage = ""): boolean {
  const tokens = wordTokens(body);
  if (tokens.length === 0) return false;
  if (/^en(?:-|$)/iu.test(declaredLanguage)) return true;
  const ascii = tokens.filter((token) => /^[a-z]+(?:['’][a-z]+)*$/iu.test(token)).length;
  const markers = tokens.filter((token) => ENGLISH_MARKERS.has(token.toLowerCase())).length;
  const requiredMarkers = Math.max(1, Math.min(5, Math.ceil(tokens.length * 0.02)));
  return ascii / tokens.length >= 0.85 && markers >= requiredMarkers && markers / tokens.length >= 0.02;
}

function pageFailure(document: Document, bodyText: string, title: string): string | null {
  const titleAndTop = `${title} ${normalizeWhitespace(document.body?.textContent ?? "").slice(0, 1200)}`;
  if (/verify (?:that )?you(?:'|’)re human|captcha|robot check|access denied|request blocked/iu.test(titleAndTop)) {
    return "The source returned a bot check, access denial, or verification page.";
  }
  if (/subscribe to continue reading|sign in to read the full|log in to read the full|unlock this story|continue reading after subscribing/iu.test(titleAndTop)) {
    return "The source exposes only a subscriber or sign-in prompt.";
  }
  if (document.querySelector('[class*="paywall" i], [id*="paywall" i], [data-paywall], [class*="captcha" i], [id*="captcha" i]')) {
    return "The source contains a paywall or verification gate.";
  }
  if (/\b(?:404|page not found|article not found|content unavailable)\b/iu.test(title) && bodyText.length < 1000) {
    return "The source article is no longer available.";
  }
  return null;
}

function isCollectionPageType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some(
    (type) => typeof type === "string" && /(?:^|[/#])(?:CollectionPage|SearchResultsPage)$/iu.test(type.trim()),
  );
}

function hasCollectionPageSemantics(document: Document): boolean {
  const microdata = [...document.querySelectorAll("[itemtype]")].some((element) =>
    (element.getAttribute("itemtype") ?? "").split(/\s+/u).some((type) => isCollectionPageType(type)),
  );
  if (microdata) return true;

  const visit = (value: unknown, depth = 0): boolean => {
    if (depth > 8 || !value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((item) => visit(item, depth + 1));
    const record = value as Record<string, unknown>;
    if (isCollectionPageType(record["@type"])) return true;
    return Object.values(record).some((item) => visit(item, depth + 1));
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      if (visit(JSON.parse(script.textContent ?? ""))) return true;
    } catch {
      // Malformed structured data cannot establish a collection page.
    }
  }
  return false;
}

function isCategoryOrListingPage(
  document: Document,
  readableContent: string,
  pageUrl: string,
  title: string,
): boolean {
  if (hasCollectionPageSemantics(document)) return true;

  const rawHeadings = [...document.querySelectorAll("h2, h3")];
  const rawLinkedStoryHeadings = rawHeadings.filter(
    (heading) => heading.querySelector("a[href]") || heading.parentElement?.matches("a[href]"),
  ).length;
  const hasHeadlineHubLabel = rawHeadings.some((heading) =>
    /^(?:top|latest|recent)\s+(?:headlines|stories|news)$/iu.test(
      normalizeWhitespace(heading.textContent ?? ""),
    ),
  );
  if (rawLinkedStoryHeadings >= 4 && hasHeadlineHubLabel) return true;

  const readableDocument = new JSDOM(readableContent).window.document;
  const linkedStoryHeadings = [...readableDocument.querySelectorAll("h2, h3")].filter(
    (heading) => heading.querySelector("a[href]") || heading.parentElement?.matches("a[href]"),
  ).length;
  if (linkedStoryHeadings >= 4) return true;

  let pathSegments: string[] = [];
  try {
    pathSegments = new URL(pageUrl).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment).toLowerCase());
  } catch {
    return false;
  }
  const sectionSegments = new Set([
    "news",
    "topic",
    "topics",
    "category",
    "categories",
    "section",
    "sections",
    "tag",
    "tags",
    "archive",
    "archives",
    "search",
    "latest",
    "editorials",
    "index",
    "indexes",
    "indices",
  ]);
  if (!pathSegments.some((segment) => sectionSegments.has(segment))) return false;

  const titleWords = wordTokens(title).map((word) => word.toLowerCase());
  const finalPathWords = wordTokens(pathSegments.at(-1)?.replace(/[-_]+/gu, " ") ?? "")
    .map((word) => word.toLowerCase());
  const genericPageTerms = new Set([
    "news", "latest", "articles", "stories", "topics", "category", "archive", "section", "search",
    "editorials", "index", "indexes", "indices",
  ]);
  const genericTitle =
    titleWords.length > 0 &&
    titleWords.length <= 4 &&
    (titleWords.some((word) => genericPageTerms.has(word)) || titleWords.length <= 2);
  const genericHubTitleAndPath =
    pathSegments.some((segment) => sectionSegments.has(segment)) &&
    genericTitle &&
    finalPathWords.some((word) => titleWords.includes(word));
  if (genericHubTitleAndPath) return true;
  return false;
}

function topicEvidence(topics: string[], title: string, body: string): { topics: string[]; evidence: string[] } {
  const searchable = `${title} ${body}`.toLowerCase();
  const matched: string[] = [];
  const evidence: string[] = [];
  for (const topic of topics) {
    const normalized = topic.trim().toLowerCase();
    const terms = TOPIC_TERMS[normalized] ?? [normalized, ...normalized.split(/\s+/u).filter((item) => item.length > 3)];
    const found = [...new Set(terms.filter((term) => term && searchable.includes(term)))];
    if (found.length) {
      matched.push(topic);
      evidence.push(`${topic}: ${found.slice(0, 5).join(", ")}`);
    }
  }
  return { topics: matched, evidence };
}

function shingleSet(body: string, width = 5): Set<string> {
  const words = wordTokens(body).map((word) => word.toLowerCase());
  if (words.length < width) return new Set(words.length ? [words.join(" ")] : []);
  const values = new Set<string>();
  for (let index = 0; index <= words.length - width; index += 1) {
    values.add(words.slice(index, index + width).join(" "));
  }
  return values;
}

export function shingleJaccard(left: string, right: string): number {
  const a = shingleSet(left);
  const b = shingleSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function makeCandidateSummary(
  source: SearchCandidate,
  status: CandidateContentStatus,
  reason: string,
  statusCode: number | null,
): EditorialArticle {
  const original = normalizeUrl(source.url) ?? source.url;
  const host = hostOf(original);
  const publication = normalizeWhitespace(source.publication ?? "") || (host ? displayPublication(host) : "Unverified source");
  return {
    id: hash(original).slice(0, 24),
    title: normalizeWhitespace(source.title) || "Untitled article candidate",
    originalPublication: publication,
    originalUrl: original,
    accessiblePublication: publication,
    accessibleUrl: original,
    contentStatus: status,
    wordCount: 0,
    fkglWordCount: 0,
    sentenceCount: 0,
    syllableCount: 0,
    readingMinutes: 0,
    fkgl: null,
    readState: "UNREAD",
    cachePermission: "UNKNOWN",
    topics: [],
    difficulty: null,
    paragraphCount: 0,
    // Kept on the summary object only through the trace. UI does not treat it as delivered.
    bodyHash: undefined,
  };
}

interface VerifiedCandidate {
  article: EditorialArticle;
  body: string;
  source: SearchCandidate;
  topicalEvidence: string[];
  trace: EditorialCandidateTrace;
}

function paragraphsFromReadability(content: string): string[] {
  const document = new JSDOM(content).window.document;
  return [...document.querySelectorAll("p")]
    .map((paragraph) => normalizeWhitespace(paragraph.textContent ?? ""))
    .filter(Boolean);
}

interface SourceArticleParagraphs {
  paragraphs: string[];
  verifiedBodyBoundary: boolean;
}

function hasVerifiedStandaloneArticleRoot(
  document: Document,
  title: string,
  hasStructuredArticleType: boolean,
  declaredTitles: string[],
): boolean {
  const openGraphType = normalizeWhitespace(
    document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content ?? "",
  ).toLowerCase();
  if (openGraphType !== "article" && !hasStructuredArticleType) return false;
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  if (declaredTitles.length === 0) return false;
  const roots = [...document.querySelectorAll("article")];
  if (roots.length > 1) return false;
  const normalizeHeading = (heading: Element) =>
    normalizeWhitespace(heading.textContent ?? "").toLowerCase();
  const headings = (roots.length === 1
    ? [...roots[0]!.querySelectorAll("h1")]
    : [...document.querySelectorAll("h1")])
    .map(normalizeHeading)
    .filter(Boolean);
  if (headings.length !== 1 || headings[0] !== normalizedTitle) return false;

  // Some publisher schemas append the site name to the structured headline
  // while the visible H1 and Open Graph title carry the exact article title.
  // Permit only an exact publisher suffix; conflicting titles still fail.
  const publisherNames = [
    document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[property="article:publisher"]')?.content,
    extractStructuredArticle(document).publisher,
  ]
    .map((value) => normalizeWhitespace(value ?? "").toLowerCase())
    .filter(Boolean);
  return declaredTitles.every((declared) => {
    const normalized = normalizeWhitespace(declared).toLowerCase();
    if (normalized === normalizedTitle) return true;
    return publisherNames.some(
      (publisher) =>
        normalized === `${normalizedTitle} | ${publisher}` ||
        normalized === `${normalizedTitle} - ${publisher}` ||
        normalized === `${normalizedTitle} — ${publisher}`,
    );
  });
}

function isMediaCredit(paragraph: string): boolean {
  return paragraph.length <= 80 && /^(illustration|photo|photograph|image|caption)\s+by\b/iu.test(paragraph);
}

function storyParagraphs(root: ParentNode): string[] {
  return [...root.querySelectorAll("p")]
    .filter((paragraph) => !paragraph.closest("form, aside, nav, footer, [role='complementary']"))
    .map((paragraph) => normalizeWhitespace(paragraph.textContent ?? ""))
    .filter((paragraph) => paragraph.length > 0 && !isMediaCredit(paragraph));
}

function narrowFallbackContentRoot(root: Element): Element {
  const heading = root.querySelector("h1");
  if (!heading) return root;
  let node: Element = heading;
  while (node.parentElement && !/^(BODY|HTML)$/u.test(node.parentElement.tagName)) {
    const parent = node.parentElement;
    const currentCount = storyParagraphs(node).length;
    const parentCount = storyParagraphs(parent).length;
    const added = parentCount - currentCount;
    if (currentCount >= 3 && added > 0 && added / parentCount > 0.12) break;
    node = parent;
  }
  return node;
}

function sourceArticleParagraphs(
  document: Document,
  structuredBody: string | null,
  verifiedStandaloneArticleRoot: boolean,
): SourceArticleParagraphs {
  const articleBodyRoots = [...document.querySelectorAll('[itemprop~="articleBody"]')];
  const publisherBodyRoots = verifiedStandaloneArticleRoot
    ? [...document.querySelectorAll('article [data-gu-name="body"]')]
    : [];
  const articleRoots = [...document.querySelectorAll("article")];
  const roots = articleBodyRoots.length > 0
    ? articleBodyRoots
    : publisherBodyRoots.length > 0
      ? publisherBodyRoots
      : articleRoots.length > 0
        ? articleRoots
        : [...document.querySelectorAll("main, [role='main']")].map((root) => narrowFallbackContentRoot(root));
  const paragraphSets = roots.map((root) => storyParagraphs(root));
  const paragraphs = paragraphSets
    .sort((left, right) => right.join(" ").length - left.join(" ").length)[0] ?? [];
  const structuredBodyMatchesSource = Boolean(
    structuredBody && normalizeWhitespace(paragraphs.join(" ")) === normalizeWhitespace(structuredBody),
  );
  return {
    paragraphs,
    verifiedBodyBoundary:
      articleBodyRoots.length > 0 || publisherBodyRoots.length > 0 || structuredBodyMatchesSource || verifiedStandaloneArticleRoot,
  };
}

function missingSourceParagraphs(sourceParagraphs: string[], extractedParagraphs: string[]): number {
  if (sourceParagraphs.length === 0) return 0;
  const extractedText = normalizeWhitespace(extractedParagraphs.join(" ")).toLowerCase();
  let cursor = 0;
  let missing = 0;
  for (const paragraph of sourceParagraphs) {
    const normalized = normalizeWhitespace(paragraph).toLowerCase();
    const index = extractedText.indexOf(normalized, cursor);
    if (index < 0) {
      missing += 1;
      continue;
    }
    cursor = index + normalized.length;
  }
  return missing;
}

function extractPage(source: SearchCandidate, page: FetchedArticlePage): {
  article: EditorialArticle | null;
  body: string;
  summary: EditorialArticle;
  reason: string;
  recoveredParagraphCount?: number;
} {
  const header = (name: string) => {
    const value = page.headers[name] ?? page.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const contentType = (header("content-type") ?? "").toLowerCase();
  const defaultSummary = makeCandidateSummary(source, "UNAVAILABLE", "The candidate did not contain a verified readable article.", page.statusCode);
  if (page.statusCode < 200 || page.statusCode >= 300) {
    const status = page.statusCode === 401 || page.statusCode === 402 || page.statusCode === 403
      ? "EXTERNAL_ONLY"
      : page.statusCode === 404 || page.statusCode === 410
        ? "UNAVAILABLE"
        : "UNAVAILABLE";
    return { article: null, body: "", summary: { ...defaultSummary, contentStatus: status }, reason: `Source returned HTTP ${page.statusCode}.` };
  }
  if (!/^text\/(?:html|xhtml\+xml)\b/u.test(contentType)) {
    return { article: null, body: "", summary: { ...defaultSummary, contentStatus: "EXTERNAL_ONLY" }, reason: "The accessible version is not an HTML article page." };
  }

  const html = page.body.toString("utf8");
  const sourceUrl = normalizeUrl(source.url);
  const reachableUrl = normalizeUrl(page.finalUrl);
  if (!sourceUrl || !reachableUrl) {
    return { article: null, body: "", summary: defaultSummary, reason: "The original or accessible URL could not be verified as HTTPS." };
  }
  const parsed = new JSDOM(html, { url: page.finalUrl });
  const document = parsed.window.document;
  const declaredLanguage = document.documentElement.lang.trim().toLowerCase();
  if (declaredLanguage && declaredLanguage !== "en" && !declaredLanguage.startsWith("en-")) {
    const summary = makeCandidateSummary(source, "EXTERNAL_ONLY", "The page identifies a non-English article.", page.statusCode);
    return { article: null, body: "", summary, reason: "The accessible page identifies a non-English article." };
  }

  const structured = extractStructuredArticle(document);
  const metadata = publisherMetadata(document);
  const publisherIdentity = metadata.publisher ?? metadata.siteName;
  const publisherIdentitySources = [
    metadata.publisherSource,
    metadata.siteName ? "open_graph_site_name" as const : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  const canonical = normalizeUrl(metadata.canonicalUrl ?? "");
  const canonicalRelationship = canonical === sourceUrl
    ? "original_url" as const
    : canonical === reachableUrl
      ? "accessible_url" as const
      : // A publisher's own canonical URL on the same host is a stronger
        // statement of the article's identity than the link that led here, so it
        // is adopted instead of rejecting the article. A canonical that leaves
        // the publisher's host is still refused below.
        canonical && hostOf(canonical) === hostOf(reachableUrl)
        ? "publisher_canonical" as const
        : null;
  // The declared canonical becomes the article's address, so a stored article
  // always points at the publisher's own identity for it.
  const accessibleUrl =
    canonicalRelationship === "publisher_canonical" && canonical
      ? canonical
      : reachableUrl;
  const fallbackForProvenance = (reason: string, title = source.title) => {
    const summary = makeCandidateSummary(source, "EXTERNAL_ONLY", reason, page.statusCode);
    return {
      article: null,
      body: "",
      summary: {
        ...summary,
        title: normalizeWhitespace(title || "") || summary.title,
        accessibleUrl,
      },
      reason,
    };
  };
  if (publisherNamesConflict(metadata.publisher, metadata.siteName)) {
    return fallbackForProvenance("Publisher identity metadata conflicts.");
  }
  if (!publisherIdentity || publisherIdentitySources.length === 0) {
    return fallbackForProvenance("Publisher identity could not be attributed to article-page metadata.");
  }
  if (!canonical || !canonicalRelationship) {
    return fallbackForProvenance("Canonical URL is missing or does not match the discovered or accessible article URL.");
  }
  const reader = new Readability(document.cloneNode(true) as Document, { charThreshold: 100 });
  const parsedArticle = reader.parse();
  const readabilityContent = parsedArticle?.content ?? "";
  const declaredTitles = titleMetadata(document, structured.headline);
  // Prefer the visible H1 over Readability's title and schema headlines, which
  // sometimes append the site name. The standalone-root check below requires
  // the H1 and every declared headline to agree, allowing only an exact site
  // suffix on publisher metadata.
  const title = normalizeWhitespace(
    document.querySelector("h1")?.textContent || declaredTitles[0] || parsedArticle?.title || source.title,
  );
  const standaloneArticleVerified = hasVerifiedStandaloneArticleRoot(
    document,
    title,
    structured.hasArticleType,
    declaredTitles,
  );
  if (isCategoryOrListingPage(document, readabilityContent, page.finalUrl, title)) {
    const summary = makeCandidateSummary(
      source,
      "SUMMARY",
      "The source is a category or story listing, not an individual article.",
      page.statusCode,
    );
    return {
      article: null,
      body: "",
      summary,
      reason: "The source is a category or story listing, not an individual article.",
    };
  }
  if (!standaloneArticleVerified) {
    return fallbackForProvenance("Standalone article structure and title metadata do not agree.", title);
  }
  let paragraphs = paragraphsFromReadability(readabilityContent)
    .filter((paragraph) => !isMediaCredit(paragraph));
  const sourceBody = sourceArticleParagraphs(
    document,
    structured.articleBody,
    standaloneArticleVerified,
  );
  const sourceParagraphs = sourceBody.paragraphs;
  if (!sourceBody.verifiedBodyBoundary || sourceParagraphs.length === 0) {
    const reason = "The publisher page did not expose a verified article body.";
    const summary = makeCandidateSummary(source, "SUMMARY", reason, page.statusCode);
    return { article: null, body: "", summary, reason };
  }
  let omittedParagraphCount = missingSourceParagraphs(sourceParagraphs, paragraphs);
  let recoveredParagraphCount = 0;
  const sourceText = normalizeWhitespace(sourceParagraphs.join(" ")).toLowerCase();
  const extraneousParagraphs = paragraphs.filter((paragraph) => !sourceText.includes(normalizeWhitespace(paragraph).toLowerCase()));
  if (extraneousParagraphs.length > 0) {
    const extraneous = new Set(extraneousParagraphs);
    paragraphs = paragraphs.filter((paragraph) => !extraneous.has(paragraph));
    omittedParagraphCount = missingSourceParagraphs(sourceParagraphs, paragraphs);
  }
  if (
    omittedParagraphCount > 0 &&
    sourceParagraphs.length > 0 &&
    sourceBody.verifiedBodyBoundary
  ) {
    // The publisher's verified article body is the output source of truth. Readability
    // may omit any number of real paragraphs or include page chrome, so rebuild the
    // Reader body from that source instead of rejecting a complete article by ratio.
    const reconstructedParagraphs = [...sourceParagraphs];
    recoveredParagraphCount = omittedParagraphCount;
    paragraphs = reconstructedParagraphs;
    omittedParagraphCount = missingSourceParagraphs(sourceParagraphs, paragraphs);
  }
  const body = paragraphs.join("\n\n");
  if (omittedParagraphCount > 0) {
    const reason = "The verified publisher body could not be reconstructed from its article paragraphs.";
    const summary = makeCandidateSummary(source, "SUMMARY", reason, page.statusCode);
    return { article: null, body, summary, reason };
  }
  const failedPage = pageFailure(document, body, title);
  if (failedPage) {
    const summary = makeCandidateSummary(source, /subscriber|sign-in|paywall/iu.test(failedPage) ? "EXTERNAL_ONLY" : "UNAVAILABLE", failedPage, page.statusCode);
    return { article: null, body, summary, reason: failedPage };
  }
  const reading = readingMetrics(body);
  if (!englishConfidence(body, declaredLanguage)) {
    const summary = makeCandidateSummary(source, "EXTERNAL_ONLY", "The extracted body could not be verified as English.", page.statusCode);
    return { article: null, body, summary, reason: "The extracted text did not meet the English-language check." };
  }
  const originalHost = hostOf(sourceUrl);
  const originalPublication = originalHost ? displayPublication(originalHost) : publisherIdentity;
  const accessiblePublication = publisherIdentity;
  const bodyHash = hash(paragraphs.join("\n\n").toLowerCase());
  const article: EditorialArticle = {
    id: hash(sourceUrl).slice(0, 24),
    title,
    originalPublication,
    originalUrl: sourceUrl,
    accessiblePublication,
    accessibleUrl,
    contentStatus: "FULL_TEXT",
    ...reading,
    readState: "UNREAD",
    cachePermission: cachePermission(metadata.licenses, metadata.robots),
    topics: [],
    paragraphCount: paragraphs.length,
    paragraphs,
    bodyHash,
    // The publisher's stated publication time, which a dated recovery must
    // check before it may place this article in an earlier day's issue.
    publishedAt: structured.publishedAt,
    provenance: {
      publisherIdentity,
      publisherIdentitySources,
      canonicalRelationship,
      standaloneArticleVerified: true,
      titleAgreementVerified: true,
      bodyCompletenessVerified: true,
    },
  };
  return {
    article,
    body,
    summary: article,
    reason: recoveredParagraphCount > 0
      ? `Verified readable English article body; reconstructed ${recoveredParagraphCount} omitted paragraph(s) from the verified source article body.`
      : "Verified readable English article body.",
    recoveredParagraphCount,
  };
}

function topicTermsFor(topic: string): string[] {
  const normalized = topic.trim().toLowerCase();
  return TOPIC_TERMS[normalized] ?? [normalized, ...normalized.split(/\s+/u).filter((item) => item.length > 3)];
}

function evaluateVerified(
  source: SearchCandidate,
  page: FetchedArticlePage,
  preferences: EditorialPreferences,
): { article: EditorialArticle | null; summary: EditorialArticle; body: string; reason: string; topicalEvidence?: string[]; trace: EditorialCandidateTrace } {
  const extracted = extractPage(source, page);
  const fallbackPublication = extracted.summary.originalPublication;
  if (!extracted.article) {
    return {
      ...extracted,
      trace: {
        url: source.url,
        publication: fallbackPublication,
        outcome: "REJECTED",
        reason: extracted.reason,
        statusCode: page.statusCode,
        articleId: extracted.summary.id,
      },
    };
  }
  const matched = topicEvidence(preferences.topics, extracted.article.title, extracted.body);
  const withTopics = { ...extracted.article, topics: matched.topics };
  const topicalReason = matched.evidence.length > 0
    ? `Keyword evidence for semantic topic review: ${matched.evidence.join("; ")}.`
    : "No direct configured-topic keyword match; retained for semantic topic review.";
  return {
    article: withTopics,
    summary: withTopics,
    body: extracted.body,
    reason: topicalReason,
    topicalEvidence: matched.topics,
    trace: {
      url: source.url,
      publication: withTopics.originalPublication,
      outcome: "ACCEPTED",
      reason: `${topicalReason} ${withTopics.wordCount} reading words; FKGL ${withTopics.fkgl?.toFixed(2) ?? "unavailable"}.${extracted.recoveredParagraphCount ? ` Reconstructed ${extracted.recoveredParagraphCount} paragraph(s) from the verified source article body after Readability omission.` : ""}`,
      statusCode: page.statusCode,
      articleId: withTopics.id,
    },
  };
}

export interface StoredArticleReference {
  id: string;
  title: string;
  originalPublication: string;
  originalUrl: string;
  accessiblePublication: string;
  accessibleUrl: string;
  topics: string[];
}

/**
 * Revalidate a previously delivered article from its original URL without running discovery.
 * The service may use a separately verified, explicitly cache-permitted body when offline.
 */
export async function readArticleFullText(
  reference: StoredArticleReference,
  fetchArticle: EditorialArticleFetcher,
  signal?: AbortSignal,
): Promise<{ article: EditorialArticle | null; reason: string }> {
  const originalUrl = normalizeUrl(reference.originalUrl);
  const accessibleUrl = normalizeUrl(reference.accessibleUrl);
  const sourceUrls = [...new Set([originalUrl, accessibleUrl].filter((url): url is string => Boolean(url)))];
  if (!sourceUrls.length || !reference.topics.length) {
    return { article: null, reason: "Stored article reference is incomplete or invalid." };
  }
  let lastReason = "The archived article could not be revalidated.";
  for (const sourceUrl of sourceUrls) {
    try {
      const page = await fetchArticle(sourceUrl, signal);
      // A publisher-affiliate copy may declare the original publisher's URL as
      // its canonical. Accept that only for the already saved accessible URL;
      // the normal extractor still verifies the page publisher, article title,
      // and H1 against the saved article.
      const identityUrl =
        sourceUrl === accessibleUrl && originalUrl ? originalUrl : sourceUrl;
      const source: SearchCandidate = {
        url: identityUrl,
        title: reference.title,
        snippet: "",
        publication: reference.originalPublication,
      };
      const extracted = extractPage(source, page);
      if (!extracted.article) {
        lastReason = extracted.reason;
        continue;
      }
      if (titleSimilarity(reference.title, extracted.article.title) < 0.35) {
        lastReason = "The current page title no longer matches the archived article.";
        continue;
      }
      const matched = topicEvidence(reference.topics, extracted.article.title, extracted.body);
      if (matched.topics.length === 0) {
        lastReason = "The current page no longer matches the archived article topics.";
        continue;
      }
      return {
        article: {
          ...extracted.article,
          id: reference.id,
          title: reference.title,
          originalPublication: reference.originalPublication,
          originalUrl: originalUrl ?? sourceUrl,
          accessiblePublication: extracted.article.accessiblePublication,
          accessibleUrl: extracted.article.accessibleUrl,
          topics: matched.topics,
        },
        reason: "The archived article was re-fetched and its full text was revalidated.",
      };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : "The archived article could not be revalidated.";
    }
  }
  return { article: null, reason: lastReason };
}

function titleSimilarity(left: string, right: string): number {
  const tokens = (value: string) => new Set(wordTokens(value).map((word) => word.toLowerCase()));
  const first = tokens(left);
  const second = tokens(right);
  if (!first.size || !second.size) return 0;
  let intersection = 0;
  for (const token of first) if (second.has(token)) intersection += 1;
  return intersection / (first.size + second.size - intersection);
}

function normalizeEventWords(body: string): string[] {
  return wordTokens(body).map((word) => word.toLowerCase());
}

function deduplicate(
  candidate: VerifiedCandidate,
  prior: VerifiedCandidate[],
): { duplicate: VerifiedCandidate | null; reason: string | null } {
  const normalizedUrl = normalizeUrl(candidate.article.originalUrl);
  for (const existing of prior) {
    if (normalizeUrl(existing.article.originalUrl) === normalizedUrl) {
      return { duplicate: existing, reason: "Same normalized original URL." };
    }
    if (existing.article.bodyHash === candidate.article.bodyHash) {
      return { duplicate: existing, reason: "Identical normalized full-text body SHA-256." };
    }
    const similarity = shingleJaccard(existing.body, candidate.body);
    if (similarity >= 0.85) {
      return { duplicate: existing, reason: `Near-duplicate body; 5-word shingle Jaccard ${similarity.toFixed(3)} ≥ 0.850 with no meaningful independent addition.` };
    }
  }
  return { duplicate: null, reason: null };
}

/** The difficulty tiers, ordered from easiest to hardest. */
const DIFFICULTY_TIERS: ReaderDifficulty[] = ["Easy", "Intermediate", "Advanced"];

/** The difficulty an article's measured reading grade actually reports. */
export function measuredDifficulty(fkgl: number | null): ReaderDifficulty | null {
  if (fkgl === null) return null;
  return fkgl <= 8 ? "Easy" : fkgl <= 12 ? "Intermediate" : "Advanced";
}

/**
 * How far an article's measured difficulty sits from the requested tier.
 *
 * One shared rule for candidate selection, result ranking and final Issue
 * fulfilment: the requested tier is preferred, an adjacent tier is permitted
 * only as a fallback, and a two-tier difference is never allowed. The measured
 * tier is always reported as itself, so an Advanced article is never relabelled
 * Intermediate to satisfy a target.
 */
export function difficultyTierDistance(
  fkgl: number | null,
  target: ReaderDifficulty,
): number | null {
  const measured = measuredDifficulty(fkgl);
  if (!measured) return null;
  const measuredIndex = DIFFICULTY_TIERS.indexOf(measured);
  const targetIndex = DIFFICULTY_TIERS.indexOf(target);
  if (measuredIndex < 0 || targetIndex < 0) return null;
  return Math.abs(measuredIndex - targetIndex);
}

/** Whether an article's measured difficulty may be delivered for a target. */
export function isDeliverableDifficulty(
  fkgl: number | null,
  target: ReaderDifficulty,
): boolean {
  const distance = difficultyTierDistance(fkgl, target);
  return distance !== null && distance <= MAX_DIFFICULTY_DISTANCE;
}

/** The largest difference between the requested and delivered tier. */
export const MAX_DIFFICULTY_DISTANCE = 1;

function satisfiesDifficulty(article: EditorialArticle, target: ReaderDifficulty): boolean {
  return isDeliverableDifficulty(article.fkgl, target);
}

function bestSelection(
  pool: EditorialArticle[],
  maxCount: number,
  budgetMinutes: number,
  lowerMinutes: number,
): EditorialArticle[] {
  if (maxCount <= 0) return [];
  const budgetTenths = Math.floor(budgetMinutes * 10 + 1e-8);
  const lowerTenths = Math.ceil(lowerMinutes * 10 - 1e-8);
  let states = new Map<string, EditorialArticle[]>([["0:0", []]]);
  for (const article of pool) {
    const minutes = Math.round(article.readingMinutes * 10);
    const previous = [...states.entries()];
    for (const [key, selected] of previous) {
      if (selected.length >= maxCount) continue;
      const total = Number(key.split(":")[1]) + minutes;
      if (total > budgetTenths) continue;
      const next = [...selected, article];
      const nextKey = `${next.length}:${total}`;
      if (!states.has(nextKey)) states.set(nextKey, next);
    }
  }
  const options = [...states.entries()].map(([key, articles]) => ({
    count: articles.length,
    tenths: Number(key.split(":")[1]),
    articles,
  }));
  const complete = options
    .filter((item) => item.count === maxCount && item.tenths >= lowerTenths)
    .sort((a, b) => a.tenths - b.tenths)[0];
  if (complete) return complete.articles;
  return options
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      const aDistance = Math.abs(a.tenths - lowerTenths);
      const bDistance = Math.abs(b.tenths - lowerTenths);
      return aDistance - bDistance || b.tenths - a.tenths;
    })[0]?.articles ?? [];
}

function editorialEvidence(body: string, maximum: number): string {
  const text = normalizeWhitespace(body);
  if (text.length <= maximum) return text;
  const sectionSize = Math.floor((maximum - 48) / 3);
  const middleStart = Math.max(0, Math.floor((text.length - sectionSize) / 2));
  const excerpts = [
    `[beginning] ${text.slice(0, sectionSize)}`,
    `[middle] ${text.slice(middleStart, middleStart + sectionSize)}`,
    `[end] ${text.slice(-sectionSize)}`,
  ];
  return excerpts.join(" ").slice(0, maximum);
}

function editorialScore(decision: SemanticEditorialRecord): number {
  const rating = { low: 0, medium: 1, high: 2 } as const;
  const overlap = { none: 0, some: 2, substantial: 5 } as const;
  const contribution = decision.contributionType === "perspective" ? 1 : 0;
  return rating[decision.relevance] + rating[decision.editorialValue] * 2 +
    rating[decision.analysisDepth] + rating[decision.novelty] + contribution - overlap[decision.overlap];
}

function buildQueries(topics: string[]): string[] {
  const clean = [...new Set(topics.map((topic) => normalizeWhitespace(topic)).filter(Boolean))];
  return queryVariants(clean);
}

/**
 * A publisher feed, with the topics it can serve.
 *
 * Only feeds that have been fetched and shown to yield verifiable full-text
 * articles are listed, so discovery spends its budget on sources that can
 * actually deliver reading rather than on guesses.
 */
export interface PublisherFeed {
  name: string;
  url: string;
  /** Topics this feed's coverage matches. */
  topics: string[];
}

export const PUBLISHER_FEEDS: PublisherFeed[] = [
  {
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    topics: ["Politics", "Geopolitics", "Economy"],
  },
  {
    name: "The Guardian World",
    url: "https://www.theguardian.com/world/rss",
    topics: ["Politics", "Geopolitics", "Economy"],
  },
  {
    name: "The Guardian Business",
    url: "https://www.theguardian.com/uk/business/rss",
    topics: ["Economy", "Finance", "Business"],
  },
  {
    name: "NPR News",
    url: "https://feeds.npr.org/1001/rss.xml",
    topics: ["Politics", "Economy", "Geopolitics"],
  },
  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    topics: ["Geopolitics", "Politics", "Economy"],
  },
];

/** How many feed items one source may contribute to a single collection. */
const MAX_FEED_ITEMS = 12;

/** A whole-feed deadline, so one slow publisher cannot hold up a collection. */
const FEED_TIMEOUT_MS = 10_000;

function feedTopicsFor(feed: PublisherFeed, requested: string[]): string[] {
  const shared = feed.topics.filter((topic) =>
    requested.some(
      (candidate) =>
        normalizeWhitespace(candidate).toLowerCase() ===
        normalizeWhitespace(topic).toLowerCase(),
    ),
  );
  // A feed whose own section does not name a requested topic still carries
  // politics, economics and world news, so it is kept rather than dropped: the
  // pipeline re-checks every article's topic before it can be delivered.
  return shared.length > 0 ? shared : feed.topics;
}

/** Read one publisher feed with the XML parser already used for article pages. */
export function parsePublisherFeed(xml: string, feed: PublisherFeed): SearchCandidate[] {
  let document: Document;
  try {
    document = new JSDOM(xml, { contentType: "text/xml" }).window.document;
  } catch {
    return [];
  }
  const entries = [
    ...document.querySelectorAll("item"),
    ...document.querySelectorAll("entry"),
  ].slice(0, MAX_FEED_ITEMS);
  const candidates: SearchCandidate[] = [];
  for (const entry of entries) {
    const title = normalizeWhitespace(entry.querySelector("title")?.textContent ?? "");
    // Atom states the target in an href, RSS in the element text.
    const linkElement = entry.querySelector("link");
    const rawLink = normalizeWhitespace(
      linkElement?.getAttribute("href") ?? linkElement?.textContent ?? "",
    );
    if (!title || !rawLink) continue;
    candidates.push({
      url: rawLink,
      title,
      // Feeds commonly wrap the summary in HTML, so only its text is kept.
      snippet: normalizeWhitespace(
        (entry.querySelector("description, summary")?.textContent ?? "").replace(/<[^>]*>/gu, " "),
      ),
      publication: feed.name,
    });
  }
  return candidates;
}

/**
 * Discover candidates from official publisher feeds.
 *
 * Each feed is bounded and independent: a feed that is slow, blocked or
 * malformed contributes nothing and the others still return their articles.
 */
export async function discoverFromPublisherFeeds(
  topics: string[],
  signal?: AbortSignal,
): Promise<{ candidates: SearchCandidate[]; decisions: string[] }> {
  // Unit tests inject `feedDiscovery`. Leaving the live network out of a test run
  // keeps a suite deterministic and stops every test from fetching five feeds.
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return {
      candidates: [],
      decisions: [
        "Publisher feeds are not read in this context; the collection pipeline supplies them.",
      ],
    };
  }
  const feeds = PUBLISHER_FEEDS.filter((feed) => feedTopicsFor(feed, topics).length > 0);
  const decisions: string[] = [];
  const collected: SearchCandidate[] = [];

  await mapLimit(feeds, 4, async (feed) => {
    if (signal?.aborted) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    const relayAbort = () => controller.abort();
    signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const response = await fetch(feed.url, {
        headers: {
          "user-agent": SEARCH_USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok) {
        decisions.push(`Publisher feed ${feed.name} returned HTTP ${response.status}.`);
        return;
      }
      const xml = await readBounded(response, MAX_SEARCH_BYTES);
      const candidates = parsePublisherFeed(xml, feed);
      if (candidates.length === 0) {
        decisions.push(`Publisher feed ${feed.name} exposed no readable items.`);
        return;
      }
      collected.push(...candidates);
      decisions.push(
        `Publisher feed ${feed.name} contributed ${candidates.length} candidate article(s).`,
      );
    } catch (error) {
      decisions.push(
        `Publisher feed ${feed.name} could not be read: ${error instanceof Error ? error.message : "unknown feed error"}.`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relayAbort);
    }
  });

  return { candidates: collected, decisions };
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function validatePreferences(preferences: EditorialPreferences): void {
  if (
    !Array.isArray(preferences.topics) || preferences.topics.length === 0 ||
    !Number.isInteger(preferences.dailyArticleCount) || preferences.dailyArticleCount < 1 ||
    !Number.isFinite(preferences.readingBudgetMinutes) || preferences.readingBudgetMinutes <= 0
  ) {
    throw new Error("Saved Reader preferences are not valid for article discovery.");
  }
}

/**
 * Search dynamically from preferences, verify source bodies through the injected safe-fetch adapter,
 * deduplicate articles, and select only a set satisfying the saved issue constraints.
 */
export async function collectEditorial(
  preferences: EditorialPreferences,
  options: EditorialOptions,
): Promise<EditorialCollection> {
  validatePreferences(preferences);
  if (typeof options.fetchArticle !== "function") throw new Error("An SSRF-safe article fetcher is required.");
  const search = options.search ?? searchDuckDuckGo;
  const feedDiscovery = options.feedDiscovery ?? discoverFromPublisherFeeds;
  const queries = buildQueries(preferences.topics);
  const trace: EditorialTrace = { queries: [], candidates: [], decisions: [] };
  const discovered = new Map<string, SearchCandidate>();
  let successfulSearchResponses = 0;
  let successfulFeedResponses = 0;

  /**
   * Merge one discovery source into the shared candidate set.
   *
   * Publisher feeds and search results feed the same map, so an article offered
   * by both is verified once and carries the publisher's own name.
   */
  const mergeCandidates = (
    results: SearchCandidate[],
    duplicateReason: string,
    origin: "feed" | "search",
  ) => {
    for (const result of results) {
      const normalized = normalizeUrl(result.url);
      if (!normalized) {
        trace.candidates.push({ url: result.url, publication: result.publication ?? "", outcome: "REJECTED", reason: "Search result did not resolve to a public HTTPS URL.", statusCode: null, articleId: null });
        continue;
      }
      const existing = discovered.get(normalized);
      if (existing) {
        // A publisher feed states the publication name itself, so it is kept
        // when search offered the same URL under a weaker attribution.
        if (origin === "feed" && result.publication && !existing.publication) {
          discovered.set(normalized, { ...existing, publication: result.publication });
        }
        trace.candidates.push({ url: normalized, publication: result.publication ?? "", outcome: "DUPLICATE", reason: duplicateReason, statusCode: null, articleId: null });
        continue;
      }
      discovered.set(normalized, { ...result, url: normalized });
    }
  };

  // Official publisher feeds first: they name their own articles and are the
  // sources shown to produce verifiable full-text reading.
  try {
    const feeds = await feedDiscovery(preferences.topics, options.signal);
    trace.decisions.push(...feeds.decisions);
    if (feeds.candidates.length > 0) successfulFeedResponses = 1;
    mergeCandidates(feeds.candidates, "A publisher feed and the search results named the same article.", "feed");
  } catch (error) {
    trace.decisions.push(
      `Publisher feed discovery failed: ${error instanceof Error ? error.message : "unknown feed error"}.`,
    );
  }

  for (const query of queries) {
    if (options.signal?.aborted) break;
    trace.queries.push(query);
    try {
      const results = await search(query, options.signal);
      successfulSearchResponses += 1;
      mergeCandidates(results, "Search results repeated the same normalized URL.", "search");
    } catch (error) {
      trace.decisions.push(`Search failed for query “${query}”: ${error instanceof Error ? error.message : "unknown search error"}`);
    }
  }

  if (
    trace.queries.length > 0 &&
    successfulSearchResponses === 0 &&
    successfulFeedResponses === 0 &&
    !options.signal?.aborted
  ) {
    throw new EditorialCollectionError(
      "reader_discovery_unavailable",
      "All preference-based discovery sources failed before returning results.",
    );
  }

  const candidates = [...discovered.values()].slice(0, Math.max(1, Math.min(options.maxArticleChecks ?? 36, 60)));
  trace.decisions.push(`Generated ${trace.queries.length} preference-based search queries and read ${PUBLISHER_FEEDS.length} official publisher feeds, discovering ${discovered.size} unique article URLs; no article URL list was supplied as input.`);
  let transientHttpFailures = 0;
  let sourceFetchFailures = 0;
  let nonTransientResponses = 0;
  const checked = await mapLimit(candidates, 3, async (source) => {
    if (options.signal?.aborted) {
      const summary = makeCandidateSummary(source, "UNAVAILABLE", "Collection was cancelled before source verification.", null);
      return { article: null, summary, body: "", reason: "Collection cancelled.", trace: { url: source.url, publication: summary.originalPublication, outcome: "REJECTED" as const, reason: "Collection cancelled.", statusCode: null, articleId: summary.id } };
    }
    try {
      const page = await options.fetchArticle(source.url, options.signal);
      if (isTransientSourceStatus(page.statusCode)) transientHttpFailures += 1;
      else nonTransientResponses += 1;
      return evaluateVerified(source, page, preferences);
    } catch (error) {
      sourceFetchFailures += 1;
      const message = error instanceof Error ? error.message : "The article source could not be reached.";
      const unavailable = makeCandidateSummary(source, "UNAVAILABLE", message, null);
      return {
        article: null,
        summary: unavailable,
        body: "",
        reason: message,
        trace: { url: source.url, publication: unavailable.originalPublication, outcome: "REJECTED" as const, reason: message.slice(0, 500), statusCode: null, articleId: unavailable.id },
      };
    }
  });

  if (
    candidates.length > 0 &&
    transientHttpFailures + sourceFetchFailures === candidates.length &&
    nonTransientResponses === 0 &&
    !options.signal?.aborted
  ) {
    throw new EditorialCollectionError(
      "reader_source_unavailable",
      "All discovered source requests failed transiently before returning usable content.",
    );
  }

  const verified: VerifiedCandidate[] = [];
  const allSummaries: EditorialArticle[] = [];
  const notAfter = options.publishedNotAfter
    ? Date.parse(options.publishedNotAfter)
    : NaN;
  for (const candidate of checked) {
    if (!candidate.article) {
      if (candidate.summary.contentStatus !== "FULL_TEXT") allSummaries.push(candidate.summary);
      trace.candidates.push(candidate.trace);
      continue;
    }
    if (Number.isFinite(notAfter)) {
      const publishedAt = candidate.article.publishedAt
        ? Date.parse(candidate.article.publishedAt)
        : NaN;
      const stated = candidate.article.publishedAt ?? null;
      if (Number.isFinite(publishedAt) && publishedAt > notAfter) {
        // The publisher states this article appeared after the day being
        // recovered, so it cannot be that day's reading.
        trace.candidates.push({
          ...candidate.trace,
          outcome: "REJECTED",
          reason: `The publisher states this article was published ${stated}, after the issue date being recovered.`,
        });
        continue;
      }
      if (!stated) {
        // No verifiable publication date: record the gap rather than silently
        // treating a possibly newer article as the named day's reading.
        trace.decisions.push(
          `Publication date could not be verified for ${candidate.article.originalUrl}; it was not accepted for a dated recovery.`,
        );
        trace.candidates.push({
          ...candidate.trace,
          outcome: "REJECTED",
          reason:
            "The publisher did not state a verifiable publication date, so the article cannot be assigned to an earlier issue date.",
        });
        continue;
      }
    }
    const entry: VerifiedCandidate = {
      article: candidate.article,
      body: candidate.body,
      source: candidates.find((item) => normalizeUrl(item.url) === normalizeUrl(candidate.article!.originalUrl))!,
      topicalEvidence: candidate.topicalEvidence ?? [],
      trace: candidate.trace,
    };
    const duplicate = deduplicate(entry, verified);
    if (duplicate.duplicate) {
      trace.candidates.push({
        ...candidate.trace,
        outcome: "DUPLICATE",
        reason: duplicate.reason ?? "Duplicate article.",
      });
      continue;
    }
    verified.push(entry);
    trace.candidates.push(candidate.trace);
  }

  if (verified.length > 0) {
    const semanticInput = {
      contractVersion: "reader-editorial-curation.v1" as const,
      preferences: {
        topics: preferences.topics,
        dailyArticleCount: preferences.dailyArticleCount,
        difficulty: preferences.difficulty,
        readingBudgetMinutes: preferences.readingBudgetMinutes,
      },
      alreadyDelivered: options.alreadyDelivered?.slice(0, MAX_SEMANTIC_EXISTING_ARTICLES) ?? [],
      candidates: verified.map((item) => ({
        id: item.article.id,
        title: item.article.title,
        publication: item.article.originalPublication,
        evidence: editorialEvidence(item.body, MAX_SEMANTIC_ARTICLE_EVIDENCE_CHARS),
        topicalEvidence: item.topicalEvidence,
        wordCount: item.article.wordCount,
        readingMinutes: item.article.readingMinutes,
        fkgl: item.article.fkgl,
        difficulty: item.article.difficulty,
        provenance: item.article.provenance!,
      })),
    };
    try {
      const review = await reviewSemanticCandidates(semanticInput, options.semanticClient);
      trace.semantic = review.runtime;
      const reviewedIds = new Set(review.runtime.candidateIds);
      const decisions = new Map(review.decisions.map((item) => [item.candidateId, item.editorial]));
      trace.decisions.push(
        `Semantic review ${review.runtime.contractVersion} succeeded with ${review.runtime.requestCount} request(s), provider ${review.runtime.provider}/${review.runtime.model}, input sha256 ${review.runtime.inputSha256}.`,
      );
      for (const item of verified) {
        if (!reviewedIds.has(item.article.id)) {
          item.trace.outcome = "REJECTED";
          item.trace.reason = "Not submitted for semantic review because the bounded request capacity was reached.";
          continue;
        }
        const editorial = decisions.get(item.article.id);
        if (!editorial) {
          // The versioned response validator guarantees a complete ID set. Keep this
          // guard so future changes cannot turn a partial decision into eligibility.
          item.trace.outcome = "REJECTED";
          item.trace.reason = "Semantic review returned no validated decision for this candidate.";
          continue;
        }
        item.article = {
          ...item.article,
          topics: editorial.matchedTopics,
          editorial,
        };
        item.trace.outcome = editorial.decision === "APPROVE" ? "ACCEPTED" : "REJECTED";
        item.trace.reason = `${item.trace.reason} Semantic ${editorial.decision.toLowerCase()}: topic fit ${editorial.topicFit.toLowerCase()}, value ${editorial.editorialValue}, depth ${editorial.analysisDepth}, novelty ${editorial.novelty}, overlap ${editorial.overlap}, contribution ${editorial.contributionType}. ${editorial.rationale}`;
        trace.decisions.push(`${item.article.id}: ${item.trace.reason}`);
      }
    } catch (error) {
      if (!(error instanceof SemanticReviewError)) throw error;
      trace.semantic = error.runtime;
      trace.decisions.push(`Semantic review failed (${error.runtime.status}): ${error.runtime.reason ?? "unknown semantic failure"}`);
      for (const item of verified) {
        item.trace.outcome = "REJECTED";
        item.trace.reason = `Semantic review failed (${error.runtime.status}); this candidate was not eligible for delivery.`;
      }
      throw new EditorialCollectionError(
        "reader_semantic_unavailable",
        error.message,
        error.retryable,
        trace,
      );
    }
  }

  const approved = verified
    .filter((item) => item.article.editorial?.decision === "APPROVE")
    .sort((left, right) =>
      editorialScore(right.article.editorial!) - editorialScore(left.article.editorial!) ||
      left.article.readingMinutes - right.article.readingMinutes,
    );
  // The requested tier is preferred; an adjacent tier is carried as a fallback
  // so a short day still delivers reading. Anything two tiers away is refused.
  const eligible = approved
    .map((item) => item.article)
    .filter((article) => satisfiesDifficulty(article, preferences.difficulty) && article.topics.length > 0)
    // Exact matches first, then adjacent-tier fallbacks.
    .sort(
      (left, right) =>
        (difficultyTierDistance(left.fkgl, preferences.difficulty) ?? 9) -
        (difficultyTierDistance(right.fkgl, preferences.difficulty) ?? 9),
    );
  for (const item of approved) {
    if (satisfiesDifficulty(item.article, preferences.difficulty)) {
      const distance = difficultyTierDistance(item.article.fkgl, preferences.difficulty);
      if (distance === MAX_DIFFICULTY_DISTANCE) {
        item.trace.reason = `${item.trace.reason} Delivered as an adjacent-difficulty fallback: measured difficulty is ${item.article.difficulty}, requested ${preferences.difficulty}.`;
      }
      continue;
    }
    item.trace.outcome = "REJECTED";
    item.trace.reason = `Semantic approval did not override measured difficulty ${item.article.difficulty}; saved preference is ${preferences.difficulty} and only one adjacent tier may be used as a fallback.`;
  }
  const deliveredContext = options.alreadyDelivered?.slice(0, MAX_SEMANTIC_EXISTING_ARTICLES) ?? [];
  const existingCount = deliveredContext.length;
  const existingMinutes = deliveredContext.reduce((sum, article) => sum + article.readingMinutes, 0);
  const remainingCount = Math.max(0, preferences.dailyArticleCount - existingCount);
  const remainingBudget = Math.max(0, preferences.readingBudgetMinutes - existingMinutes);
  const requiredAdditionalMinutes = Math.max(0, preferences.readingBudgetMinutes * 0.7 - existingMinutes);
  const selected = bestSelection(
    eligible.slice(0, MAX_SHINGLE_CANDIDATES),
    remainingCount,
    remainingBudget,
    requiredAdditionalMinutes,
  );
  const selectedIds = new Set(selected.map((article) => article.id));
  for (const item of eligible) {
    if (!selectedIds.has(item.id)) {
      const candidate = verified.find((entry) => entry.article.id === item.id);
      if (candidate) {
        candidate.trace.reason = "Semantic approval was not selected under the exact-count and reading-time limits.";
        trace.decisions.push(`${item.id} was approved but not selected under the exact-count and reading-time limits.`);
      }
    }
  }
  const readingMinutes = existingMinutes + selected.reduce((sum, article) => sum + article.readingMinutes, 0);
  const actualCount = existingCount + selected.length;
  const target = preferences.readingBudgetMinutes;
  const lower = target * 0.7;
  const combinedArticles = [
    ...deliveredContext.map((article) => ({ topics: article.topics, difficulty: article.difficulty })),
    ...selected.map((article) => ({ topics: article.topics, difficulty: article.difficulty })),
  ];
  const allTopicsMatch = combinedArticles.every((article) =>
    preferences.topics.some((topic) => article.topics.some((matched) => matched.toLowerCase() === topic.toLowerCase())),
  );
  const allDifficultyMatch = combinedArticles.every((article) => article.difficulty === preferences.difficulty);
  const complete =
    actualCount === preferences.dailyArticleCount &&
    readingMinutes >= lower - 1e-9 &&
    readingMinutes <= target + 1e-9 &&
    allTopicsMatch &&
    allDifficultyMatch;
  const status: EditorialCollection["status"] = complete
    ? "COMPLETE"
    : actualCount > 0
      ? "PARTIAL"
      : "NOT_DELIVERED";
  const unmetConstraints: string[] = [];
  if (actualCount < preferences.dailyArticleCount) {
    unmetConstraints.push(`Article count: ${actualCount}/${preferences.dailyArticleCount} verified full-text articles.`);
  }
  if (actualCount > 0 && readingMinutes < lower - 1e-9) {
    unmetConstraints.push(`Reading time: ${readingMinutes.toFixed(1)} minutes is below the ${lower.toFixed(1)} minute 70% target.`);
  }
  if (readingMinutes > target + 1e-9) {
    unmetConstraints.push(`Reading time: ${readingMinutes.toFixed(1)} minutes exceeds the ${target.toFixed(1)} minute hard limit.`);
  }
  if (!allTopicsMatch) unmetConstraints.push("One or more delivered articles do not match a configured topic.");
  if (!allDifficultyMatch) unmetConstraints.push("One or more delivered articles do not match the configured difficulty.");
  if (actualCount < preferences.dailyArticleCount) {
    unmetConstraints.push("Suitable supply was insufficient; unsuitable, unverified, or semantically rejected candidates were not used to fill the issue.");
  }
  if (eligible.length === 0 && actualCount < preferences.dailyArticleCount) {
    unmetConstraints.push(`No semantic-approved full-text articles matched the configured ${preferences.difficulty} difficulty and selected topics.`);
  }
  const actualTopics = [...new Set(combinedArticles.flatMap((article) => article.topics))];
  const difficultySet = new Set(combinedArticles.map((article) => article.difficulty));
  const actualDifficulty = difficultySet.size === 1 ? combinedArticles[0]?.difficulty ?? null : null;
  trace.decisions.push(
    `${status}: delivered ${actualCount}/${preferences.dailyArticleCount} verified full-text articles; estimated ${readingMinutes.toFixed(1)}/${target} minutes; topics ${actualTopics.join(", ") || "none"}; difficulty ${actualDifficulty ?? "mixed/none"}.`,
  );
  return {
    status,
    articles: selected,
    candidates: allSummaries,
    actual: { count: actualCount, topics: actualTopics, difficulty: actualDifficulty, readingMinutes },
    unmetConstraints,
    trace,
  };
}

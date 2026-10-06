import { createHash } from "node:crypto";
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
  provenance?: {
    publisherIdentity: string;
    publisherIdentitySources: Array<
      | "structured_publisher"
      | "citation_publication_title"
      | "article_publisher"
      | "open_graph_site_name"
    >;
    canonicalRelationship: "original_url" | "accessible_url";
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
  /** Required so article URLs always pass through the service's SSRF-safe, pinned-IP adapter. */
  fetchArticle: EditorialArticleFetcher;
  now?: () => Date;
  maxArticleChecks?: number;
  signal?: AbortSignal;
  semanticClient?: JsonCompletionClient;
  alreadyDelivered?: SemanticExistingArticleInput[];
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

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "User-Agent": "SayItReader/1.0 (local English reading workspace)",
        },
        redirect: "follow",
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}.`);
    const html = await readBounded(response, MAX_SEARCH_BYTES);
    const document = new JSDOM(html).window.document;
    const candidates: SearchCandidate[] = [];
    for (const result of document.querySelectorAll<HTMLElement>(".result")) {
      const anchor = result.querySelector<HTMLAnchorElement>("a.result__a");
      const title = normalizeWhitespace(anchor?.textContent ?? "");
      const href = anchor?.getAttribute("href");
      const snippet = normalizeWhitespace(
        result.querySelector(".result__snippet")?.textContent ?? "",
      );
      if (!href || !title) continue;
      let resolved: string;
      try {
        const link = new URL(href, "https://html.duckduckgo.com");
        const wrapped = link.searchParams.get("uddg");
        resolved = wrapped ? new URL(wrapped).toString() : link.toString();
      } catch {
        continue;
      }
      const normalized = normalizeUrl(resolved);
      if (!normalized) continue;
      candidates.push({
        url: normalized,
        title,
        snippet,
        // Search result breadcrumbs may contain path text or a display alias. Keep the
        // discovered host as the original-source attribution and track redirects separately.
        publication: hostOf(normalized) ? displayPublication(hostOf(normalized)!) : undefined,
      });
      if (candidates.length >= MAX_RESULTS_PER_QUERY) break;
    }
    return candidates;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
  }
}

function extractStructuredArticle(document: Document): {
  publisher: string | null;
  articleBody: string | null;
  headline: string | null;
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
  return {
    publisher: textValue(article?.publisher),
    articleBody: textValue(article?.articleBody),
    headline: textValue(article?.headline),
    licenses: licenseValues,
    hasArticleType: articles.length > 0,
  };
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

function englishConfidence(body: string): boolean {
  const tokens = wordTokens(body);
  if (tokens.length < 200) return false;
  const ascii = tokens.filter((token) => /^[a-z]+(?:['’][a-z]+)*$/iu.test(token)).length;
  const markers = tokens.filter((token) => ENGLISH_MARKERS.has(token.toLowerCase())).length;
  return ascii / tokens.length >= 0.85 && markers >= 5 && markers / tokens.length >= 0.02;
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
    .filter((paragraph) => paragraph.length >= 20);
}

interface SourceArticleParagraphs {
  paragraphs: string[];
  verifiedBodyBoundary: boolean;
  readabilityReconstructionAllowed: boolean;
}

function hasVerifiedStandaloneArticleRoot(
  document: Document,
  title: string,
  hasStructuredArticleType: boolean,
  declaredTitles: string[],
): boolean {
  const roots = [...document.querySelectorAll("article")];
  if (roots.length !== 1) return false;
  const openGraphType = normalizeWhitespace(
    document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content ?? "",
  ).toLowerCase();
  if (openGraphType !== "article" && !hasStructuredArticleType) return false;
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  const headings = [...roots[0]!.querySelectorAll("h1")]
    .map((heading) => normalizeWhitespace(heading.textContent ?? "").toLowerCase())
    .filter(Boolean);
  return headings.length === 1 && headings[0] === normalizedTitle && declaredTitles.length > 0 &&
    declaredTitles.every((declared) => declared.toLowerCase() === normalizedTitle);
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
        : [...document.querySelectorAll("main, [role='main']")];
  const paragraphSets = roots.map((root) => [...root.querySelectorAll("p")]
    .map((paragraph) => normalizeWhitespace(paragraph.textContent ?? ""))
    .filter((paragraph) => paragraph.length >= 20));
  const paragraphs = paragraphSets
    .sort((left, right) => right.join(" ").length - left.join(" ").length)[0] ?? [];
  const structuredBodyMatchesSource = Boolean(
    structuredBody && normalizeWhitespace(paragraphs.join(" ")) === normalizeWhitespace(structuredBody),
  );
  const publisherBodyIsSource = articleBodyRoots.length === 0 && publisherBodyRoots.length > 0;
  return {
    paragraphs,
    verifiedBodyBoundary:
      articleBodyRoots.length > 0 || publisherBodyRoots.length > 0 || structuredBodyMatchesSource || verifiedStandaloneArticleRoot,
    readabilityReconstructionAllowed:
      articleBodyRoots.length > 0 || structuredBodyMatchesSource || (verifiedStandaloneArticleRoot && !publisherBodyIsSource),
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
  const accessibleUrl = normalizeUrl(page.finalUrl);
  if (!sourceUrl || !accessibleUrl) {
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
    : canonical === accessibleUrl
      ? "accessible_url" as const
      : null;
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
  if (!parsedArticle) {
    const summary = makeCandidateSummary(source, "SUMMARY", "The page did not expose a readable article body.", page.statusCode);
    return { article: null, body: "", summary, reason: "The page did not expose a readable article body." };
  }
  if (!parsedArticle.content?.trim()) {
    const summary = makeCandidateSummary(source, "SUMMARY", "The page did not expose readable article paragraphs.", page.statusCode);
    return { article: null, body: "", summary, reason: "The page did not expose readable article paragraphs." };
  }
  const title = normalizeWhitespace(parsedArticle.title || structured.headline || source.title);
  const declaredTitles = titleMetadata(document, structured.headline);
  const standaloneArticleVerified = hasVerifiedStandaloneArticleRoot(
    document,
    title,
    structured.hasArticleType,
    declaredTitles,
  );
  if (isCategoryOrListingPage(document, parsedArticle.content, page.finalUrl, title)) {
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
  let paragraphs = paragraphsFromReadability(parsedArticle.content);
  const sourceBody = sourceArticleParagraphs(
    document,
    structured.articleBody,
    standaloneArticleVerified,
  );
  const sourceParagraphs = sourceBody.paragraphs;
  if (!sourceBody.verifiedBodyBoundary || sourceParagraphs.length < 3) {
    const reason = "The source did not expose a verified, continuous standalone article body; extracted text was too short or incomplete.";
    const summary = makeCandidateSummary(source, "SUMMARY", reason, page.statusCode);
    return { article: null, body: "", summary, reason };
  }
  let omittedParagraphCount = missingSourceParagraphs(sourceParagraphs, paragraphs);
  let recoveredParagraphCount = 0;
  const readabilityParagraphsBelongToSourceBody = missingSourceParagraphs(paragraphs, sourceParagraphs) === 0;
  if (
    omittedParagraphCount > 0 &&
    sourceParagraphs.length > 0 &&
    sourceBody.verifiedBodyBoundary &&
    sourceBody.readabilityReconstructionAllowed &&
    omittedParagraphCount / sourceParagraphs.length <= 0.1 &&
    readabilityParagraphsBelongToSourceBody
  ) {
    // Readability can discard real paragraphs because of publisher CSS classes such as
    // "comment" even when article-level metadata and one matching article root establish
    // the page's source body boundary.
    // Reconstruct from that semantic source sequence, then keep the exact completeness
    // check: every meaningful source paragraph must still appear in the delivered body.
    const reconstructedParagraphs = [...sourceParagraphs];
    recoveredParagraphCount = omittedParagraphCount;
    paragraphs = reconstructedParagraphs;
    omittedParagraphCount = missingSourceParagraphs(sourceParagraphs, paragraphs);
  }
  if (!readabilityParagraphsBelongToSourceBody) {
    const reason = "Extracted paragraphs are incomplete or include material outside the verified article body.";
    const summary = makeCandidateSummary(source, "SUMMARY", reason, page.statusCode);
    return { article: null, body: "", summary, reason };
  }
  const body = paragraphs.join("\n\n");
  if (omittedParagraphCount > 0) {
    const reason = `Readability omitted ${omittedParagraphCount} of ${sourceParagraphs.length} meaningful paragraphs from the semantic article body; the extracted text is incomplete.`;
    const summary = makeCandidateSummary(source, "SUMMARY", reason, page.statusCode);
    return { article: null, body, summary, reason };
  }
  const failedPage = pageFailure(document, body, title);
  if (failedPage) {
    const summary = makeCandidateSummary(source, /subscriber|sign-in|paywall/iu.test(failedPage) ? "EXTERNAL_ONLY" : "UNAVAILABLE", failedPage, page.statusCode);
    return { article: null, body, summary, reason: failedPage };
  }
  const reading = readingMetrics(body);
  if (reading.wordCount < 200 || paragraphs.length < 3) {
    const summary = makeCandidateSummary(source, "SUMMARY", "The accessible text is too short or lacks continuous article paragraphs.", page.statusCode);
    return { article: null, body, summary, reason: "The candidate is a teaser or summary, not a sufficiently complete article." };
  }
  if (!englishConfidence(body)) {
    const summary = makeCandidateSummary(source, "EXTERNAL_ONLY", "The extracted body could not be verified as English.", page.statusCode);
    return { article: null, body, summary, reason: "The extracted text did not meet the English-language check." };
  }
  const structuredBody = structured.articleBody;
  if (structuredBody) {
    const structuredWords = whitespaceWordCount(structuredBody);
    if (structuredWords >= 200 && reading.wordCount / structuredWords < 0.7) {
      const summary = makeCandidateSummary(source, "SUMMARY", "The extracted article is substantially shorter than the structured full body.", page.statusCode);
      return { article: null, body, summary, reason: "Extracted body is below 70% of the structured NewsArticle.articleBody." };
    }
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
    topicalEvidence: matched.evidence,
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
  if (!originalUrl || !reference.topics.length) {
    return { article: null, reason: "Stored article reference is incomplete or invalid." };
  }
  try {
    const page = await fetchArticle(originalUrl, signal);
    const source: SearchCandidate = {
      url: originalUrl,
      title: reference.title,
      snippet: "",
      publication: reference.originalPublication,
    };
    const extracted = extractPage(source, page);
    if (!extracted.article) return { article: null, reason: extracted.reason };
    if (titleSimilarity(reference.title, extracted.article.title) < 0.35) {
      return { article: null, reason: "The current page title no longer matches the archived article." };
    }
    const matched = topicEvidence(reference.topics, extracted.article.title, extracted.body);
    if (matched.topics.length === 0) {
      return { article: null, reason: "The current page no longer matches the archived article topics." };
    }
    return {
      article: {
        ...extracted.article,
        id: reference.id,
        title: reference.title,
        originalPublication: reference.originalPublication,
        originalUrl,
        accessiblePublication: extracted.article.accessiblePublication,
        accessibleUrl: extracted.article.accessibleUrl,
        topics: matched.topics,
      },
      reason: "The archived article was re-fetched and its full text was revalidated.",
    };
  } catch (error) {
    return {
      article: null,
      reason: error instanceof Error ? error.message : "The archived article could not be revalidated.",
    };
  }
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

function satisfiesDifficulty(article: EditorialArticle, target: ReaderDifficulty): boolean {
  return article.difficulty === target;
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
  const queries = buildQueries(preferences.topics);
  const trace: EditorialTrace = { queries: [], candidates: [], decisions: [] };
  const discovered = new Map<string, SearchCandidate>();
  let successfulSearchResponses = 0;

  for (const query of queries) {
    if (options.signal?.aborted) break;
    trace.queries.push(query);
    try {
      const results = await search(query, options.signal);
      successfulSearchResponses += 1;
      for (const result of results) {
        const normalized = normalizeUrl(result.url);
        if (!normalized) {
          trace.candidates.push({ url: result.url, publication: result.publication ?? "", outcome: "REJECTED", reason: "Search result did not resolve to a public HTTPS URL.", statusCode: null, articleId: null });
          continue;
        }
        if (discovered.has(normalized)) {
          trace.candidates.push({ url: normalized, publication: result.publication ?? "", outcome: "DUPLICATE", reason: "Search results repeated the same normalized URL.", statusCode: null, articleId: null });
          continue;
        }
        discovered.set(normalized, { ...result, url: normalized });
      }
    } catch (error) {
      trace.decisions.push(`Search failed for query “${query}”: ${error instanceof Error ? error.message : "unknown search error"}`);
    }
  }

  if (trace.queries.length > 0 && successfulSearchResponses === 0 && !options.signal?.aborted) {
    throw new EditorialCollectionError(
      "reader_discovery_unavailable",
      "All preference-based discovery searches failed before returning results.",
    );
  }

  const candidates = [...discovered.values()].slice(0, Math.max(1, Math.min(options.maxArticleChecks ?? 36, 60)));
  trace.decisions.push(`Generated ${trace.queries.length} preference-based search queries and discovered ${discovered.size} unique article URLs; no article URL list was supplied as input.`);
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
  for (const candidate of checked) {
    if (!candidate.article) {
      if (candidate.summary.contentStatus !== "FULL_TEXT") allSummaries.push(candidate.summary);
      trace.candidates.push(candidate.trace);
      continue;
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
  const eligible = approved
    .map((item) => item.article)
    .filter((article) => satisfiesDifficulty(article, preferences.difficulty) && article.topics.length > 0);
  for (const item of approved) {
    if (!satisfiesDifficulty(item.article, preferences.difficulty)) {
      item.trace.outcome = "REJECTED";
      item.trace.reason = `Semantic approval did not override measured difficulty ${item.article.difficulty}; saved preference is ${preferences.difficulty}.`;
    }
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

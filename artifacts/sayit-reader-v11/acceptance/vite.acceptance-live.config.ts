import { createHash } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createDeepSeekJsonCompletionClient } from "../../../server/provider";
import { ReaderStore } from "../../../server/reader/store";
import { safeFetchArticle, type SafeHttpResponse } from "../../../server/reader/safe-fetch";
import { readerServicePlugin } from "../../../server/reader/vite-plugin";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(acceptanceDirectory, "../../..");
const candidate = assertFrozenCandidate();
const dataDirectory = process.env.SAYIT_ACCEPTANCE_READER_DATA_DIR;
const fetchEvidencePath = process.env.SAYIT_ACCEPTANCE_FETCH_TRACE_PATH;
if (!dataDirectory || !path.isAbsolute(dataDirectory)) {
  throw new Error("An absolute isolated Reader data directory is required.");
}
if (!fetchEvidencePath || !path.isAbsolute(fetchEvidencePath)) {
  throw new Error("An absolute acceptance fetch receipt path is required.");
}
if (!existsSync(dataDirectory)) throw new Error("The isolated Reader preferences store must be seeded before Vite starts.");
if (existsSync(fetchEvidencePath)) throw new Error("Fetch receipt already exists; refusing to overwrite prior evidence.");
writeFileSync(fetchEvidencePath, "", { encoding: "utf8", flag: "wx" });

const env = loadEnv("development", candidateRoot, "");
const providerConfig = {
  apiKey: env.DEEPSEEK_API_KEY,
  model: env.DEEPSEEK_MODEL,
  baseUrl: env.DEEPSEEK_BASE_URL,
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function wordCount(value: string): number {
  return value.match(/\p{L}+(?:['’]\p{L}+)*/gu)?.length ?? 0;
}

function elementText(elements: Element[]): string[] {
  return elements.map((element) => normalizedText(element.textContent));
}

function structuredArticleSignals(document: Document) {
  const nodes: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const rawType = row["@type"];
    const types = Array.isArray(rawType) ? rawType.filter((item): item is string => typeof item === "string") : typeof rawType === "string" ? [rawType] : [];
    if (types.some((type) => /article|report|blogposting/iu.test(type))) {
      const publisher = row.publisher && typeof row.publisher === "object" ? row.publisher as Record<string, unknown> : null;
      nodes.push({
        types,
        headline: typeof row.headline === "string" ? row.headline : null,
        name: typeof row.name === "string" ? row.name : null,
        publisherName: publisher && typeof publisher.name === "string" ? publisher.name : null,
      });
    }
    if (row["@graph"]) visit(row["@graph"]);
  };

  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // Keep the page receipt; malformed structured metadata is a recorded absence.
    }
  }
  return nodes.slice(0, 12);
}

function pageObservation(requestedUrl: string, response: SafeHttpResponse) {
  const bytes = response.body;
  const html = bytes.toString("utf8");
  const dom = new JSDOM(html, { url: response.finalUrl });
  const document = dom.window.document;
  const articles = [...document.querySelectorAll("article")];
  const mains = [...document.querySelectorAll("main")];
  const bodyText = normalizedText(document.body?.textContent);
  const articleText = normalizedText(articles.map((element) => element.textContent).join(" "));
  const mainText = normalizedText(mains.map((element) => element.textContent).join(" "));
  const readabilityDocument = document.cloneNode(true) as Document;
  let readability: ReturnType<Readability["parse"]> | null = null;
  try {
    readability = new Readability(readabilityDocument).parse();
  } catch {
    readability = null;
  }
  const articleHeadings = articles.flatMap((element) => [...element.querySelectorAll("h1")]);
  const mainHeadings = mains.flatMap((element) => [...element.querySelectorAll("h1")]);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content") ?? null;
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const headers = response.headers;
  const contentType = headers["content-type"];
  const contentLength = headers["content-length"];
  const readabilityText = normalizedText(readability?.textContent);

  return {
    requestedUrl,
    finalUrl: response.finalUrl,
    statusCode: response.statusCode,
    contentType: Array.isArray(contentType) ? contentType[0] : contentType ?? null,
    declaredContentLength: Array.isArray(contentLength) ? contentLength[0] : contentLength ?? null,
    receivedBytes: bytes.byteLength,
    responseBodySha256: sha256(bytes),
    documentTitle: normalizedText(document.title) || null,
    canonicalUrl: canonical,
    titleSignals: {
      documentTitle: normalizedText(document.title) || null,
      ogTitle: meta('meta[property="og:title"]'),
      twitterTitle: meta('meta[name="twitter:title"]'),
      citationTitle: meta('meta[name="citation_title"]'),
      pageH1Count: document.querySelectorAll("h1").length,
      pageH1Values: elementText([...document.querySelectorAll("h1")].slice(0, 8)),
      articleH1Count: articleHeadings.length,
      articleH1Values: elementText(articleHeadings.slice(0, 8)),
      mainH1Count: mainHeadings.length,
      mainH1Values: elementText(mainHeadings.slice(0, 8)),
    },
    publisherSignals: {
      citationPublicationTitle: meta('meta[name="citation_publication_title"]'),
      openGraphSiteName: meta('meta[property="og:site_name"]'),
      openGraphType: meta('meta[property="og:type"]'),
      htmlLanguage: document.documentElement.getAttribute("lang"),
      jsonLdArticles: structuredArticleSignals(document),
    },
    articleBoundaries: {
      articleRootCount: articles.length,
      articleParagraphCount: articles.reduce((sum, element) => sum + element.querySelectorAll("p").length, 0),
      articleTextCharacters: articleText.length,
      articleTextWords: wordCount(articleText),
      articleTextSha256: sha256(articleText),
      mainRootCount: mains.length,
      mainParagraphCount: mains.reduce((sum, element) => sum + element.querySelectorAll("p").length, 0),
      mainTextCharacters: mainText.length,
      mainTextWords: wordCount(mainText),
      mainTextSha256: sha256(mainText),
      pageParagraphCount: document.querySelectorAll("p").length,
      bodyTextCharacters: bodyText.length,
      bodyTextWords: wordCount(bodyText),
      bodyTextSha256: sha256(bodyText),
    },
    readability: readability ? {
      title: normalizedText(readability.title) || null,
      textCharacters: readabilityText.length,
      textWords: wordCount(readabilityText),
      textSha256: sha256(readabilityText),
      contentCharacters: readability.content?.length ?? 0,
    } : null,
  };
}

async function observedSafeFetch(requestedUrl: string): Promise<SafeHttpResponse> {
  try {
    const response = await safeFetchArticle(requestedUrl);
    appendFileSync(fetchEvidencePath!, `${JSON.stringify(pageObservation(requestedUrl, response))}\n`, { encoding: "utf8" });
    return response;
  } catch (error) {
    appendFileSync(fetchEvidencePath!, `${JSON.stringify({
      requestedUrl,
      fetchError: error instanceof Error ? error.message : String(error),
    })}\n`, { encoding: "utf8" });
    throw error;
  }
}

const readerStore = new ReaderStore({ directory: dataDirectory });

const candidateBoundViteConfig: Plugin = {
  name: "sayit-reader-v11-acceptance-observer",
  configResolved(config) {
    if (path.resolve(config.root) !== candidateRoot) {
      throw new Error("Acceptance Vite root does not match the fixed candidate worktree.");
    }
  },
};

export default defineConfig({
  root: candidateRoot,
  plugins: [
    react(),
    candidateBoundViteConfig,
    readerServicePlugin({
      serviceOptions: {
        store: readerStore,
        semanticClient: createDeepSeekJsonCompletionClient(providerConfig),
        fetchArticle: observedSafeFetch,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  define: {
    __SAYIT_ACCEPTANCE_CANDIDATE__: JSON.stringify(candidate),
  },
});

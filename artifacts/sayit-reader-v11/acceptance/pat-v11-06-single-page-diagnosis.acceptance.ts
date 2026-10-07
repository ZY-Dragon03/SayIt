import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { safeFetchArticle } from "../../../server/reader/safe-fetch";
import { assertFrozenCandidate } from "./candidate-guard";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateUrl = "https://www.technologyreview.com/2026/09/28/1145197/whos-liable-when-ai-agents-go-rogue";

function structuredHeadlines(document: Document): { headlines: string[]; isArticle: boolean } {
  const headlines: string[] = [];
  let isArticle = false;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((type) => typeof type === "string" && /article|reportage|blogposting/iu.test(type))) {
      isArticle = true;
      if (typeof record.headline === "string") headlines.push(record.headline.replace(/\s+/gu, " ").trim());
    }
    Object.values(record).forEach(visit);
  };
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // Malformed JSON-LD contributes no publisher/title evidence.
    }
  }
  return { headlines: [...new Set(headlines.filter(Boolean))], isArticle };
}

describe("PAT-V11-06 single-source diagnosis", () => {
  it("captures one safe refetch of the strongest retained unlisted article candidate", async () => {
    const identity = assertFrozenCandidate();
    const priorPath = path.join(acceptanceDirectory, "pat-v11-06-live-default-catchup-nonfull-a33e7ff1-host-normalized.json");
    const prior = JSON.parse(readFileSync(priorPath, "utf8")) as {
      candidates: Array<{ url: string; publication: string; outcome: string; reason: string; statusCode: number | null; publisherMapMatch: boolean }>;
      publisherNameNormalizationMap: { sourceSha256: string; knownDomains: string[] };
    };
    const previousObservation = prior.candidates.find((candidate) => candidate.url === candidateUrl);
    expect(previousObservation).toBeDefined();
    expect(previousObservation?.publisherMapMatch).toBe(false);

    const response = await safeFetchArticle(candidateUrl);
    const html = response.body.toString("utf8");
    const document = new JSDOM(html, { url: response.finalUrl }).window.document;
    const structured = structuredHeadlines(document);
    const parsed = new Readability(document.cloneNode(true) as Document, { charThreshold: 100 }).parse();
    const articleRoots = [...document.querySelectorAll("article")];
    const h1Values = articleRoots.flatMap((root) => [...root.querySelectorAll("h1")]
      .map((heading) => (heading.textContent ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean));
    const parsedTitle = (parsed?.title ?? "").replace(/\s+/gu, " ").trim();
    const declaredTitles = [...new Set([
      ...structured.headlines,
      document.querySelector<HTMLMetaElement>('meta[name="citation_title"]')?.content,
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.replace(/\s+/gu, " ").trim()))];
    const metadata = {
      htmlTitle: (document.title ?? "").replace(/\s+/gu, " ").trim(),
      readabilityTitle: parsedTitle,
      h1Values,
      structuredArticleHeadlines: structured.headlines,
      citationTitle: document.querySelector<HTMLMetaElement>('meta[name="citation_title"]')?.content?.trim() ?? null,
      openGraphTitle: document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim() ?? null,
      citationPublication: document.querySelector<HTMLMetaElement>('meta[name="citation_publication_title"]')?.content?.trim() ?? null,
      articlePublisher: document.querySelector<HTMLMetaElement>('meta[property="article:publisher"]')?.content?.trim() ?? null,
      openGraphSiteName: document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content?.trim() ?? null,
      htmlLang: document.documentElement.lang || null,
      openGraphType: document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content?.trim() ?? null,
      canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
    };
    const normalizedReadabilityTitle = parsedTitle.toLocaleLowerCase("en-US");
    const titleAgreement = h1Values.length === 1 && h1Values[0]!.toLocaleLowerCase("en-US") === normalizedReadabilityTitle &&
      declaredTitles.length > 0 && declaredTitles.every((title) => title.toLocaleLowerCase("en-US") === normalizedReadabilityTitle);
    const articleTypeVerified = metadata.openGraphType?.toLocaleLowerCase("en-US") === "article" || structured.isArticle;
    const standalonePredicate = articleRoots.length === 1 && articleTypeVerified && titleAgreement;
    const canonicalUrl = metadata.canonicalUrl ? new URL(metadata.canonicalUrl).toString() : null;
    const finalUrl = new URL(response.finalUrl).toString();
    const readableText = parsed?.textContent ?? "";
    const receipt = {
      observation: "PAT-V11-06 diagnostic only; no new collection was run",
      candidateCommit: identity.commit,
      candidateTree: identity.tree,
      sourceTrace: {
        priorReceipt: path.basename(priorPath),
        url: candidateUrl,
        publicationFromDiscoveryHost: previousObservation?.publication ?? null,
        statusCodeFromCollection: previousObservation?.statusCode ?? null,
        outcomeFromCollection: previousObservation?.outcome ?? null,
        exactTraceReason: previousObservation?.reason ?? null,
        publisherNameMapSourceSha256: prior.publisherNameNormalizationMap.sourceSha256,
        publisherDomainAbsentFromMap: !prior.publisherNameNormalizationMap.knownDomains.includes("technologyreview.com"),
      },
      oneReadOnlySafeRefetch: {
        statusCode: response.statusCode,
        contentType: String(response.headers["content-type"] ?? ""),
        finalUrl: response.finalUrl,
        canonicalUrl,
        canonicalMatchesOriginalOrFinal: canonicalUrl === candidateUrl || canonicalUrl === finalUrl,
        pageByteCount: response.body.byteLength,
        pageHtmlSha256: createHash("sha256").update(response.body).digest("hex"),
        metadata,
        articleRootCount: articleRoots.length,
        readableParagraphCount: parsed?.content ? (parsed.content.match(/<p\b/giu) ?? []).length : 0,
        readableWordCount: readableText.trim() ? readableText.trim().split(/\s+/u).length : 0,
        readableTextSha256: createHash("sha256").update(readableText).digest("hex"),
        titleAgreement,
        articleTypeVerified,
        standalonePredicate,
        failurePredicates: [
          ...(articleRoots.length !== 1 ? [`Expected exactly one article root, observed ${articleRoots.length}.`] : []),
          ...(!articleTypeVerified ? ["Page has neither og:type=article nor a structured article type."] : []),
          ...(!titleAgreement ? ["Exactly one article h1 and all declared article titles did not exactly equal the Readability title."] : []),
        ],
      },
      adjudicationLimit: "The original search-result title was not retained in the saved trace, so the original title-comparison input cannot be reconstructed. This refetch diagnoses the current page metadata and body only; it cannot replace the lost search-result title or prove a defect by itself.",
    };
    const evidencePath = path.join(acceptanceDirectory, "pat-v11-06-single-page-diagnosis-technologyreview-a33e7ff1.json");
    writeFileSync(evidencePath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.info("PAT-V11-06 single-page diagnosis:", JSON.stringify({ statusCode: response.statusCode, finalUrl: response.finalUrl, articleRoots: articleRoots.length, wordCount: receipt.oneReadOnlySafeRefetch.readableWordCount, titleAgreement, standalonePredicate, failurePredicates: receipt.oneReadOnlySafeRefetch.failurePredicates }));
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(300);
  });
});

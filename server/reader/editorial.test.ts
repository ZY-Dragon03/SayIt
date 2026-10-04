import { describe, expect, it, vi } from "vitest";
import {
  collectEditorial,
  countSentenceEnds,
  countSyllablesInWord,
  readArticleFullText,
  readingMetrics,
  shingleJaccard,
  type EditorialArticleFetcher,
  type EditorialPreferences,
  type FetchedArticlePage,
  type SearchCandidate,
} from "./editorial";

function articleBody(seed: string, independent = false): string {
  const sentences = independent
    ? [
        `Finance researchers describe the Federal Reserve decision through household credit, lending standards, and business investment rather than a simple market headline about rates.`,
        `Their analysis compares regional bank surveys, company plans, and consumer borrowing to explain how policy reaches people over several months.`,
        `The evidence suggests that careful reporting should separate immediate reactions from durable changes in prices, employment, and economic activity.`,
        `Officials and investors may agree on the published decision while disagreeing about its consequences for families, firms, and future growth.`,
      ]
    : [
        `The finance report about ${seed} follows the Federal Reserve decision and its possible effect on prices, credit, and household savings.`,
        `Officials explained the policy choice while investors reviewed the published figures and compared them with earlier economic reports.`,
        `The evidence gives readers a clear account of the market response, the public debate, and the next questions for business leaders.`,
        `Analysts said that a careful reading should separate verified facts from forecasts about jobs, inflation, and future growth.`,
      ];
  const paragraphs: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const ordered = independent
      ? [sentences[(index + 1) % sentences.length], sentences[(index + 3) % sentences.length], sentences[index % sentences.length], sentences[(index + 2) % sentences.length]]
      : sentences.map((sentence) => `${sentence} ${index % 2 ? "The report also considers the wider economy." : "The analysis includes several public sources."}`);
    paragraphs.push(ordered.join(" "));
  }
  return paragraphs.join("\n\n");
}

function pageFor(
  url: string,
  title: string,
  body: string,
  publisher = new URL(url).hostname.replace(/^www\./u, "").split(".")[0],
): FetchedArticlePage {
  const paragraphs = body.split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head><title>${title} | ${publisher}</title><meta property="og:site_name" content="${publisher}"></head><body><main><article><h1>${title}</h1>${paragraphs}</article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

function indexPageWithArticleMetadata(
  url: string,
  title: string,
  body: string,
  linkedHeadlines: string[],
  publisher = new URL(url).hostname.replace(/^www\./u, "").split(".")[0],
): FetchedArticlePage {
  const cards = linkedHeadlines.map((headline, index) =>
    `<h3><a href="/technology/story-${index}">${headline}</a></h3>`,
  ).join("");
  const paragraphs = body.split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head>
    <title>${title} | ${publisher}</title>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="${publisher}">
    </head><body><main role="main" itemscope itemtype="https://schema.org/NewsArticle">
    <h1>${title}</h1><section aria-label="Editorial index">${cards}</section>
    <div class="collection-introduction">${paragraphs}</div>
    </main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

function pageWithLinkDenseSourceBlocks(
  url: string,
  title: string,
  paragraphs: string[],
  linkedParagraphIndexes: ReadonlySet<number>,
): FetchedArticlePage {
  const textBlocks = paragraphs.map((paragraph, index) => {
    const body = linkedParagraphIndexes.has(index)
      ? `<a href="/references/${index}">${paragraph}</a>`
      : paragraph;
    return `<div class="GridItem"><p class="ArticleParagraph">${body}</p></div>`;
  }).join("");
  const html = `<!doctype html><html lang="en"><head>
    <title>${title} | Reuters</title>
    <meta property="og:site_name" content="Reuters">
    </head><body><main><article><h1>${title}</h1>
    <div data-component="text-block"><div class="Grid">${textBlocks}</div></div>
    </article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

function pageWithSemanticBodyAndReadabilityOmissions(
  url: string,
  title: string,
  paragraphs: string[],
  omittedIndexes: ReadonlySet<number>,
  semanticSource: "itemprop" | "json-ld" | "article-page" = "itemprop",
): FetchedArticlePage {
  const sourceBody = paragraphs.map((paragraph, index) =>
    `<p${omittedIndexes.has(index) ? ' class="comment"' : ""}>${paragraph}</p>`,
  ).join("");
  const itemprop = semanticSource === "itemprop" ? ' itemprop="articleBody"' : "";
  const openGraphType = semanticSource === "article-page"
    ? '<meta property="og:type" content="article">'
    : "";
  const structuredArticle = semanticSource !== "itemprop"
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: title,
        ...(semanticSource === "json-ld" ? { articleBody: paragraphs.join(" ") } : {}),
        publisher: { "@type": "Organization", name: "Reuters" },
      })}</script>`
    : "";
  const html = `<!doctype html><html lang="en"><head>
    <title>${title} | Reuters</title>
    ${openGraphType}
    <meta property="og:site_name" content="Reuters">
    ${structuredArticle}</head><body><main><article><h1>${title}</h1>
    <div${itemprop}>${sourceBody}</div>
    </article></main></body></html>`;
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
    finalUrl: url,
  };
}

function preferenceFor(body: string, count = 2): EditorialPreferences {
  return preferencesForBodies([body], count);
}

function preferencesForBodies(bodies: string[], count = bodies.length): EditorialPreferences {
  const metrics = readingMetrics(bodies[0] ?? "");
  const estimatedMinutes = bodies.reduce((sum, body) => sum + readingMetrics(body).readingMinutes, 0);
  return {
    topics: ["Finance"],
    dailyArticleCount: count,
    difficulty: metrics.difficulty ?? "Intermediate",
    readingBudgetMinutes: estimatedMinutes / 0.85,
  };
}

function preferencesForTopic(body: string, topic: string): EditorialPreferences {
  const metrics = readingMetrics(body);
  return {
    topics: [topic],
    dailyArticleCount: 1,
    difficulty: metrics.difficulty ?? "Intermediate",
    readingBudgetMinutes: metrics.readingMinutes / 0.85,
  };
}

function makeFetcher(pages: Map<string, FetchedArticlePage>, calls: string[] = []): EditorialArticleFetcher {
  return async (url) => {
    calls.push(url);
    const page = pages.get(url);
    if (!page) throw new Error("Source disappeared before it could be fetched.");
    return page;
  };
}

describe("SayIt Reader Editorial Agent", () => {
  it("rejects a semantic editorial index while keeping a standalone editorial article eligible", async () => {
    const indexUrl = "https://www.reuters.com/technology/technology+tone/editorials";
    const indexTitle = "Technology + Editorials";
    const indexBody = articleBody("technology editorial coverage and independent analysis");
    const preferences = preferencesForTopic(indexBody, "Technology");
    const indexPage = indexPageWithArticleMetadata(indexUrl, indexTitle, indexBody, [
      "Editors examine technology policy and public debate",
      "Independent writers discuss changing digital markets",
      "Researchers review the latest computing decisions",
    ], "Reuters");
    const indexResult = await collectEditorial(preferences, {
      search: async () => [{ url: indexUrl, title: indexTitle, snippet: "Technology + Editorials" }],
      fetchArticle: makeFetcher(new Map([[indexUrl, indexPage]])),
      maxArticleChecks: 1,
    });

    expect(indexResult.status).toBe("NOT_DELIVERED");
    expect(indexResult.articles).toHaveLength(0);
    expect(indexResult.trace.candidates.some(
      (candidate) => candidate.url === indexUrl && candidate.outcome === "REJECTED" && /category|listing|index/iu.test(candidate.reason),
    )).toBe(true);

    const articleUrl = "https://www.reuters.com/technology/2026/10/04/independent-editorial-analysis";
    const articleTitle = "Why technology reporting needs independent editorial analysis";
    const articleText = articleBody("technology reporting and independent editorial analysis");
    const articleResult = await collectEditorial(preferencesForTopic(articleText, "Technology"), {
      search: async () => [{ url: articleUrl, title: articleTitle, snippet: "Independent editorial analysis" }],
      fetchArticle: makeFetcher(new Map([[articleUrl, pageFor(articleUrl, articleTitle, articleText, "Reuters")]])),
      maxArticleChecks: 1,
    });
    expect(articleResult.status).toBe("COMPLETE");
    expect(articleResult.articles[0]).toMatchObject({
      title: articleTitle,
      originalUrl: articleUrl,
      contentStatus: "FULL_TEXT",
    });
  });

  it("fails retryably only when every preference-generated search query fails", async () => {
    const search = vi.fn(async () => { throw new Error("offline search transport"); });
    const result = collectEditorial(preferencesForTopic(articleBody("central bank policy"), "Finance"), {
      search,
      fetchArticle: async () => { throw new Error("No source should be fetched after search failure."); },
    });

    await expect(result).rejects.toMatchObject({
      code: "reader_discovery_unavailable",
      retryable: true,
    });
    expect(search).toHaveBeenCalled();
  });

  it("fails retryably when every discovered source fetch throws before a response", async () => {
    const url = "https://www.reuters.com/finance/central-bank-report";
    const result = collectEditorial(preferencesForTopic(articleBody("central bank policy"), "Finance"), {
      search: async () => [{ url, title: "Finance report on central bank policy", snippet: "A full report" }],
      fetchArticle: async () => { throw new Error("offline source transport"); },
      maxArticleChecks: 1,
    });

    await expect(result).rejects.toMatchObject({
      code: "reader_source_unavailable",
      retryable: true,
    });
  });

  it("keeps permanent HTTP unavailability as shortage but retries all-transient source responses", async () => {
    const url = "https://www.reuters.com/finance/central-bank-http-status";
    const preferences = preferencesForTopic(articleBody("central bank policy"), "Finance");
    const search = async () => [{ url, title: "Finance report on central bank policy", snippet: "A full report" }];
    const permanent404 = { ...pageFor(url, "Finance report", articleBody("central bank policy"), "Reuters"), statusCode: 404 };
    const unavailable = await collectEditorial(preferences, {
      search,
      fetchArticle: async () => permanent404,
      maxArticleChecks: 1,
    });
    expect(unavailable.status).toBe("NOT_DELIVERED");
    expect(unavailable.candidates[0]?.contentStatus).toBe("UNAVAILABLE");

    const transient503 = { ...permanent404, statusCode: 503 };
    await expect(collectEditorial(preferences, {
      search,
      fetchArticle: async () => transient503,
      maxArticleChecks: 1,
    })).rejects.toMatchObject({
      code: "reader_source_unavailable",
      retryable: true,
    });
  });

  it("returns ordinary NOT_DELIVERED when preference searches succeed without candidates", async () => {
    const fetchArticle = vi.fn(async () => { throw new Error("No source should be fetched for empty search results."); });
    const result = await collectEditorial(preferencesForTopic(articleBody("central bank policy"), "Finance"), {
      search: async () => [],
      fetchArticle,
    });

    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.articles).toHaveLength(0);
    expect(fetchArticle).not.toHaveBeenCalled();
  });

  it("returns ordinary NOT_DELIVERED when every fetched result is summary-only", async () => {
    const url = "https://www.reuters.com/finance/central-bank-summary";
    const summary = pageFor(url, "Finance summary of a central bank decision", "A brief summary of the central bank decision and its effect on finance.", "Reuters");
    const result = await collectEditorial(preferencesForTopic(articleBody("central bank policy"), "Finance"), {
      search: async () => [{ url, title: "Finance summary of a central bank decision", snippet: "A short summary" }],
      fetchArticle: async () => summary,
      maxArticleChecks: 1,
    });

    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.articles).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.contentStatus).toBe("SUMMARY");
  });

  it("rejects an incomplete Readability extraction when story paragraphs are omitted", async () => {
    const url = "https://www.reuters.com/world/analysis/synthetic-continuity-case";
    const title = "Synthetic report on finance and economic evidence";
    const paragraphs = Array.from({ length: 47 }, (_, index) => [
      `Researchers measured how independent teams described changes in finance and local economic markets during study ${index + 1}.`,
      "The report compares current evidence with regional records and published forecasts for readers.",
      "Editors said these findings could shape public policy decisions through the coming year.",
    ].join(" "));
    const omittedIndexes = new Set([13, 19, 20, 21, 22, 26, 27, 31, 34, 37, 41, 43, 45, 46]);
    const sourceBody = paragraphs.join("\n\n");
    const preferences = preferencesForTopic(sourceBody, "Finance");
    const result = await collectEditorial(preferences, {
      search: async () => [{ url, title, snippet: "A finance and economy report" }],
      fetchArticle: makeFetcher(new Map([[url, pageWithLinkDenseSourceBlocks(url, title, paragraphs, omittedIndexes)]])),
      maxArticleChecks: 1,
    });

    expect(result.articles).toHaveLength(0);
    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.candidates[0]?.contentStatus).toBe("SUMMARY");
    expect(result.trace.candidates.some(
      (candidate) => candidate.url === url && candidate.outcome === "REJECTED" && /incomplete|omitted|coverage/iu.test(candidate.reason),
    )).toBe(true);

    const completeResult = await collectEditorial(preferences, {
      search: async () => [{ url, title, snippet: "A finance and economy report" }],
      fetchArticle: makeFetcher(new Map([[url, pageWithLinkDenseSourceBlocks(url, title, paragraphs, new Set())]])),
      maxArticleChecks: 1,
    });
    expect(completeResult.status).toBe("COMPLETE");
    expect(completeResult.articles[0]?.paragraphCount).toBe(47);
  });

  it("reconstructs small Readability omissions from verified semantic article bodies", async () => {
    const title = "How finance researchers track regional lending changes";
    const cases = [
      { paragraphCount: 31, omittedIndexes: [4, 13, 26], semanticSource: "itemprop" },
      { paragraphCount: 31, omittedIndexes: [4, 13, 26], semanticSource: "json-ld" },
      { paragraphCount: 33, omittedIndexes: [4, 13, 26], semanticSource: "article-page" },
      { paragraphCount: 15, omittedIndexes: [7], semanticSource: "article-page" },
    ] as const;
    for (const testCase of cases) {
      const paragraphs = Array.from({ length: testCase.paragraphCount }, (_, index) => [
        `Researchers studied finance policy and regional credit activity during economic review ${index + 1}.`,
        "The report compares Federal Reserve records with published forecasts and household borrowing across several markets.",
        "Analysts explain how business investment changed as lending standards evolved over several months and influenced prices.",
      ].join(" "));
      const omittedIndexes = new Set<number>(testCase.omittedIndexes);
      const sourceBody = paragraphs.join("\n\n");
      const url = `https://www.reuters.com/finance/synthetic-body-recovery-${testCase.paragraphCount}-${testCase.semanticSource}`;
      const result = await collectEditorial(preferencesForTopic(sourceBody, "Finance"), {
        search: async () => [{ url, title, snippet: "A finance report on regional lending" }],
        fetchArticle: makeFetcher(new Map([[url, pageWithSemanticBodyAndReadabilityOmissions(url, title, paragraphs, omittedIndexes, testCase.semanticSource)]])),
        maxArticleChecks: 1,
      });

      expect(result.status).toBe("COMPLETE");
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]?.contentStatus).toBe("FULL_TEXT");
      expect(result.articles[0]?.paragraphCount).toBe(paragraphs.length);
      expect(result.articles[0]?.paragraphs).toEqual(paragraphs);
      const acceptedTrace = result.trace.candidates.find(
        (candidate) => candidate.url === url && candidate.outcome === "ACCEPTED",
      );
      expect(acceptedTrace?.reason).toMatch(
        new RegExp(`Reconstructed ${omittedIndexes.size} paragraph\\(s\\) from the verified source article body`, "iu"),
      );
    }
  });

  it("discovers from preference-generated queries, replaces failures, and meets issue constraints", async () => {
    const bodyOne = articleBody("the central bank vote");
    const bodyTwo = articleBody("the Federal Reserve decision", true);
    const first = "https://reuters.com/federal-reserve-decision";
    const second = "https://economist.com/analysis/rates";
    const inaccessible = "https://blockednews.com/story";
    const summary = "https://briefnews.com/summary";
    const vanished = "https://gonenews.com/article";
    const searches: string[] = [];
    const search = async (query: string): Promise<SearchCandidate[]> => {
      searches.push(query);
      return [
        { url: inaccessible, title: "Finance policy report", snippet: "Full story" },
        { url: summary, title: "Finance policy summary", snippet: "Short overview" },
        { url: vanished, title: "Finance article missing", snippet: "A report" },
        { url: first, title: "Finance: Federal Reserve decision", snippet: "Policy details" },
        { url: second, title: "Finance analysis of interest rates", snippet: "Independent analysis" },
      ];
    };
    const pages = new Map<string, FetchedArticlePage>([
      [inaccessible, { ...pageFor(inaccessible, "Finance policy report", articleBody("blocked")), statusCode: 403 }],
      [summary, pageFor(summary, "Finance policy summary", "The finance summary gives a short overview of the Federal Reserve decision.")],
      [vanished, { ...pageFor(vanished, "Finance article missing", bodyOne), statusCode: 404 }],
      [first, pageFor(first, "Finance: Federal Reserve decision", bodyOne, "Reuters")],
      [second, pageFor(second, "Finance analysis of interest rates", bodyTwo, "The Economist")],
    ]);
    const fetchCalls: string[] = [];
    const preferences = preferencesForBodies([bodyOne, bodyTwo]);
    const result = await collectEditorial(preferences, {
      search,
      fetchArticle: makeFetcher(pages, fetchCalls),
      maxArticleChecks: 10,
    });

    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((query) => query.toLowerCase().includes("finance"))).toBe(true);
    expect(searches.some((query) => /in-depth|analysis|reporting/u.test(query))).toBe(true);
    expect(searches.some((query) => /site:(?:theguardian\.com|theconversation\.com|apnews\.com|reuters\.com|bbc\.com|npr\.org)/u.test(query))).toBe(true);
    expect(fetchCalls).toContain(first);
    expect(fetchCalls).toContain(second);
    expect(result.status).toBe("COMPLETE");
    expect(result.articles).toHaveLength(preferences.dailyArticleCount);
    expect(result.articles.every((article) => article.contentStatus === "FULL_TEXT")).toBe(true);
    expect(result.articles.every((article) => article.difficulty === preferences.difficulty)).toBe(true);
    expect(result.articles.every((article) => article.topics.includes("Finance"))).toBe(true);
    expect(result.actual.readingMinutes).toBeGreaterThanOrEqual(preferences.readingBudgetMinutes * 0.7);
    expect(result.actual.readingMinutes).toBeLessThanOrEqual(preferences.readingBudgetMinutes);
    expect(result.trace.candidates.some((candidate) => candidate.url === inaccessible && candidate.statusCode === 403)).toBe(true);
    expect(result.trace.candidates.some((candidate) => candidate.url === summary && /summary|short/iu.test(candidate.reason))).toBe(true);
    expect(result.trace.candidates.some((candidate) => candidate.url === vanished && candidate.statusCode === 404)).toBe(true);
    expect(result.trace.decisions.some((decision) => decision.includes("no article URL list was supplied as input"))).toBe(true);
  });

  it("rejects repeated copies while allowing independent analysis of the same event", async () => {
    const reporting = articleBody("the Federal Reserve announcement");
    const independent = articleBody("the Federal Reserve announcement", true);
    const urls = [
      "https://apnews.com/fed-decision",
      "https://reuters.com/fed-decision-copy",
      "https://economist.com/fed-policy-analysis",
    ];
    const pages = new Map<string, FetchedArticlePage>([
      [urls[0], pageFor(urls[0], "Federal Reserve decision changes finance outlook", reporting, "Associated Press")],
      [urls[1], pageFor(urls[1], "Federal Reserve decision changes finance outlook", reporting, "Reuters")],
      [urls[2], pageFor(urls[2], "Independent finance analysis of Federal Reserve policy", independent, "Economist Review")],
    ]);
    const result = await collectEditorial(preferencesForBodies([reporting, independent]), {
      search: async () => urls.map((url, index) => ({ url, title: `Finance report ${index}`, snippet: "Federal Reserve coverage" })),
      fetchArticle: makeFetcher(pages),
      maxArticleChecks: 8,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.articles).toHaveLength(2);
    expect(result.trace.candidates.some((candidate) => candidate.url === urls[1] && candidate.outcome === "DUPLICATE")).toBe(true);
    expect(result.articles.map((article) => article.originalPublication)).toContain("The Economist");
    expect(shingleJaccard(reporting, independent)).toBeLessThan(0.85);
  });

  it("re-fetches full text without discovery and preserves original versus accessible attribution", async () => {
    const originalUrl = "https://reuters.com/finance/fed-story";
    const redirectedUrl = "https://theguardian.com/finance/fed-story";
    const body = articleBody("the Federal Reserve decision");
    const redirected = pageFor(redirectedUrl, "Finance report on the Federal Reserve decision", body, "The Guardian");
    const reference = {
      id: "stored-article-id",
      title: "Finance report on the Federal Reserve decision",
      originalPublication: "Reuters",
      originalUrl,
      accessiblePublication: "Old Archive",
      accessibleUrl: "https://old-archive.com/story",
      topics: ["Finance"],
    };
    const { article, reason } = await readArticleFullText(reference, async (url) => {
      expect(url).toBe(originalUrl);
      return { ...redirected, finalUrl: redirectedUrl };
    });

    expect(article?.contentStatus).toBe("FULL_TEXT");
    expect(article?.id).toBe(reference.id);
    expect(article?.originalPublication).toBe("Reuters");
    expect(article?.originalUrl).toBe(originalUrl);
    expect(article?.accessiblePublication).toBe("The Guardian");
    expect(article?.accessibleUrl).toBe(redirectedUrl);
    expect(article?.paragraphs?.length).toBeGreaterThanOrEqual(3);
    expect(reason).toContain("revalidated");
  });

  it("uses deterministic observable word, sentence, syllable and reading-time metrics", () => {
    const first = readingMetrics("The economy improves. Finance remains uncertain! A report follows.");
    const second = readingMetrics("The economy improves. Finance remains uncertain! A report follows.");
    expect(first).toEqual(second);
    expect(first.wordCount).toBe(9);
    expect(first.fkglWordCount).toBe(9);
    expect(first.sentenceCount).toBe(3);
    expect(first.readingMinutes).toBe(9 / 200);
    expect(countSyllablesInWord("table")).toBe(2);
    expect(countSyllablesInWord("make")).toBe(1);
    expect(countSentenceEnds('One sentence. "A quoted end!"')).toBe(2);
  });

  it("returns a partial issue rather than weakening constraints when sources disappear", async () => {
    const body = articleBody("the Federal Reserve decision");
    const first = "https://reuters.com/finance/report";
    const disappeared = "https://gonenews.com/finance";
    const pages = new Map([[first, pageFor(first, "Finance report Federal Reserve decision", body, "Reuters")] as const]);
    const result = await collectEditorial(preferenceFor(body), {
      search: async () => [
        { url: first, title: "Finance report Federal Reserve decision", snippet: "" },
        { url: disappeared, title: "Finance second report", snippet: "" },
      ],
      fetchArticle: makeFetcher(new Map(pages)),
      maxArticleChecks: 5,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.articles).toHaveLength(1);
    expect(result.unmetConstraints.some((constraint) => constraint.includes("Article count"))).toBe(true);
    expect(result.articles.every((article) => article.contentStatus === "FULL_TEXT")).toBe(true);
  });

  it("keeps a readable InfoStream Global page external-only when its host is not established", async () => {
    const url = "https://infostreamglobal.com/tech-reporting-ensuring-2026-media-credibility";
    const title = "Tech Reporting: Ensuring 2026 Media Credibility";
    const body = articleBody("technology reporting and digital media credibility");
    const result = await collectEditorial(preferencesForTopic(body, "Technology"), {
      search: async (query) => {
        expect(query.toLowerCase()).toContain("technology");
        return [{ url, title, snippet: "Technology reporting in 2026" }];
      },
      fetchArticle: makeFetcher(new Map([[url, pageFor(url, title, body, "InfoStream Global")]])),
      maxArticleChecks: 1,
    });

    expect(result.articles).toHaveLength(0);
    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.candidates[0]).toMatchObject({
      originalPublication: "Infostreamglobal",
      originalUrl: url,
      accessiblePublication: "InfoStream Global",
      accessibleUrl: url,
      contentStatus: "EXTERNAL_ONLY",
      paragraphCount: 0,
    });
    expect(result.candidates[0]?.paragraphs).toBeUndefined();
    expect(result.trace.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url,
        outcome: "REJECTED",
        reason: expect.stringContaining("curated established editorial publisher list"),
      }),
    ]));
  });

  it("accepts a dynamically discovered Guardian article path under its established publisher root", async () => {
    const url = "https://www.theguardian.com/technology/2026/10/04/ai-explainer-reporting";
    const title = "How technology reporting explains a changing industry";
    const body = articleBody("technology reporting and computing");
    const searches: string[] = [];
    const fetchCalls: string[] = [];
    const result = await collectEditorial(preferencesForTopic(body, "Technology"), {
      search: async (query) => {
        searches.push(query);
        return [{ url, title, snippet: "A technology explainer" }];
      },
      fetchArticle: makeFetcher(new Map([[url, pageFor(url, title, body, "The Guardian")]]), fetchCalls),
      maxArticleChecks: 1,
    });

    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((query) => query.toLowerCase().includes("technology"))).toBe(true);
    expect(fetchCalls).toContain(url);
    expect(result.status).toBe("COMPLETE");
    expect(result.articles[0]).toMatchObject({
      originalPublication: "The Guardian",
      originalUrl: url,
      accessiblePublication: "The Guardian",
      accessibleUrl: url,
      contentStatus: "FULL_TEXT",
    });
  });

  it("allows a non-RSS arbitrary article path under an established publisher root", async () => {
    const url = "https://www.reuters.com/world/longform/offbeat-path/2026/10/04/example";
    const title = "Technology analysis from an independently discovered article path";
    const body = articleBody("technology computing industry reporting");
    const result = await collectEditorial(preferencesForTopic(body, "Technology"), {
      search: async () => [{ url, title, snippet: "Technology analysis" }],
      fetchArticle: makeFetcher(new Map([[url, pageFor(url, title, body, "Reuters")]])),
      maxArticleChecks: 1,
    });

    expect(new URL(url).pathname).not.toMatch(/(?:^|\/)(?:rss|feed)(?:\/|$)/iu);
    expect(result.status).toBe("COMPLETE");
    expect(result.articles[0]).toMatchObject({
      originalPublication: "Reuters",
      originalUrl: url,
      contentStatus: "FULL_TEXT",
    });
  });

  it("keeps a broad dynamic search query for every saved topic at the 12-topic limit", async () => {
    const topics = [
      "Politics", "Economy", "Finance", "Geopolitics", "Technology", "Science",
      "Health", "Environment", "Business", "Arts", "Education", "Energy",
    ];
    const result = await collectEditorial({
      topics,
      dailyArticleCount: 1,
      difficulty: "Intermediate",
      readingBudgetMinutes: 20,
    }, {
      search: async () => [],
      fetchArticle: async () => { throw new Error("No source should be fetched without search results."); },
    });

    expect(result.trace.queries).toHaveLength(12);
    for (const topic of topics) {
      expect(result.trace.queries.some((query) => query.startsWith(`${topic} `))).toBe(true);
    }
  });

  it("rejects the ScienceDaily technology hub when raw headline cards coexist with article metadata", async () => {
    const url = "https://www.sciencedaily.com/news/matter_energy/technology";
    const title = "Technology News";
    const body = articleBody("technology reporting and computing");
    const linkedCards = [
      "Researchers explain a new computing discovery",
      "Technology changes how scientists measure energy",
      "New study examines artificial intelligence systems",
      "Engineers report progress on a computer chip",
      "Latest research explores data and digital systems",
    ].map((headline, index) => `<h3><a href="/releases/2026/10/story-${index}.htm">${headline}</a></h3>`).join("");
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title,
      articleBody: body,
      datePublished: "2026-10-01T12:00:00Z",
      publisher: { "@type": "Organization", name: "ScienceDaily" },
    });
    const html = `<!doctype html><html lang="en"><head>
      <title>${title} | ScienceDaily</title>
      <meta property="og:type" content="article">
      <meta property="og:site_name" content="ScienceDaily">
      <meta property="article:published_time" content="2026-10-01T12:00:00Z">
      <script type="application/ld+json">${jsonLd}</script>
      </head><body><header><h1>${title}</h1></header>
      <nav><h2>Top Headlines</h2>${linkedCards}</nav>
      <aside><h2>Latest Headlines</h2>${linkedCards}</aside>
      <main><article>${body.split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join("")}</article></main>
      </body></html>`;
    const fixture: FetchedArticlePage = {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from(html),
      finalUrl: url,
    };
    const result = await collectEditorial(preferencesForTopic(body, "Technology"), {
      search: async () => [{ url, title, snippet: "Top Headlines and Latest Headlines in technology" }],
      fetchArticle: makeFetcher(new Map([[url, fixture]])),
      maxArticleChecks: 1,
    });

    expect(result.articles).toHaveLength(0);
    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.trace.candidates.some(
      (candidate) => candidate.url === url && candidate.outcome === "REJECTED" && /category|listing|hub/iu.test(candidate.reason),
    )).toBe(true);
  });

  it("keeps an individual ScienceDaily release eligible with article metadata and a specific title", async () => {
    const url = "https://www.sciencedaily.com/releases/2026/10/261004123456.htm";
    const title = "New computing method advances technology research";
    const body = articleBody("technology computing research");
    const related = [
      "A related technology research discovery",
      "Researchers examine a new computer system",
      "Science team reports a digital measurement technique",
    ].map((headline, index) => `<h3><a href="/releases/2026/10/related-${index}.htm">${headline}</a></h3>`).join("");
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title,
      articleBody: body,
      datePublished: "2026-10-04T12:00:00Z",
      publisher: { "@type": "Organization", name: "ScienceDaily" },
    });
    const html = `<!doctype html><html lang="en"><head>
      <title>${title} | ScienceDaily</title>
      <meta property="og:type" content="article">
      <meta property="og:site_name" content="ScienceDaily">
      <meta property="article:published_time" content="2026-10-04T12:00:00Z">
      <script type="application/ld+json">${jsonLd}</script>
      </head><body><main><article><h1>${title}</h1>
      ${body.split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join("")}
      </article><aside><h2>Related Headlines</h2>${related}</aside></main></body></html>`;
    const fixture: FetchedArticlePage = {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from(html),
      finalUrl: url,
    };
    const result = await collectEditorial(preferencesForTopic(body, "Technology"), {
      search: async () => [{ url, title, snippet: "A new technology research article" }],
      fetchArticle: makeFetcher(new Map([[url, fixture]])),
      maxArticleChecks: 1,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      title,
      originalPublication: "ScienceDaily",
      originalUrl: url,
      accessibleUrl: url,
      contentStatus: "FULL_TEXT",
    });
  });

  it("rejects a readable topic index page instead of delivering it as an article", async () => {
    const url = "https://www.sciencedaily.com/news/matter_energy/technology";
    const body = articleBody("technology reporting and computing");
    const fixture = pageFor(url, "Technology News", body, "ScienceDaily");
    fixture.body = Buffer.from(
      fixture.body
        .toString("utf8")
        .replace("<meta property=\"og:site_name\"", "<meta property=\"og:type\" content=\"website\"><meta property=\"og:site_name\""),
    );
    const metrics = readingMetrics(body);
    const result = await collectEditorial({
      topics: ["Technology"],
      dailyArticleCount: 1,
      difficulty: metrics.difficulty ?? "Intermediate",
      readingBudgetMinutes: metrics.readingMinutes / 0.85,
    }, {
      search: async () => [{ url, title: "Technology News", snippet: "Latest technology news and reporting" }],
      fetchArticle: makeFetcher(new Map([[url, fixture]])),
      maxArticleChecks: 1,
    });

    expect(result.articles).toHaveLength(0);
    expect(result.status).toBe("NOT_DELIVERED");
    expect(result.trace.candidates.some(
      (candidate) => candidate.url === url && candidate.outcome === "REJECTED" && /index|category|listing/iu.test(candidate.reason),
    )).toBe(true);
  });
});

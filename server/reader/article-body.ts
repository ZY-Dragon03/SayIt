import { createHash } from "node:crypto";
import type { ArticleSummary } from "../../src/shared/reader-contract";

export function articleBodyHash(paragraphs: string[]): string {
  return createHash("sha256")
    .update(paragraphs.join("\n\n").toLowerCase())
    .digest("hex");
}

/** Checks the bytes and shape of a body already verified by Reader's extractor. */
export function isValidArchivedArticleBody(
  article: Pick<ArticleSummary, "contentStatus">,
  paragraphs: unknown,
  bodyHash: unknown,
): paragraphs is string[] {
  return (
    article.contentStatus === "FULL_TEXT" &&
    typeof bodyHash === "string" &&
    /^[a-f0-9]{64}$/u.test(bodyHash) &&
    Array.isArray(paragraphs) &&
    paragraphs.length > 0 &&
    paragraphs.every(
      (paragraph) =>
        typeof paragraph === "string" &&
        paragraph.length > 0 &&
        paragraph === paragraph.trim(),
    ) &&
    articleBodyHash(paragraphs as string[]) === bodyHash
  );
}

/** The newly delivered record must describe the exact body it archives. */
export function matchesArticleSummaryBody(
  article: Pick<ArticleSummary, "contentStatus" | "paragraphCount" | "wordCount">,
  paragraphs: unknown,
  bodyHash: unknown,
): paragraphs is string[] {
  if (!isValidArchivedArticleBody(article, paragraphs, bodyHash)) return false;
  if (paragraphs.length !== article.paragraphCount) return false;
  const normalizedBody = paragraphs.join("\n\n").replace(/\s+/gu, " ").trim();
  const wordCount = normalizedBody ? normalizedBody.split(" ").length : 0;
  return wordCount === article.wordCount;
}

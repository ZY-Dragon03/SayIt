/**
 * Text-shape helpers shared by the SayIt cache identity and Reader selection.
 * They live outside the Reader module so the shared cache can use them without
 * depending on Reader code.
 */

export function isSingleWordSelection(value: string): boolean {
  return /^[\p{L}][\p{L}'’\-]*$/u.test(value.trim());
}

export function normalizeCacheText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

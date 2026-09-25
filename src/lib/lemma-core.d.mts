export type LemmaLookup = (lemma: string) => boolean;

export function normalizeLexicalSurface(surface: string): string;
export function morphologyCandidates(surface: string): string[];
export function resolveLemma(
  surface: string,
  hasLemma: LemmaLookup,
): string | null;

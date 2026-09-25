const IRREGULAR_LEMMAS = new Map([
  ["children", "child"],
  ["men", "man"],
  ["women", "woman"],
  ["people", "person"],
  ["mice", "mouse"],
  ["geese", "goose"],
  ["went", "go"],
  ["gone", "go"],
  ["am", "be"],
  ["is", "be"],
  ["are", "be"],
  ["was", "be"],
  ["were", "be"],
  ["has", "have"],
  ["had", "have"],
  ["did", "do"],
  ["done", "do"],
]);

export function normalizeLexicalSurface(surface) {
  return surface
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "");
}

export function morphologyCandidates(surface) {
  const candidates = [];
  const add = (candidate) => {
    if (candidate && candidate !== surface && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  const irregular = IRREGULAR_LEMMAS.get(surface);
  if (irregular) add(irregular);

  if (surface.endsWith("ies") && surface.length > 4) {
    add(`${surface.slice(0, -3)}y`);
  }
  if (/(ches|shes|xes|zes)$/.test(surface) && surface.length > 4) {
    add(surface.slice(0, -2));
  }
  if (surface.endsWith("ses") && surface.length > 3) {
    add(surface.slice(0, -1));
    add(surface.slice(0, -2));
  }
  if (surface.endsWith("es") && surface.length > 3) {
    add(surface.slice(0, -2));
    add(surface.slice(0, -1));
  }
  if (surface.endsWith("s") && surface.length > 2) {
    add(surface.slice(0, -1));
  }
  if (surface.endsWith("ing") && surface.length > 5) {
    const stem = surface.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    if (/(.)\1$/.test(stem)) add(stem.slice(0, -1));
  }
  if (surface.endsWith("ed") && surface.length > 4) {
    const stem = surface.slice(0, -2);
    add(stem);
    add(`${stem}e`);
    if (/(.)\1$/.test(stem)) add(stem.slice(0, -1));
  }

  return candidates;
}

export function resolveLemma(surface, hasLemma) {
  const normalized = normalizeLexicalSurface(surface);
  if (!normalized) return null;
  if (hasLemma(normalized)) return normalized;
  return morphologyCandidates(normalized).find(hasLemma) ?? null;
}

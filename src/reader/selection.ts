import { MAX_INPUT_LENGTH } from "../shared/contract";

export function isSingleWordSelection(value: string): boolean {
  return /^[\p{L}][\p{L}'’\-]*$/u.test(value.trim());
}

export function findContainingSentence(text: string, selected: string): string {
  const normalizedText = text.replace(/\s+/gu, " ").trim();
  const normalizedSelection = selected.replace(/\s+/gu, " ").trim();
  if (!normalizedText) return normalizedSelection;

  const selectedAt = normalizedText
    .toLocaleLowerCase("en-US")
    .indexOf(normalizedSelection.toLocaleLowerCase("en-US"));
  if (selectedAt < 0) return normalizedText;
  const selectedEnd = selectedAt + normalizedSelection.length;

  const sentenceEnds = /[.!?](?:[”’"')\]]*)\s+/gu;
  let start = 0;
  let end = normalizedText.length;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnds.exec(normalizedText))) {
    const sentenceEnd = match.index + match[0].trimEnd().length;
    if (sentenceEnd <= selectedAt) {
      start = sentenceEnds.lastIndex;
      continue;
    }
    if (sentenceEnd >= selectedEnd) {
      end = sentenceEnd;
      break;
    }
  }
  return normalizedText.slice(start, end).trim() || normalizedText;
}

export function buildReaderInterpretationInput(
  selected: string,
  sentence: string,
): string | null {
  const expression = selected.trim().replace(/\s+/gu, " ");
  const context = sentence.trim().replace(/\s+/gu, " ");
  if (!expression || !context) return null;

  const prefix = `Interpret the selected expression “${expression}” in the context of this article sentence: “`;
  const suffix = `”`;
  if (prefix.length + suffix.length > MAX_INPUT_LENGTH) return null;

  const availableContextLength = MAX_INPUT_LENGTH - prefix.length - suffix.length;
  let boundedContext = context;
  if (boundedContext.length > availableContextLength) {
    const selectedAt = boundedContext
      .toLocaleLowerCase("en-US")
      .indexOf(expression.toLocaleLowerCase("en-US"));
    if (selectedAt < 0 || expression.length > availableContextLength - 2) {
      return null;
    }
    const remainder = availableContextLength - expression.length - 2;
    const leftLength = Math.min(selectedAt, Math.floor(remainder / 2));
    const rightLength = Math.min(
      boundedContext.length - selectedAt - expression.length,
      remainder - leftLength,
    );
    const left =
      leftLength < selectedAt
        ? `…${boundedContext.slice(selectedAt - leftLength + 1, selectedAt)}`
        : boundedContext.slice(0, selectedAt);
    const rightStart = selectedAt + expression.length;
    const right =
      rightLength < boundedContext.length - rightStart
        ? `${boundedContext.slice(rightStart, rightStart + rightLength - 1)}…`
        : boundedContext.slice(rightStart);
    boundedContext = `${left}${expression}${right}`;
  }

  const input = `${prefix}${boundedContext}${suffix}`;
  return input.length <= MAX_INPUT_LENGTH ? input : null;
}

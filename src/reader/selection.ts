import { segmentExplanatoryText } from "../lib/explanatory-text";
import { MAX_INPUT_LENGTH } from "../shared/contract";

export function isSingleWordSelection(value: string): boolean {
  return /^[\p{L}][\p{L}'’\-]*$/u.test(value.trim());
}

export function expandBoundaryOffset(
  text: string,
  offset: number,
  edge: "start" | "end",
): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const parts = segmentExplanatoryText(text);
  if (!parts) return clamped;
  for (const part of parts) {
    if (!part.isWordLike) continue;
    if (clamped > part.start && clamped < part.end) {
      return edge === "start" ? part.start : part.end;
    }
  }
  return clamped;
}

export function expandTextSelection(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; text: string } {
  const nextStart = expandBoundaryOffset(text, Math.min(start, end), "start");
  const nextEnd = expandBoundaryOffset(text, Math.max(start, end), "end");
  return {
    start: nextStart,
    end: nextEnd,
    text: text.slice(nextStart, nextEnd),
  };
}

export type ReaderContextKind = "title" | "body";

export interface ReaderSelectableSelection {
  text: string;
  context: string;
  contextKind: ReaderContextKind;
  singleWord: boolean;
  left: number;
  top: number;
}

function textPoint(
  container: Node,
  offset: number,
  selectableRoot: HTMLElement,
): { node: Text; offset: number } | null {
  if (!selectableRoot.contains(container)) return null;
  if (container.nodeType === Node.TEXT_NODE) {
    return { node: container as Text, offset };
  }
  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const element = container as Element;
  if (element.childNodes.length === 0) return null;
  const childIndex = Math.min(offset, element.childNodes.length - 1);
  const child = element.childNodes[childIndex];
  if (!child || child.nodeType !== Node.TEXT_NODE) return null;
  const node = child as Text;
  const atChildStart = offset < element.childNodes.length && element.childNodes[offset] === child;
  return { node, offset: atChildStart ? 0 : node.data.length };
}

function selectableRegion(node: Node, selectableRoot: HTMLElement): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const region = element?.closest<HTMLElement>("[data-reader-selectable]");
  if (!region || !selectableRoot.contains(region)) return null;
  return region;
}

function selectionContextKind(
  startRegion: HTMLElement,
  endRegion: HTMLElement,
): ReaderContextKind | null {
  const startKind = startRegion.dataset.readerSelectable;
  const endKind = endRegion.dataset.readerSelectable;
  if (startKind !== "title" && startKind !== "body") return null;
  if (startKind !== endKind) return null;
  if (startKind === "title" && startRegion !== endRegion) return null;
  return startKind;
}

export function expandSelectionToWordBoundaries(selectableRoot: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!selectableRoot.contains(range.commonAncestorContainer)) return;

  const startRegion = selectableRegion(range.startContainer, selectableRoot);
  const endRegion = selectableRegion(range.endContainer, selectableRoot);
  if (!startRegion || !endRegion || !selectionContextKind(startRegion, endRegion)) return;

  const start = textPoint(range.startContainer, range.startOffset, selectableRoot);
  const end = textPoint(range.endContainer, range.endOffset, selectableRoot);
  if (!start || !end) return;

  const nextStart = expandBoundaryOffset(start.node.data, start.offset, "start");
  const nextEnd = expandBoundaryOffset(end.node.data, end.offset, "end");
  if (
    nextStart === range.startOffset &&
    nextEnd === range.endOffset &&
    start.node === range.startContainer &&
    end.node === range.endContainer
  ) {
    return;
  }

  try {
    const expanded = range.cloneRange();
    expanded.setStart(start.node, nextStart);
    expanded.setEnd(end.node, nextEnd);
    if (expanded.collapsed) return;
    selection.removeAllRanges();
    selection.addRange(expanded);
  } catch {
    // Leave the browser selection unchanged when the endpoints cannot be expanded.
  }
}

export function readReaderSelection(selectableRoot: HTMLElement): ReaderSelectableSelection | null {
  expandSelectionToWordBoundaries(selectableRoot);
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const text = selection.toString().trim().replace(/\s+/gu, " ");
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!text || !range || !selectableRoot.contains(range.commonAncestorContainer)) return null;

  const startRegion = selectableRegion(range.startContainer, selectableRoot);
  const endRegion = selectableRegion(range.endContainer, selectableRoot);
  if (!startRegion || !endRegion) return null;
  const contextKind = selectionContextKind(startRegion, endRegion);
  if (!contextKind) return null;

  const context =
    contextKind === "title"
      ? (startRegion.textContent ?? "").replace(/\s+/gu, " ").trim()
      : findContainingSentence(startRegion.textContent ?? "", text);
  if (!context) return null;

  const rect =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : { left: 12, bottom: 28, top: 12, right: 12, width: 0, height: 16 };
  const width = 380;
  return {
    text,
    context,
    contextKind,
    singleWord: isSingleWordSelection(text),
    left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - width - 12)),
    top: Math.max(12, rect.bottom + 8),
  };
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

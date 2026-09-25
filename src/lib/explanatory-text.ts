export interface ExplanatoryTextPart {
  text: string;
  isWordLike: boolean;
  start: number;
  end: number;
}

const WORD_CONNECTOR = /^[\u0027\u2019\u02bc\u002d\u2010\u2011]+$/u;

export function segmentExplanatoryText(
  text: string,
): ExplanatoryTextPart[] | null {
  if (typeof Intl.Segmenter !== "function") return null;

  let segments: Intl.SegmentData[];
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "word" });
    segments = Array.from(segmenter.segment(text));
  } catch {
    return null;
  }

  const parts: ExplanatoryTextPart[] = [];
  let index = 0;
  while (index < segments.length) {
    const current = segments[index];
    if (!current.isWordLike) {
      parts.push({
        text: current.segment,
        isWordLike: false,
        start: current.index,
        end: current.index + current.segment.length,
      });
      index += 1;
      continue;
    }

    let word = current.segment;
    let end = current.index + current.segment.length;
    let nextIndex = index + 1;
    while (nextIndex < segments.length) {
      let connector = "";
      let connectorEnd = nextIndex;
      while (
        connectorEnd < segments.length &&
        !segments[connectorEnd].isWordLike &&
        WORD_CONNECTOR.test(segments[connectorEnd].segment)
      ) {
        connector += segments[connectorEnd].segment;
        connectorEnd += 1;
      }
      const nextWord = segments[connectorEnd];
      if (!connector || !nextWord?.isWordLike) break;

      word += `${connector}${nextWord.segment}`;
      end = nextWord.index + nextWord.segment.length;
      nextIndex = connectorEnd + 1;
    }

    parts.push({
      text: word,
      isWordLike: true,
      start: current.index,
      end,
    });
    index = nextIndex;
  }

  return parts;
}

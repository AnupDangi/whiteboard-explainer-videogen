/** General language and text handling. No per-language special-casing: every script is
 *  segmented by the runtime's Unicode rules (Intl.Segmenter), so Latin, Chinese,
 *  Devanagari and everything else work the same way. Ported from the v4 branch. */
const WORD_SEGMENTER = new Intl.Segmenter(undefined, {granularity: 'word'});

/** Word-like segments for any script (Chinese words, Devanagari words, Latin words, ...). */
export function segmentWords(text: string): string[] {
  const out: string[] = [];
  for (const part of WORD_SEGMENTER.segment(String(text ?? ''))) if (part.isWordLike) out.push(part.segment);
  return out;
}

export function countWords(text: string): number {return segmentWords(text).length;}

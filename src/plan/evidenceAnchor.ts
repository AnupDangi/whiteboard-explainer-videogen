import { resolveSourceEvidence, type SourceDoc, type SourceEvidenceRef } from '../intake/sourceDoc.js';

/**
 * Deterministic evidence anchoring. A model quote is mapped back to the exact
 * source substring when it differs only by typography (quotes, dashes,
 * ellipsis, ligatures, accents, non-breaking and invisible characters),
 * whitespace runs, a word split across a line end, or leading/trailing
 * punctuation, or when an identical quote is cited under the wrong span and
 * occurs in exactly one other span. The stored quote is always the verbatim
 * source text. No fuzzy, semantic, or paraphrase matching exists here.
 */
export type AnchorMatch = 'exact' | 'normalized' | 'relocated';
export interface AnchoredEvidence { ref: SourceEvidenceRef; match: AnchorMatch }
export const MIN_RELOCATION_CHARS = 12;

const CHAR_MAP: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2033': '"',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
};
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/u;
const COMBINING_MARK = /\p{M}/gu;

/**
 * How a word split at a line end (`envi-\nsioned`, `well-\nknown`) is read:
 * `join` drops the hyphen and the break, `keep-hyphen` drops only the break.
 */
export type SoftBreak = 'join' | 'keep-hyphen';

/** Folded text plus, for each folded character, its index in the original text. */
export function normalizeForAnchor(text: string, softBreak: SoftBreak = 'join'): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length;) {
    const raw = String.fromCodePoint(text.codePointAt(i)!);
    const width = raw.length;
    // A PDF line break inside a word. The offset map keeps the accepted
    // citation the exact source substring, including its hyphen and newline.
    if (raw === '-' && /\p{L}/u.test(text[i - 1] ?? '')) {
      const lineBreak = /^-[ \t]*\r?\n[ \t]*(?=\p{L})/u.exec(text.slice(i));
      if (lineBreak) {
        if (softBreak === 'keep-hyphen') { normalized += '-'; map.push(i); lastWasSpace = false; }
        i += lineBreak[0].length;
        continue;
      }
    }
    if (INVISIBLE.test(raw)) { i += width; continue; }
    const folded = (CHAR_MAP[raw] ?? raw).normalize('NFKD').replace(COMBINING_MARK, '');
    for (const c of folded) {
      if (/\s/u.test(c)) {
        if (lastWasSpace) continue;
        normalized += ' '; map.push(i); lastWasSpace = true;
      } else { normalized += c; map.push(i); lastWasSpace = false; }
    }
    i += width;
  }
  return { normalized, map };
}

const EDGE_PUNCTUATION = /^[\s"'.,;:!?]+|[\s"'.,;:!?]+$/g;
/** The quote folded first, then stripped of edge quotes and punctuation (so curly edge quotes go too). */
const anchorNeedle = (quote: string): string => normalizeForAnchor(quote).normalized.replace(EDGE_PUNCTUATION, '');

function findNormalized(spanText: string, needle: string): { start: number; end: number } | undefined {
  if (!needle) return undefined;
  for (const softBreak of ['join', 'keep-hyphen'] as const) {
    const { normalized, map } = normalizeForAnchor(spanText, softBreak);
    const at = normalized.indexOf(needle);
    if (at >= 0) return { start: map[at]!, end: map[at + needle.length - 1]! + originalWidth(spanText, map[at + needle.length - 1]!) };
  }
  return undefined;
}

const originalWidth = (text: string, index: number): number => String.fromCodePoint(text.codePointAt(index)!).length;

export function anchorQuote(doc: SourceDoc, spanId: string, quote: string): AnchoredEvidence | undefined {
  const exact = resolveSourceEvidence(doc, spanId, quote);
  if (exact) return { ref: exact, match: 'exact' };
  const needle = anchorNeedle(quote);
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (span) {
    const hit = findNormalized(span.text, needle);
    if (hit) {
      const ref = resolveSourceEvidence(doc, spanId, span.text.slice(hit.start, hit.end));
      if (ref) return { ref, match: 'normalized' };
    }
  }
  if (needle.length < MIN_RELOCATION_CHARS) return undefined;
  const matches = doc.spans.filter((candidate) => candidate.id !== spanId && findNormalized(candidate.text, needle));
  if (matches.length !== 1) return undefined;
  const target = matches[0]!;
  const hit = findNormalized(target.text, needle)!;
  const ref = resolveSourceEvidence(doc, target.id, target.text.slice(hit.start, hit.end));
  return ref ? { ref, match: 'relocated' } : undefined;
}

const contentTokens = (value: string): Set<string> => new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 3));

/**
 * Last resort for a quote that cannot be anchored although its span ID is right (text extraction split the words the model
 * copied): cite the sentence of that span that shares the most content words with what the model wrote. The result is
 * always a verbatim sentence of the cited span, never a rewrite; callers record that the quote was snapped.
 */
export function nearestSpanSentence(doc: SourceDoc, spanId: string, hint: string): string | undefined {
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (!span) return undefined;
  const wanted = contentTokens(hint);
  if (!wanted.size) return undefined;
  const sentences = span.text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 20 && sentence.length <= 600);
  let best: { sentence: string; score: number } | undefined;
  for (const sentence of sentences) {
    const tokens = contentTokens(sentence);
    const shared = [...wanted].filter((token) => tokens.has(token)).length;
    if (shared > (best?.score ?? 0)) best = { sentence, score: shared };
  }
  return best && best.score >= 2 && anchorQuote(doc, spanId, best.sentence) ? best.sentence : undefined;
}

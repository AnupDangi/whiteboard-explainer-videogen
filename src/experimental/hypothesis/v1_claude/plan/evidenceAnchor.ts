import { resolveSourceEvidence, type SourceDoc, type SourceEvidenceRef } from './sourceDoc.js';

/**
 * Deterministic evidence anchoring. A model quote is mapped back to the exact
 * source substring when it differs only by typography (quotes, dashes,
 * ellipsis, non-breaking space), whitespace runs, or leading/trailing
 * punctuation, or when an identical quote is cited under the wrong span and
 * occurs in exactly one other span. The stored quote is always the verbatim
 * source text. No fuzzy, semantic, or paraphrase matching exists here.
 */
export type AnchorMatch = 'exact' | 'normalized' | 'relocated';
export interface AnchoredEvidence { ref: SourceEvidenceRef; match: AnchorMatch }
export const MIN_RELOCATION_CHARS = 12;

const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Normalized text plus, for each normalized character, its index in the original text. */
export function normalizeForAnchor(text: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    if (raw === '…') {
      for (const c of '...') { normalized += c; map.push(i); }
      lastWasSpace = false;
      continue;
    }
    const c = CHAR_MAP[raw] ?? raw;
    if (/\s/.test(c)) {
      if (lastWasSpace) continue;
      normalized += ' '; map.push(i); lastWasSpace = true;
      continue;
    }
    normalized += c; map.push(i); lastWasSpace = false;
  }
  return { normalized, map };
}

const trimQuote = (quote: string): string => quote.replace(/^[\s"'.,;:!?]+|[\s"'.,;:!?]+$/g, '');

function findNormalized(spanText: string, quote: string): { start: number; end: number } | undefined {
  const needle = normalizeForAnchor(trimQuote(quote)).normalized;
  if (!needle) return undefined;
  const { normalized, map } = normalizeForAnchor(spanText);
  const at = normalized.indexOf(needle);
  if (at < 0 || normalized.indexOf(needle, at + 1) >= 0) return undefined;
  return { start: map[at], end: map[at + needle.length - 1] + 1 };
}

export function anchorQuote(doc: SourceDoc, spanId: string, quote: string): AnchoredEvidence | undefined {
  const exact = resolveSourceEvidence(doc, spanId, quote);
  if (exact) return { ref: exact, match: 'exact' };
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (span) {
    const hit = findNormalized(span.text, quote);
    if (hit) {
      const ref = resolveSourceEvidence(doc, spanId, span.text.slice(hit.start, hit.end));
      if (ref) return { ref, match: 'normalized' };
    }
  }
  if (trimQuote(quote).length < MIN_RELOCATION_CHARS) return undefined;
  const matches = doc.spans.filter((candidate) => candidate.id !== spanId && findNormalized(candidate.text, quote));
  if (matches.length !== 1) return undefined;
  const target = matches[0];
  const hit = findNormalized(target.text, quote)!;
  const ref = resolveSourceEvidence(doc, target.id, target.text.slice(hit.start, hit.end));
  return ref ? { ref, match: 'relocated' } : undefined;
}

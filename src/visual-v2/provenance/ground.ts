/**
 * Source grounding for equations (V2 plan Phase 8). A `source` equation or derivation line is only accepted when the model
 * cites a source span and quote, the citation resolves to verbatim source text, and the formula is consistent with that text.
 * This does not prove the maths; it proves the formula is not invented relative to the cited source.
 */
export interface Grounding {
  /** The verbatim source quote a model citation resolves to, or undefined when the span or quote cannot be found. */
  verify(spanId: string, quote: string): string | undefined;
}

export interface SourceCitation { spanId: string; quote: string }

const numbersOf = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];
const compact = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What the formula says that the quote must also say: its numbers, and every multi-letter word it names (macros excluded). */
export function formulaProblem(latex: string, quote: string): string | undefined {
  const stripped = latex.replace(/\\[a-zA-Z]+/g, ' ');
  const haystack = compact(quote);
  const quoteNumbers = new Set(numbersOf(quote));
  const missingNumber = numbersOf(stripped).find((n) => !quoteNumbers.has(n));
  if (missingNumber) return `the number ${missingNumber} is not in the cited source text`;
  const missingWord = (stripped.toLowerCase().match(/[a-z]{2,}/g) ?? []).find((word) => !haystack.includes(word));
  if (missingWord) return `"${missingWord}" is not in the cited source text`;
  return undefined;
}

/** Problems with a source-provenance formula, as a message for the model; undefined when grounded. */
export function sourceFormulaProblem(latex: string, citation: SourceCitation | undefined, grounding: Grounding | undefined): string | undefined {
  if (!citation) return 'a source equation needs evidence {spanId, quote} copied from the source; otherwise mark it derived or illustrative';
  if (!grounding) return 'no source is available to check this source equation against; mark it derived or illustrative';
  const verbatim = grounding.verify(citation.spanId, citation.quote);
  if (verbatim === undefined) return `evidence span ${citation.spanId} does not contain that quote; copy it verbatim from the source`;
  const mismatch = formulaProblem(latex, verbatim);
  return mismatch ? `the equation does not match its evidence: ${mismatch}` : undefined;
}

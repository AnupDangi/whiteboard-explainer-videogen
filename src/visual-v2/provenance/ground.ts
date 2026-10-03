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

/** Lexical source consistency, not a proof that the cited statement is true. Never infer a relationship from labels alone. */
const DECIMAL_ZEROES = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];
const asciiDigit = (digit: string): string => {
  const code = digit.codePointAt(0)!;
  const zero = DECIMAL_ZEROES.find((base) => code >= base && code < base + 10);
  return zero === undefined ? digit : String(code - zero);
};
const normalized = (text: string): string => text.normalize('NFKC').replace(/\p{Nd}/gu, asciiDigit).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const containsPhrase = (quote: string, phrase: string): boolean => {
  const value = normalized(phrase);
  return value.length > 0 && ` ${normalized(quote)} `.includes(` ${value} `);
};

export function sourceTextProblem(assertions: readonly string[], citation: SourceCitation | undefined, grounding: Grounding | undefined, subject: string): string | undefined {
  if (!citation) return `a source ${subject} needs evidence {spanId, quote} copied from the source`;
  if (!grounding) return `no source is available to check this source ${subject} against`;
  const verbatim = grounding.verify(citation.spanId, citation.quote);
  if (verbatim === undefined) return `evidence span ${citation.spanId} does not contain that quote; copy it verbatim from the source`;
  const absent = assertions.find((text) => !containsPhrase(verbatim, text));
  return absent === undefined ? undefined : `the source ${subject} asserts ${JSON.stringify(absent)}, which is absent from its cited quote`;
}

/** Every displayed scalar in source kit parameters must occur in the citation. Boolean/layout-only params carry no source fact. */
export function factualKitScalars(value: unknown): string[] {
  if (typeof value === 'number' || typeof value === 'string') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(factualKitScalars);
  if (value && typeof value === 'object') return Object.values(value).flatMap(factualKitScalars);
  return [];
}

/** An edge requires an anchored quote containing the directed subject, relation, and object in that order. */
export function sourceEdgeProblem(from: string | undefined, relation: string, to: string | undefined, citation: SourceCitation | undefined, grounding: Grounding | undefined): string | undefined {
  if (!from || !to) return 'the factual edge endpoints need displayed names before the relationship can be grounded';
  const mismatch = sourceTextProblem([from, relation, to], citation, grounding, 'edge');
  if (mismatch) return mismatch;
  const quote = normalized(grounding!.verify(citation!.spanId, citation!.quote)!);
  const start = quote.indexOf(normalized(from));
  const middle = quote.indexOf(normalized(relation), start + normalized(from).length);
  const end = quote.indexOf(normalized(to), middle + normalized(relation).length);
  return start >= 0 && middle > start && end > middle ? undefined : 'the cited quote does not state this directed subject–relation–object sequence; use a matching quote or change the edge';
}

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

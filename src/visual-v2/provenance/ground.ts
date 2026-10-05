/**
 * Source grounding for equations (V2 plan Phase 8). A `source` equation or derivation line is only accepted when the model
 * cites a source span and quote, the citation resolves to verbatim source text, and the formula is consistent with that text.
 * This does not prove the maths; it proves the formula is not invented relative to the cited source.
 */
export interface Grounding {
  /** The verbatim source quote a model citation resolves to, or undefined when the span or quote cannot be found. */
  verify(spanId: string, quote: string): string | undefined;
  /** The full text of a source span, when known; lets a repair offer the sentence that states a formula. */
  spanText?(spanId: string): string | undefined;
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
/** Space-delimited alphabets only; for other scripts a phrase must appear verbatim. */
const SPACE_DELIMITED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{M}\s]+$/u;
/** Inflection-tolerant stem: long words match on their first five letters ("selective"/"selectively"), short words and numbers exactly (minus a plural s). */
const stemOf = (word: string): string => (/^\p{N}+$/u.test(word) ? word : word.length >= 6 ? word.slice(0, 5) : word.length >= 4 ? word.replace(/s$/, '') : word);
/**
 * A source label may be a tidy form of what the quote says. Every word of the label must still appear in the quote, up to
 * inflection; a number or a word the quote lacks is never excused. Lexical consistency, not proof that the quote supports it.
 */
const mentionsAllWords = (quote: string, phrase: string): boolean => {
  const value = normalized(phrase);
  if (!value || !SPACE_DELIMITED.test(value)) return false;
  const have = new Set(normalized(quote).split(' ').map(stemOf));
  return value.split(' ').every((word) => have.has(stemOf(word)));
};

interface SemanticSignal { value: string; pattern: RegExp }
interface SemanticSignalFamily { name: string; signals: SemanticSignal[] }
const semanticSignalFamilies: SemanticSignalFamily[] = [
  { name: 'polarity', signals: [{ value: 'negative', pattern: /\b(?:not|no|never|without|cannot|can not|can't|doesn't|does not|isn't|is not|aren't|are not|won't|will not|neither|nor)\b/u }] },
  { name: 'comparison', signals: [
    { value: 'unequal', pattern: /\b(?:unequal|not equal(?:s| to)?|different from|≠|!=)\b/u },
    { value: 'at-most', pattern: /\b(?:at most|no more than|up to)\b/u },
    { value: 'at-least', pattern: /\b(?:at least|no less than)\b/u },
    { value: 'less', pattern: /\b(?:less(?: than)?|fewer(?: than)?|lower(?: than)?|below|under)\b/u },
    { value: 'greater', pattern: /\b(?:greater(?: than)?|more(?: than)?|higher(?: than)?|above|over)\b/u },
    { value: 'equal', pattern: /\b(?:equal(?:s| to)?|the same as|exactly)\b/u },
  ] },
  { name: 'change direction', signals: [
    { value: 'increase', pattern: /\b(?:increase(?:s|d)?|rise(?:s|n)?|grow(?:s|n)?|go(?:es)? up|become(?:s)? larger)\b/u },
    { value: 'decrease', pattern: /\b(?:decrease(?:s|d)?|fall(?:s|en)?|drop(?:s|ped)?|go(?:es)? down|become(?:s)? smaller)\b/u },
  ] },
  { name: 'polarity descriptor', signals: [
    { value: 'positive', pattern: /\bpositive\b/u },
    { value: 'negative', pattern: /\bnegative\b/u },
  ] },
  { name: 'temporal order', signals: [
    { value: 'before', pattern: /\b(?:before|earlier than|prior to)\b/u },
    { value: 'after', pattern: /\b(?:after|later than|following)\b/u },
    { value: 'during', pattern: /\b(?:during|while|throughout)\b/u },
  ] },
  { name: 'spatial relation', signals: [
    { value: 'inside', pattern: /\b(?:inside|within|in the interior of)\b/u },
    { value: 'outside', pattern: /\b(?:outside|beyond|external to)\b/u },
  ] },
  { name: 'quantity scope', signals: [
    { value: 'all', pattern: /\ball\b/u },
    { value: 'some', pattern: /\bsome\b/u },
    { value: 'none', pattern: /\b(?:none|no)\b/u },
  ] },
  { name: 'extreme', signals: [
    { value: 'minimum', pattern: /\b(?:minimum|minimal|least)\b/u },
    { value: 'maximum', pattern: /\b(?:maximum|maximal|most)\b/u },
  ] },
  { name: 'condition or exception', signals: [
    { value: 'conditional', pattern: /\b(?:if|when|only if|only when|provided that)\b/u },
    { value: 'exception', pattern: /\b(?:except|unless)\b/u },
  ] },
];
const cuePattern = (family: SemanticSignalFamily): RegExp => new RegExp(family.signals.map(({ pattern }) => pattern.source.replace(/^\\b|\\b$/g, '')).join('|'), 'u');
const signalOf = (family: SemanticSignalFamily, text: string): SemanticSignal | undefined => family.signals.find(({ pattern }) => pattern.test(text));
const assertionClauses = (quote: string): string[] => quote
  .split(/[.!?;,]+|\b(?:but|whereas|although|and|or)\b/iu)
  .map((clause) => clause.trim())
  .filter(Boolean);
function bestMatchingClause(quote: string, assertion: string): string {
  const words = normalized(assertion).split(' ').filter(Boolean);
  const clauses = assertionClauses(quote);
  const score = (clause: string): number => words.reduce((count, word) => count + (containsPhrase(clause, word) || mentionsAllWords(clause, word) ? 1 : 0), 0);
  return clauses.map(normalized).sort((a, b) => score(b) - score(a))[0] ?? normalized(quote);
}
const signalWords = new Set(semanticSignalFamilies.flatMap((family) => family.signals.flatMap(({ pattern }) => pattern.source.match(/[a-z]{3,}/giu) ?? [])));
const QUALIFIER_MATCH_STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'does', 'do', 'did', 'has', 'have', 'had', 'of', 'to']);
const semanticText = (text: string): string => normalized(text
  .replace(/≠|!=/gu, ' not equal ')
  .replace(/≤|<=/gu, ' at most ')
  .replace(/≥|>=/gu, ' at least ')
  .replace(/</gu, ' less than ')
  .replace(/>/gu, ' greater than ')
  .replace(/=/gu, ' equal '));
/** Reject explicit operator reversals and cue deletion when the remaining assertion is the quoted proposition's core. */
function semanticSignalProblem(quote: string, assertion: string): string | undefined {
  const claim = semanticText(assertion);
  const clause = bestMatchingClause(quote, assertion);
  if (!claim || !clause) return undefined;
  for (const family of semanticSignalFamilies) {
    const inQuote = signalOf(family, semanticText(clause));
    const inClaim = signalOf(family, claim);
    if (inClaim && (!inQuote || inClaim.value !== inQuote.value)) {
      return `the source ${family.name} is ${inQuote?.value ?? 'unstated'}, but the assertion uses ${inClaim.value}`;
    }
    if (inQuote && !inClaim) {
      const core = semanticText(clause).replace(cuePattern(family), ' ');
      const assertionWords = claim.split(' ').filter((word) => word && !QUALIFIER_MATCH_STOPWORDS.has(word));
      const coreWords = core.split(' ').filter((word) => word && !QUALIFIER_MATCH_STOPWORDS.has(word));
      // Short concept names (for example, "mitosis") do not assert the surrounding clause's time or scope.
      // Multiword propositions and explicit semantic operators must retain any qualifier attached to their wording.
      const hasSemanticOperator = assertionWords.some((word) => signalWords.has(word));
      const coreIsThisAssertion = coreWords.length > 0 && coreWords.length === assertionWords.length && coreWords.every((word, index) => stemOf(word) === stemOf(assertionWords[index]!));
      if ((assertionWords.length >= 2 || hasSemanticOperator) && coreIsThisAssertion) {
        return `the assertion omits the source ${family.name} qualifier ${inQuote.value}`;
      }
    }
  }
  return undefined;
}

/** Check claim-bound visual wording against the canonical claim even if the visual is labelled illustrative. */
export function sourceClaimSemanticProblem(claim: string, assertion: string): string | undefined {
  return semanticSignalProblem(claim, assertion);
}

export function sourceTextProblem(assertions: readonly string[], citation: SourceCitation | undefined, grounding: Grounding | undefined, subject: string): string | undefined {
  if (!citation) return `a source ${subject} needs evidence {spanId, quote} copied from the source`;
  if (!grounding) return `no source is available to check this source ${subject} against`;
  const verbatim = grounding.verify(citation.spanId, citation.quote);
  if (verbatim === undefined) return `evidence span ${citation.spanId} does not contain that quote; copy it verbatim from the source`;
  for (const assertion of assertions) {
    const contradiction = semanticSignalProblem(verbatim, assertion);
    if (contradiction) return `the source ${subject} does not support semantic assertion ${JSON.stringify(assertion)}: ${contradiction}; preserve the source operator or mark your own wording derived or illustrative`;
  }
  const absent = assertions.find((text) => !containsPhrase(verbatim, text) && !mentionsAllWords(verbatim, text));
  return absent === undefined ? undefined : `the source ${subject} asserts ${JSON.stringify(absent)}, which is absent from its cited quote; use words that appear in the quote, or mark it provenance "derived" or "illustrative" if it is your own wording`;
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
  if (start < 0 || middle <= start || end <= middle) return 'the cited quote does not state this directed subject–relation–object sequence; use a matching quote or change the edge';
  // Lexical order alone can invert a claim: "light does not cause heat" contains all three terms.
  // Treat scoped negation and qualification as unsupported rather than promoting a positive edge.
  const clause = quote.slice(0, end + normalized(to).length);
  if (unsupportedQualifier(clause)) return 'the cited relationship is negated or qualified; use an explicit supported claim or remove the factual edge';
  return undefined;
}

const unsupportedQualifier = (text: string): boolean => /\b(?:not|never|no|without|false|neither|nor|cannot|can't|doesn't|isn't|unlikely|may|might|possibly|perhaps|approximately|roughly|only if|only when|unless|except|if)\b/u.test(text);
const mathText = (text: string): string => text
  .replace(/\\(?:mathrm|text)\{([^{}]+)\}/g, '$1')
  // Subscripts are notation, not content: R_{total}, R_total and Rtotal are the same symbol; so are R_1 and R1.
  // A fraction is the same expression as its slash form: \frac{V}{R} is V / R. Compound parts keep their parentheses.
  .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => `${/^[A-Za-z0-9_]+$/.test(a) ? a : `(${a})`}/${/^[A-Za-z0-9_]+$/.test(b) ? b : `(${b})`}`)
  .replace(/_\{([^{}]*)\}/g, '$1')
  .replace(/_/g, '')
  .replace(/\\sqrt\b/g, 'sqrt')
  .replace(/\{/g, '(')
  .replace(/\}/g, ')')
  .normalize('NFKC')
  .replace(/\p{Nd}/gu, asciiDigit)
  .toLowerCase();
const mathTokens = (text: string): string[] => mathText(text).match(/[\p{L}\p{N}_]+|[=+\-*/^()[\]{}<>]/gu) ?? [];
const numbersOf = (text: string): string[] => mathText(text).match(/\d+(?:\.\d+)?/g) ?? [];
const compact = (text: string): string => mathText(text).replace(/[^\p{L}\p{N}]/gu, '');
const operator = (token: string | undefined): boolean => token !== undefined && /^[=+\-*/^<>]$/.test(token);

/** A source formula needs matching symbols and operators in sequence, with no unsupported qualifier. */
export function formulaProblem(latex: string, quote: string): string | undefined {
  const stripped = latex.replace(/\\[a-zA-Z]+/g, ' ');
  const haystack = compact(quote);
  const quoteNumbers = new Set(numbersOf(quote));
  const missingNumber = numbersOf(stripped).find((n) => !quoteNumbers.has(n));
  if (missingNumber) return `the number ${missingNumber} is not in the cited source text`;
  const missingWord = (stripped.toLowerCase().match(/[a-z]{2,}/g) ?? []).find((word) => !haystack.includes(word));
  if (missingWord) return `"${missingWord}" is not in the cited source text`;
  // Require the same ordered expression, including operators and exponents. A bag of
  // matching numbers/words is insufficient (3+4=5 differs from 3^2+4^2=5^2).
  if (/\\(?!mathrm\b|text\b|sqrt\b|frac\b)[a-zA-Z]+/.test(latex)) return 'the equation uses notation that cannot be checked against the cited source text';
  const expected = mathTokens(latex);
  const actual = mathTokens(quote);
  const matches = expected.length > 0 && actual.some((_, index) =>
    expected.every((token, offset) => actual[index + offset] === token)
    && !operator(actual[index - 1]) && !operator(actual[index + expected.length]));
  if (!matches) return 'the equation structure, operators, exponents, or variables do not match the cited source text';
  if (unsupportedQualifier(quote.toLowerCase())) return 'the cited equation is negated or qualified and cannot support an unconditional formula';
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

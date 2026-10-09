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

import { z } from 'zod';
import { KIT_REGISTRY } from '../kits/registry.js';
import type { KitName } from '../board-ops/types.js';

/** Lexical source consistency, not a proof that the cited statement is true. Never infer a relationship from labels alone. */
const DECIMAL_ZEROES = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];
const asciiDigit = (digit: string): string => {
  const code = digit.codePointAt(0)!;
  const zero = DECIMAL_ZEROES.find((base) => code >= base && code < base + 10);
  return zero === undefined ? digit : String(code - zero);
};
const normalized = (text: string): string => text.normalize('NFKC').replace(/\p{Nd}/gu, asciiDigit).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
/** Singular stem for source-word matching: "solutes" grounds "solute" (the same fact, not a weakened check). */
const stem = (word: string): string => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const containsPhrase = (quote: string, phrase: string): boolean => {
  const haystack = normalized(quote).split(' ').filter(Boolean);
  const needle = normalized(phrase).split(' ').filter(Boolean);
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((word, j) => stem(haystack[i + j]!) === stem(word))) return true;
  }
  return false;
};

export function sourceTextProblem(assertions: readonly string[], citation: SourceCitation | undefined, grounding: Grounding | undefined, subject: string): string | undefined {
  if (!citation) return `a source ${subject} needs evidence {spanId, quote} copied from the source`;
  if (!grounding) return `no source is available to check this source ${subject} against`;
  const verbatim = grounding.verify(citation.spanId, citation.quote);
  if (verbatim === undefined) return `evidence span ${citation.spanId} does not contain that quote; copy it verbatim from the source`;
  const absent = assertions.find((text) => !containsPhrase(verbatim, text));
  return absent === undefined ? undefined : `the source ${subject} asserts ${JSON.stringify(absent)}, which is absent from its cited quote; use the quote's own words as the label, or cite a quote containing the label word for word`;
}

/** Param keys that place or arrange instead of stating: zone ids, slots, regions, orientations. Their words are compiler vocabulary, never source facts. */
const LAYOUT_PARAM_KEYS = new Set(['zones', 'zone', 'slot', 'slots', 'region', 'regions', 'layout', 'orientation', 'arrangement', 'position', 'anchor', 'align']);

/** Zod v4 internals: every schema carries its kind at `_zod.def.type` (string, object, enum, array, optional, ...). */
type Zod4Def = { type?: string; innerType?: z.ZodType; shape?: Record<string, z.ZodType>; element?: z.ZodType };
const zodDef = (schema: z.ZodType): Zod4Def => ((schema as unknown as { _zod?: { def?: Zod4Def } })._zod?.def ?? {}) as Zod4Def;

const unwrap = (schema: z.ZodType): z.ZodType => {
  let current: z.ZodType = schema;
  for (;;) {
    const def = zodDef(current);
    if ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable' || def.type === 'readonly' || def.type === 'nonoptional') && def.innerType) current = def.innerType;
    else return current;
  }
};

/** Schema-aware factual params: free strings and numbers a kit displays or counts are source assertions; closed-vocabulary enums, booleans, and layout keys are compiler vocabulary grounded by the citation itself, not by wording. */
function factualBySchema(schema: z.ZodType, value: unknown): string[] {
  const field = unwrap(schema);
  const name = zodDef(field).type ?? '';
  if (name === 'enum' || name === 'boolean' || name === 'literal') return [];
  if (name === 'number') return typeof value === 'number' ? [String(value)] : [];
  if (name === 'string') return typeof value === 'string' ? [value] : [];
  if (name === 'array') {
    const element = zodDef(field).element;
    return Array.isArray(value) && element ? value.flatMap((item) => factualBySchema(element, item)) : [];
  }
  if (name === 'object') {
    const shape = zodDef(field).shape;
    if (!shape || !value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    return Object.entries(shape).flatMap(([key, sub]) => (LAYOUT_PARAM_KEYS.has(key) ? [] : factualBySchema(sub, record[key])));
  }
  return factualKitScalars(value);
}

/** Every displayed scalar in source kit parameters must occur in the citation. Boolean/layout-only params carry no source fact. */
export function factualKitScalars(value: unknown, kit?: KitName): string[] {
  if (kit) {
    try {
      const schema = KIT_REGISTRY[kit].paramsSchema as z.ZodType;
      if (zodDef(unwrap(schema)).type === 'object') return factualBySchema(schema, value);
    } catch { /* unknown kit: fall through to the flat legacy reading */ }
  }
  if (typeof value === 'number' || typeof value === 'string') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => factualKitScalars(item));
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => factualKitScalars(item));
  return [];
}

/** An edge requires an anchored quote containing the directed subject, relation, and object in that order. */
export function sourceEdgeProblem(from: string | undefined, relation: string, to: string | undefined, citation: SourceCitation | undefined, grounding: Grounding | undefined): string | undefined {
  if (!from || !to) return 'the factual edge endpoints need displayed names before the relationship can be grounded';
  // Process-flow verbs (causes/feeds/produces) rarely appear literally in prose
  // ("current flows and the capacitor charges" states causation without the word
  // "causes"). For these, endpoint order plus the negation guard below is the
  // check; the relation word itself is compiler vocabulary. Contrast relations
  // (opposes/excepts/compares/...) keep the strict word requirement because
  // their wording is the claim.
  const ProcessRelations = new Set(['causes', 'feeds', 'produces']);
  // Multi-word relations ("net flow toward") ground word by word in order:
  // every word must occur, but they need not form one literal phrase, since
  // prose states relations structurally ("net flow of water toward...").
  const relWords = normalized(relation).split(' ').filter(Boolean);
  const mismatch = sourceTextProblem(ProcessRelations.has(relation) ? [from, to] : [from, ...relWords, to], citation, grounding, 'edge');
  if (mismatch) return mismatch;
  const quote = normalized(grounding!.verify(citation!.spanId, citation!.quote)!);
  const start = quote.indexOf(normalized(from));
  if (ProcessRelations.has(relation)) {
    const end = quote.indexOf(normalized(to), start + normalized(from).length);
    if (start < 0 || end <= start) return 'the cited quote does not state this directed subject–object sequence; use a matching quote or change the edge';
    const clause = quote.slice(0, end + normalized(to).length);
    if (unsupportedQualifier(clause)) return 'the cited relationship is negated or qualified; use an explicit supported claim or remove the factual edge';
    return undefined;
  }
  let cursor = start + normalized(from).length;
  for (const word of relWords) {
    const at = quote.indexOf(word, cursor);
    if (at < 0) return 'the cited quote does not state this directed subject–relation–object sequence; use a matching quote or change the edge';
    cursor = at + word.length;
  }
  const end = quote.indexOf(normalized(to), cursor);
  if (start < 0 || end < 0) return 'the cited quote does not state this directed subject–relation–object sequence; use a matching quote or change the edge';
  // Lexical order alone can invert a claim: "light does not cause heat" contains all three terms.
  // Treat scoped negation and qualification as unsupported rather than promoting a positive edge.
  const clause = quote.slice(0, end + normalized(to).length);
  if (unsupportedQualifier(clause)) return 'the cited relationship is negated or qualified; use an explicit supported claim or remove the factual edge';
  return undefined;
}

const unsupportedQualifier = (text: string): boolean => /\b(?:not|never|no|without|false|neither|nor|cannot|can't|doesn't|isn't|unlikely|may|might|possibly|perhaps|approximately|roughly|only if|only when|unless|except|if)\b/u.test(text);
const mathText = (text: string): string => text
  .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
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
  if (/\\(?!mathrm\b|sqrt\b)[a-zA-Z]+/.test(latex)) return 'the equation uses notation that cannot be checked against the cited source text';
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

import { z } from 'zod';

const ClaimSignalSchema = z.discriminatedUnion('family', [
  z.object({ family: z.literal('change_direction'), value: z.enum(['increase', 'decrease']) }).strict(),
  z.object({ family: z.literal('spatial_relation'), value: z.enum(['inside', 'outside']) }).strict(),
  z.object({ family: z.literal('quantity_scope'), value: z.enum(['all', 'some', 'none']) }).strict(),
  z.object({ family: z.literal('extreme'), value: z.enum(['minimum', 'maximum']) }).strict(),
  z.object({ family: z.literal('condition_or_exception'), value: z.enum(['conditional', 'necessary_condition', 'exception']) }).strict(),
]);

/** Protected claim cues copied through the existing SceneContract claim IR. */
export const ClaimSemanticsSchema = z.object({
  /** Polarity of the proposition itself, independent of words like "negative feedback". */
  polarity: z.enum(['positive', 'negative']),
  /** A signed/domain descriptor such as positive charge or negative feedback. */
  polarityDescriptor: z.enum(['positive', 'negative']).optional(),
  comparison: z.object({
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
    value: z.number().optional(),
  }).strict().optional(),
  comparisons: z.array(z.object({
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
    value: z.number().optional(),
  }).strict()).max(16).optional(),
  temporal: z.object({ relation: z.enum(['before', 'after', 'during']) }).strict().optional(),
  temporals: z.array(z.enum(['before', 'after', 'during'])).max(16).optional(),
  quantities: z.array(z.object({ value: z.number(), unit: z.string().optional() }).strict()).max(16).optional(),
  /** Finite, canonicalized qualifiers not already represented by polarity, comparison, or temporal relation. */
  signals: z.array(ClaimSignalSchema).max(16).optional(),
}).strict();

export type ClaimSemantics = z.infer<typeof ClaimSemanticsSchema>;

const norm = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const smallNumberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const tensNumberWords: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const scaleNumberWords: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1_000_000_000, trillion: 1_000_000_000_000 };
const numberWordAlternatives = [
  ...Object.keys(smallNumberWords), ...Object.keys(tensNumberWords), 'hundred', ...Object.keys(scaleNumberWords),
].sort((a, b) => b.length - a.length).join('|');
const numberWordPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${numberWordAlternatives})(?:[- ]+(?:(?:hundred|${Object.keys(scaleNumberWords).join('|')})[- ]+and[- ]+)?(?:${numberWordAlternatives}))*(?![\\p{L}\\p{N}_])`, 'giu');
const numericPattern = /(?<![\p{L}\p{N}_])[+\-−–]?(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-−–]?\d+)?(?![\p{L}\p{N}_])/gu;

function parseNumberWords(raw: string): number | undefined {
  const tokens = raw.toLowerCase().split(/[- ]+/u);
  let total = 0;
  let current = 0;
  let previousScale = false;
  for (const token of tokens) {
    if (token === 'and' && previousScale) continue;
    if (token in smallNumberWords) current += smallNumberWords[token];
    else if (token in tensNumberWords) current += tensNumberWords[token];
    else if (token === 'hundred') { current = (current || 1) * 100; previousScale = true; }
    else if (token in scaleNumberWords) {
      total += (current || 1) * scaleNumberWords[token]!;
      current = 0;
      previousScale = true;
    } else return undefined;
    if (token !== 'and' && token !== 'hundred' && !(token in scaleNumberWords)) previousScale = false;
  }
  return total + current;
}

type ClaimSignal = z.infer<typeof ClaimSignalSchema>;
const claimSignalPatterns: Array<{ family: ClaimSignal['family']; value: ClaimSignal['value']; pattern: RegExp }> = [
  { family: 'change_direction', value: 'increase', pattern: /\b(?:increas(?:e|es|ed|ing)|ris(?:e|es|en|ing)|grow(?:s|n|ing)?|go(?:es|ing)? up|becom(?:e|es|ing) larger)\b/giu },
  { family: 'change_direction', value: 'decrease', pattern: /\b(?:decreas(?:e|es|ed|ing)|fall(?:s|en|ing)?|drop(?:s|ped|ping)?|go(?:es|ing)? down|becom(?:e|es|ing) smaller)\b/giu },
  { family: 'spatial_relation', value: 'inside', pattern: /\b(?:inside|within|in the interior of)\b/giu },
  { family: 'spatial_relation', value: 'outside', pattern: /\b(?:outside|beyond|external to)\b/giu },
  { family: 'quantity_scope', value: 'all', pattern: /\b(?:all|every|each)\b/giu },
  { family: 'quantity_scope', value: 'some', pattern: /\b(?:some|several|a few)\b/giu },
  { family: 'quantity_scope', value: 'none', pattern: /\b(?:none|no(?!\s+(?:more|less|fewer|greater)\s+than))\b/giu },
  { family: 'extreme', value: 'minimum', pattern: /\b(?:minimum|minimal|least|lowest)\b/giu },
  { family: 'extreme', value: 'maximum', pattern: /\b(?:maximum|maximal|highest|greatest)\b/giu },
  { family: 'condition_or_exception', value: 'necessary_condition', pattern: /\bonly\s+(?:if|when)\b/giu },
  { family: 'condition_or_exception', value: 'conditional', pattern: /(?<!only\s)\b(?:if|when|provided that)\b/giu },
  { family: 'condition_or_exception', value: 'exception', pattern: /\b(?:except|unless)\b/giu },
];

function claimSignalsFromText(text: string): ClaimSignal[] {
  const value = norm(text);
  const withoutComparisonExtremes = value.replace(/\b(?:at least|at most|no (?:less|fewer|more|greater) than)\b/gu, ' ');
  const matches = claimSignalPatterns.flatMap(({ family, value: signal, pattern }) => {
    const source = family === 'extreme' ? withoutComparisonExtremes : value;
    return [...source.matchAll(new RegExp(pattern.source, 'giu'))].map((match) => ({ family, value: signal, index: match.index! }));
  }).sort((left, right) => left.index - right.index);
  const seen = new Set<string>();
  return matches.flatMap(({ family, value: signal }) => {
    const key = `${family}:${signal}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ family, value: signal } as ClaimSignal];
  });
}

type UnitDefinition = { pattern: RegExp; canonical: string };

// SI symbols are case-sensitive: mV and MV, and MHz and mHz, are different units.
const symbolUnits: UnitDefinition[] = ([
  ['mV', 'mV'], ['MV', 'MV'], ['kV', 'kV'], ['V', 'V'],
  ['mA', 'mA'], ['MA', 'MA'], ['kA', 'kA'], ['A', 'A'],
  ['mW', 'mW'], ['MW', 'MW'], ['kW', 'kW'], ['W', 'W'],
  ['mJ', 'mJ'], ['MJ', 'MJ'], ['kJ', 'kJ'], ['J', 'J'],
  ['kg', 'kg'], ['mg', 'mg'], ['g', 'g'],
  ['mL', 'mL'], ['L', 'L'], ['km', 'km'], ['cm', 'cm'], ['mm', 'mm'], ['m', 'm'],
  ['ms', 'ms'], ['µs', 'µs'], ['μs', 'µs'], ['us', 'µs'], ['s', 's'], ['min', 'min'], ['h', 'h'],
  ['MHz', 'MHz'], ['kHz', 'kHz'], ['mHz', 'mHz'], ['Hz', 'Hz'],
  ['MΩ', 'MΩ'], ['kΩ', 'kΩ'], ['mΩ', 'mΩ'], ['Ω', 'Ω'],
  ['N', 'N'], ['K', 'K'], ['°C', '°C'], ['°F', '°F'], ['%', '%'],
] as Array<[string, string]>).map(([symbol, canonical]) => ({
  pattern: new RegExp(`^${symbol}(?:\\^?(?<power>[+-]?\\d+))?(?![\\p{L}\\p{N}])`, 'u'),
  canonical,
})).sort((a, b) => b.pattern.source.length - a.pattern.source.length);

const wordUnits: UnitDefinition[] = ([
  [/^degrees?\s+celsius(?![\p{L}\p{N}])/iu, '°C'], [/^degrees?\s+fahrenheit(?![\p{L}\p{N}])/iu, '°F'],
  [/^(?:degrees?\s+)?celsius(?![\p{L}\p{N}])/iu, '°C'], [/^(?:degrees?\s+)?fahrenheit(?![\p{L}\p{N}])/iu, '°F'],
  [/^degrees?\s*(?:c|°\s*c)(?![\p{L}\p{N}])/iu, '°C'], [/^degrees?\s*(?:f|°\s*f)(?![\p{L}\p{N}])/iu, '°F'],
  [/^kilovolts?(?![\p{L}\p{N}])/iu, 'kV'], [/^millivolts?(?![\p{L}\p{N}])/iu, 'mV'], [/^megavolts?(?![\p{L}\p{N}])/iu, 'MV'], [/^volts?(?![\p{L}\p{N}])/iu, 'V'],
  [/^kiloamps?(?![\p{L}\p{N}])/iu, 'kA'], [/^milliamps?(?![\p{L}\p{N}])/iu, 'mA'], [/^mega(?:amps?|amperes?)(?![\p{L}\p{N}])/iu, 'MA'], [/^amperes?(?![\p{L}\p{N}])/iu, 'A'], [/^amps?(?![\p{L}\p{N}])/iu, 'A'],
  [/^kilowatts?(?![\p{L}\p{N}])/iu, 'kW'], [/^milliwatts?(?![\p{L}\p{N}])/iu, 'mW'], [/^megawatts?(?![\p{L}\p{N}])/iu, 'MW'], [/^watts?(?![\p{L}\p{N}])/iu, 'W'],
  [/^kilojoules?(?![\p{L}\p{N}])/iu, 'kJ'], [/^millijoules?(?![\p{L}\p{N}])/iu, 'mJ'], [/^megajoules?(?![\p{L}\p{N}])/iu, 'MJ'], [/^joules?(?![\p{L}\p{N}])/iu, 'J'],
  [/^newtons?(?![\p{L}\p{N}])/iu, 'N'], [/^kilograms?(?![\p{L}\p{N}])/iu, 'kg'], [/^milligrams?(?![\p{L}\p{N}])/iu, 'mg'], [/^grams?(?![\p{L}\p{N}])/iu, 'g'],
  [/^millilit(?:er|re)s?(?![\p{L}\p{N}])/iu, 'mL'], [/^lit(?:er|re)s?(?![\p{L}\p{N}])/iu, 'L'],
  [/^kilometers?(?![\p{L}\p{N}])/iu, 'km'], [/^kilometres?(?![\p{L}\p{N}])/iu, 'km'],
  [/^centimeters?(?![\p{L}\p{N}])/iu, 'cm'], [/^centimetres?(?![\p{L}\p{N}])/iu, 'cm'],
  [/^millimeters?(?![\p{L}\p{N}])/iu, 'mm'], [/^millimetres?(?![\p{L}\p{N}])/iu, 'mm'],
  [/^meters?(?![\p{L}\p{N}])/iu, 'm'], [/^metres?(?![\p{L}\p{N}])/iu, 'm'],
  [/^milliseconds?(?![\p{L}\p{N}])/iu, 'ms'], [/^microseconds?(?![\p{L}\p{N}])/iu, 'µs'],
  [/^seconds?(?![\p{L}\p{N}])/iu, 's'], [/^secs?(?![\p{L}\p{N}])/iu, 's'],
  [/^minutes?(?![\p{L}\p{N}])/iu, 'min'], [/^mins?(?![\p{L}\p{N}])/iu, 'min'],
  [/^hours?(?![\p{L}\p{N}])/iu, 'h'], [/^hrs?(?![\p{L}\p{N}])/iu, 'h'],
  [/^days?(?![\p{L}\p{N}])/iu, 'day'], [/^weeks?(?![\p{L}\p{N}])/iu, 'week'], [/^years?(?![\p{L}\p{N}])/iu, 'year'],
  [/^mega(?:ohms?|hms?)(?![\p{L}\p{N}])/iu, 'MΩ'], [/^kilo(?:ohms?|hms?)(?![\p{L}\p{N}])/iu, 'kΩ'], [/^milli(?:ohms?|hms?)(?![\p{L}\p{N}])/iu, 'mΩ'], [/^ohms?(?![\p{L}\p{N}])/iu, 'Ω'],
  [/^megahertz(?![\p{L}\p{N}])/iu, 'MHz'], [/^kilohertz(?![\p{L}\p{N}])/iu, 'kHz'], [/^millihertz(?![\p{L}\p{N}])/iu, 'mHz'], [/^hertz(?![\p{L}\p{N}])/iu, 'Hz'],
  [/^percent(?:age)?(?![\p{L}\p{N}])/iu, '%'], [/^kelvin(?![\p{L}\p{N}])/iu, 'K'],
] as Array<[RegExp, string]>).map(([pattern, canonical]) => ({ pattern, canonical }));

function unitAtom(text: string): { unit: string; length: number } | undefined {
  const value = text.trimStart();
  const leading = text.length - value.length;
  const prefixedPower = /^(square|squared|cubic|cubed)\s+/iu.exec(value);
  const prefixPower = prefixedPower && /^(?:square|squared)$/iu.test(prefixedPower[1]!) ? 2 : 3;
  if (prefixedPower) {
    const remainder = value.slice(prefixedPower[0].length);
    for (const definition of wordUnits) {
      const match = definition.pattern.exec(remainder);
      if (match) return { unit: `${definition.canonical}^${prefixPower}`, length: leading + prefixedPower[0].length + match[0].length };
    }
  }
  for (const definition of symbolUnits) {
    const match = definition.pattern.exec(value);
    if (match) return { unit: `${definition.canonical}${match.groups?.power ? `^${match.groups.power}` : ''}`, length: leading + match[0].length };
  }
  for (const definition of wordUnits) {
    const match = definition.pattern.exec(value);
    if (match) {
      const power = /^\s+(squared|cubed)\b/iu.exec(value.slice(match[0].length));
      const exponent = power ? (/^squared$/iu.test(power[1]!) ? 2 : 3) : undefined;
      return { unit: `${definition.canonical}${exponent ? `^${exponent}` : ''}`, length: leading + match[0].length + (power?.[0].length ?? 0) };
    }
  }
  return undefined;
}

function unitAt(text: string): string | undefined {
  const first = unitAtom(text);
  if (!first) return undefined;
  let unit = first.unit;
  let rest = text.slice(first.length);
  // Keep the complete compound unit (e.g. kg·m/s²), not just its first two atoms.
  for (let count = 0; count < 6; count++) {
    const separator = /^\s*(\/|per\b|·|\*|×)\s*/iu.exec(rest);
    // SI compound units also use whitespace for multiplication (e.g. kg m/s²).
    // Require a recognized atom after the whitespace so ordinary prose is not
    // absorbed as part of the unit.
    const spacedAtom = separator ? undefined : /^\s+/u.exec(rest);
    if (!separator && !spacedAtom) break;
    const separatorLength = separator?.[0].length ?? spacedAtom![0].length;
    const next = unitAtom(rest.slice(separatorLength));
    if (!next) break;
    const separatorText = !separator || ['·', '*', '×'].includes(separator[1]!) ? '·' : '/';
    unit += `${separatorText}${next.unit}`;
    rest = rest.slice(separatorLength + next.length);
  }
  return unit;
}

function quantityTokens(text: string): Array<{ value: number; unit?: string }> {
  const matches = [
    ...[...text.matchAll(new RegExp(numericPattern.source, 'gu'))].map((match) => ({ index: match.index!, raw: match[0], value: Number(match[0].replace(/[−–]/gu, '-').replace(/,/gu, '')) })),
    ...[...text.matchAll(new RegExp(numberWordPattern.source, 'giu'))].map((match) => ({ index: match.index!, raw: match[0], value: parseNumberWords(match[0]) })),
  ].filter((match): match is typeof match & { value: number } => match.value !== undefined)
    .sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
  const quantities: Array<{ value: number; unit?: string }> = [];
  let consumedThrough = -1;
  for (const match of matches) {
    if (match.index < consumedThrough) continue;
    consumedThrough = match.index + match.raw.length;
    const suffix = text.slice(consumedThrough);
    const unit = unitAt(suffix);
    quantities.push({ value: match.value, ...(unit ? { unit } : {}) });
  }
  return quantities;
}

function numberMentions(text: string): Array<{ index: number; value: number }> {
  const numeric = [...text.matchAll(new RegExp(numericPattern.source, 'gu'))].map((match) => ({
    index: match.index!, value: Number(match[0].replace(/[−–]/gu, '-').replace(/,/gu, '')),
  }));
  const words = [...text.matchAll(new RegExp(numberWordPattern.source, 'giu'))].flatMap((match) => {
    const value = parseNumberWords(match[0]);
    return value === undefined ? [] : [{ index: match.index!, value }];
  });
  return [...numeric, ...words].sort((left, right) => left.index - right.index);
}

function comparisonsFromText(text: string): NonNullable<ClaimSemantics['comparison']>[] {
  const value = norm(text).replace(/≤|<=/gu, ' at most ').replace(/≥|>=/gu, ' at least ').replace(/</gu, ' less than ').replace(/>/gu, ' greater than ').replace(/≠|!=/gu, ' not equal ');
  const cues: Array<[RegExp, NonNullable<ClaimSemantics['comparison']>['operator'], boolean?]> = [
    [/\b(?:less than|fewer than|lower than|below|under)\b/u, 'lt'],
    [/\b(?:at most|no (?:more|greater) than|up to)\b/u, 'lte'],
    [/\b(?:or less|or fewer)\b/u, 'lte', true],
    [/\b(?:greater than|more than|higher than|above|over)\b/u, 'gt'],
    [/\b(?:at least|no (?:less|fewer) than)\b/u, 'gte'],
    [/\b(?:or more|or greater)\b/u, 'gte', true],
    [/\b(?:not equal|unequal|different from)\b/u, 'neq'],
    [/\b(?:equal to|equals|equal|exactly|the same as)\b/u, 'eq'],
  ];
  const candidates = cues.flatMap(([pattern, operator, postfix]) => {
    const matches = [...value.matchAll(new RegExp(pattern.source, 'gu'))];
    return matches.map((match) => ({ operator, postfix: postfix === true, index: match.index!, end: match.index! + match[0].length }));
  }).sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
  const found: typeof candidates = [];
  for (const candidate of candidates) {
    if (found.some((earlier) => candidate.index < earlier.end && candidate.end > earlier.index)) continue;
    found.push(candidate);
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((comparison, index) => {
    const previousEnd = found[index - 1]?.end ?? 0;
    const nextStart = found[index + 1]?.index ?? value.length;
    const segment = comparison.postfix
      ? value.slice(previousEnd, comparison.index)
      : value.slice(comparison.end, nextStart);
    const candidates = numberMentions(segment);
    const bound = comparison.postfix ? candidates.at(-1) : candidates[0];
    return { operator: comparison.operator, ...(bound ? { value: bound.value } : {}) };
  });
}

const comparisonOf = (text: string): ClaimSemantics['comparison'] => comparisonsFromText(text)[0];

function temporalRelationsFromText(text: string): Array<'before' | 'after' | 'during'> {
  const patterns: Array<[RegExp, 'before' | 'after' | 'during']> = [
    [/\b(?:before|earlier than|prior to)\b/giu, 'before'],
    [/\b(?:after|later than|following)\b/giu, 'after'],
    [/\b(?:during|while|throughout)\b/giu, 'during'],
  ];
  return patterns.flatMap(([pattern, relation]) => [...text.matchAll(new RegExp(pattern.source, 'giu'))]
    .map((match) => ({ relation, index: match.index! })))
    .sort((left, right) => left.index - right.index)
    .map(({ relation }) => relation);
}

/** Extract only explicit cues; absent fields mean the statement did not make that kind of assertion. */
export function claimSemanticsFromText(text: string): ClaimSemantics {
  const value = norm(text);
  const noComparatorPhrases = value.replace(/\bno\s+(?:more|less|fewer|greater)\s+than\b/gu, ' ');
  const hasNegation = /\b(?:not|never|without|cannot|can not|can't|doesn't|does not|isn't|is not|aren't|are not|won't|will not|neither|nor|none)\b/u.test(value)
    || /\bno\b/u.test(noComparatorPhrases);
  const result: ClaimSemantics = { polarity: hasNegation ? 'negative' : 'positive' };
  const polarityDescriptor = /\b(positive|negative)\b/u.exec(value)?.[1];
  if (polarityDescriptor) result.polarityDescriptor = polarityDescriptor as 'positive' | 'negative';
  const comparison = comparisonOf(value);
  if (comparison) result.comparison = comparison;
  const comparisons = comparisonsFromText(value);
  if (comparisons.length > 1) result.comparisons = comparisons;
  const temporals = temporalRelationsFromText(value);
  if (temporals.length) result.temporal = { relation: temporals[0]! };
  if (temporals.length > 1) result.temporals = temporals;
  const quantities = quantityTokens(text.normalize('NFKC'));
  if (quantities.length) result.quantities = quantities;
  const signals = claimSignalsFromText(value);
  if (signals.length) result.signals = signals;
  return result;
}

/**
 * Reject explicit qualifier mutations in a narration realization. This is a
 * conservative lexical gate, not a general entailment check; meaning that is
 * not represented in these fields still requires independent QA.
 */
export function claimSemanticsMismatch(canonicalText: string, realization: string, semantics = claimSemanticsFromText(canonicalText)): string[] {
  if (!semantics) return [];
  const actual = claimSemanticsFromText(realization);
  const problems: string[] = [];
  const countScopeRemainder = (text: string) => {
    const value = norm(text).replace(/[.!?]+$/u, '');
    const prefix = /^(?:none(?:\s+of(?:\s+the)?)?|no|zero|0)\b/u.exec(value);
    return prefix ? `__count_scope__${value.slice(prefix[0].length)}` : undefined;
  };
  const expectedHasNoneScope = (semantics.signals ?? []).some((signal) => signal.family === 'quantity_scope' && signal.value === 'none');
  const actualHasNoneScope = (actual.signals ?? []).some((signal) => signal.family === 'quantity_scope' && signal.value === 'none');
  const expectedHasCountZero = (semantics.quantities ?? []).some((quantity) => quantity.value === 0 && quantity.unit === undefined);
  const actualHasCountZero = (actual.quantities ?? []).some((quantity) => quantity.value === 0 && quantity.unit === undefined);
  const expectedCountForm = countScopeRemainder(canonicalText);
  const actualCountForm = countScopeRemainder(realization);
  const sameCountScopeWording = expectedCountForm !== undefined && expectedCountForm === actualCountForm;
  const noneCountEquivalent = sameCountScopeWording
    && ((expectedHasNoneScope && actualHasCountZero) || (actualHasNoneScope && expectedHasCountZero));
  if (actual.polarity !== semantics.polarity && !noneCountEquivalent) problems.push(`polarity must remain ${semantics.polarity}`);
  if (semantics.polarityDescriptor && actual.polarityDescriptor !== semantics.polarityDescriptor) problems.push(`polarity descriptor must remain ${semantics.polarityDescriptor}`);
  if (!semantics.polarityDescriptor && actual.polarityDescriptor) problems.push(`must not change the polarity descriptor to ${actual.polarityDescriptor}`);
  const expectedComparisons = semantics.comparisons ?? (semantics.comparison ? [semantics.comparison] : []);
  const actualComparisons = actual.comparisons ?? (actual.comparison ? [actual.comparison] : []);
  if (!expectedComparisons.length && actualComparisons.length) problems.push('must not introduce an unsupported comparison');
  else {
    const unmatchedComparisons = [...actualComparisons];
    const allComparisonsMatch = expectedComparisons.every((expected) => {
      const index = unmatchedComparisons.findIndex((observed) => observed.operator === expected.operator
        && (expected.value === undefined || observed.value === expected.value));
      if (index < 0) return false;
      unmatchedComparisons.splice(index, 1);
      return true;
    });
    if (expectedComparisons.length !== actualComparisons.length || !allComparisonsMatch) {
    const expected = expectedComparisons.map(({ operator, value }) => `${operator}${value === undefined ? '' : ` ${value}`}`).join(', ');
    problems.push(`comparison must remain ${expected}`);
    }
  }
  const expectedTemporals = semantics.temporals ?? (semantics.temporal ? [semantics.temporal.relation] : []);
  const actualTemporals = actual.temporals ?? (actual.temporal ? [actual.temporal.relation] : []);
  const sortedExpectedTemporals = [...expectedTemporals].sort();
  const sortedActualTemporals = [...actualTemporals].sort();
  const sameTemporals = sortedExpectedTemporals.length === sortedActualTemporals.length
    && sortedExpectedTemporals.every((relation, index) => relation === sortedActualTemporals[index]);
  if (!expectedTemporals.length && actualTemporals.length) problems.push(`must not introduce an unsupported temporal relation ${actualTemporals[0]}`);
  else if (expectedTemporals.length && !sameTemporals) problems.push(`temporal relation must remain ${expectedTemporals.join(' and ')}`);
  const unmatchedSignals = [...(actual.signals ?? [])];
  for (const signal of semantics.signals ?? []) {
    const index = unmatchedSignals.findIndex((candidate) => candidate.family === signal.family && candidate.value === signal.value);
    const countZeroEquivalent = signal.family === 'quantity_scope' && signal.value === 'none' && noneCountEquivalent;
    if (index >= 0) unmatchedSignals.splice(index, 1);
    else if (!countZeroEquivalent) problems.push(`${signal.family.replaceAll('_', ' ')} must remain ${signal.value}`);
  }
  for (const signal of unmatchedSignals) {
    const countZeroEquivalent = signal.family === 'quantity_scope' && signal.value === 'none' && noneCountEquivalent;
    if (!countZeroEquivalent) {
      const triggers = claimSignalPatterns.filter((entry) => entry.family === signal.family && entry.value === signal.value).flatMap((entry) => [...realization.matchAll(new RegExp(entry.pattern.source, entry.pattern.flags))].map((match) => match[0].toLowerCase()));
      problems.push(`must not introduce unsupported ${signal.family.replaceAll('_', ' ')} ${signal.value}${triggers.length ? ` (caused by "${[...new Set(triggers)].join('", "')}")` : ''}`);
    }
  }
  const expectedQuantities = semantics.quantities ?? [];
  const isCountZero = (quantity: { value: number; unit?: string }) => noneCountEquivalent && quantity.value === 0 && quantity.unit === undefined;
  const expectedComparableQuantities = expectedQuantities.filter((quantity) => !isCountZero(quantity));
  const unmatched = (actual.quantities ?? []).filter((quantity) => !isCountZero(quantity));
  for (const quantity of expectedComparableQuantities) {
    const index = unmatched.findIndex((candidate) => candidate.value === quantity.value && candidate.unit === quantity.unit);
    if (index < 0) problems.push(`quantity ${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ''} must remain present`);
    else unmatched.splice(index, 1);
  }
  for (const quantity of unmatched) problems.push(`must not introduce unsupported quantity ${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ''}`);
  return problems;
}

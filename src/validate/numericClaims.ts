/**
 * One definition of "a number the board states", shared by every evidence
 * gate. A numeric claim is a digit sequence or an English number word
 * (zero..twenty), with an optional unit. A claim is supported only when a
 * cited evidence quote states the same value in the same unit (a percentage
 * and its plain fraction count as the same value).
 *
 * Keeping this in one place matters: S6 once checked the code-owned scene
 * title with a digits-only rule while the final gate also counted number
 * words, so "Three Reasoning Modes" passed the first check, failed the
 * second, and no model repair could fix it.
 */
export interface NumericClaim { value: number; unit?: string; text: string }

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const WORD_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(NUMBER_WORDS).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const DIGIT_PATTERN = /(?<![\p{L}\p{N}])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?)/giu;
const UNIT_PATTERN = /^\s*(%|percent(?:age)?s?|°[cf]|km\/h|m\/s|kpa|mpa|pa|bar|atm|kg|mg|g|km|cm|mm|m|min(?:ute)?s?|ms|s|hours?|days?)(?![\p{L}])/iu;

const normalizeDashes = (value: string): string => value.replace(/[−–—]/gu, '-');

export function numericClaims(value: string): NumericClaim[] {
  const normalized = normalizeDashes(value);
  const unitAfter = (offset: number): string | undefined => {
    const unit = normalized.slice(offset).match(UNIT_PATTERN)?.[1]?.toLowerCase();
    return unit?.startsWith('percent') ? '%' : unit;
  };
  const claims: NumericClaim[] = [];
  for (const match of normalized.matchAll(DIGIT_PATTERN)) {
    const numeric = Number(match[1].replaceAll(',', ''));
    const unit = unitAfter(match.index + match[0].length);
    if (Number.isFinite(numeric)) claims.push({ value: numeric, unit, text: `${match[0]}${unit ?? ''}`.trim() });
  }
  for (const match of normalized.matchAll(WORD_PATTERN)) {
    const unit = unitAfter(match.index + match[0].length);
    claims.push({ value: NUMBER_WORDS[match[1].toLowerCase()], unit, text: `${match[0]}${unit ?? ''}`.trim() });
  }
  return claims;
}

function sameValue(evidence: NumericClaim, claim: NumericClaim): boolean {
  if (evidence.unit === claim.unit) return Math.abs(evidence.value - claim.value) < 1e-9;
  if ((evidence.unit === '%' && !claim.unit) || (claim.unit === '%' && !evidence.unit)) {
    const percent = evidence.unit === '%' ? evidence : claim;
    const plain = evidence.unit === '%' ? claim : evidence;
    return Math.abs(percent.value / 100 - plain.value) < 1e-9;
  }
  return false;
}

/** The numeric claims in `texts` that no evidence quote supports (their surface text, deduplicated). */
export function unsupportedNumericClaims(texts: readonly string[], evidenceQuotes: readonly string[]): string[] {
  const evidence = evidenceQuotes.flatMap(numericClaims);
  const unsupported = new Set<string>();
  for (const text of texts) {
    for (const claim of numericClaims(text)) if (!evidence.some((item) => sameValue(item, claim))) unsupported.add(claim.text);
  }
  return [...unsupported];
}

/**
 * Plain numeric tokens (digits only, normalised to a canonical string) for
 * typed visual parameters such as plot coefficients and number-line points,
 * whose values are numbers rather than prose.
 */
export function numericTokens(value: string): string[] {
  return [...normalizeDashes(value).matchAll(/(?<![\p{L}\p{N}.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:e[-+]?\d+)?/giu)].map((match) => {
    const numeric = Number(match[0].replaceAll(',', ''));
    return Number.isFinite(numeric) ? String(Number(numeric.toPrecision(12))) : match[0];
  });
}

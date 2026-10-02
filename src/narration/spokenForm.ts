/**
 * Deterministic spoken form for narration (S4 → S5). TTS and both aligners
 * (stable-ts, wav2vec2 CTC) must receive the same words; the CTC alphabet has
 * no digits, so digits are written out here once, before markers are parsed.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: Array<[number, string]> = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const ORDINAL_WORD: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return below100(r);
  return r ? `${ONES[h]} hundred ${below100(r)}` : `${ONES[h]} hundred`;
}

export function integerWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) { parts.push(`${below1000(Math.floor(rest / value))} ${name}`); rest %= value; }
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

function yearWords(n: number): string {
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return `${below100(hi)} hundred`;
  return `${below100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : below100(lo)}`;
}

function ordinal(words: string): string {
  const parts = words.split(/([ -])/);
  const last = parts[parts.length - 1];
  const next = ORDINAL_WORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  parts[parts.length - 1] = next;
  return parts.join('');
}

const NUMBER_RE = /(?<![\p{L}\d])([-−]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?(%?)/giu;

// A digit run glued directly onto letters (CO2, H2O, x2, 3D, 10km, page3a)
// would otherwise be skipped by NUMBER_RE's lookbehind (never matched at all)
// or, once matched, glue into a non-word with the trailing letters. Split the
// letter/digit boundary with a space first — except when the trailing letters
// are exactly an ordinal suffix (2nd, 3rd) directly followed by a non-letter
// or end, which NUMBER_RE already turns into a word on its own. A hyphen
// between letters and digits (COVID-19) is a word-joiner, not a minus sign:
// it is untouched here (it isn't a letter), and NUMBER_RE's own lookbehind
// then declines to treat it as a sign because it's preceded by a letter.
const LETTER_DIGIT_RE = /(\p{L})(\d)/gu;
const DIGIT_LETTER_RE = /(\d+)(\p{L}+)/gu;
const ORDINAL_SUFFIXES = new Set(['st', 'nd', 'rd', 'th']);

function splitLetterDigitBoundaries(text: string): string {
  const spaced = text.replace(LETTER_DIGIT_RE, '$1 $2');
  return spaced.replace(DIGIT_LETTER_RE, (_m, digits: string, letters: string) => {
    const isOrdinalSuffix = letters.length === 2 && ORDINAL_SUFFIXES.has(letters.toLowerCase());
    return isOrdinalSuffix ? `${digits}${letters}` : `${digits} ${letters}`;
  });
}

function normalizeSegment(rawText: string): string {
  const text = splitLetterDigitBoundaries(rawText);
  return text.replace(NUMBER_RE, (_m, sign: string, intPart: string, frac: string | undefined, ord: string | undefined, pct: string) => {
    const n = Number(intPart.replaceAll(',', ''));
    const isYear = !sign && !frac && !ord && !pct && !intPart.includes(',') && intPart.length === 4 && n >= 1100 && n <= 2099;
    let words = isYear ? yearWords(n) : integerWords(n);
    if (frac) words += ` point ${[...frac].map((d) => ONES[Number(d)]).join(' ')}`;
    if (ord) words = ordinal(words);
    if (sign) words = `minus ${words}`;
    if (pct) words += ' percent';
    return words;
  });
}

const MARKER_RE = /\[\[([a-zA-Z0-9_.-]+)\|([^\]|]+)\]\]/g;

export function spokenForm(text: string): string {
  let out = '';
  let cursor = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    out += normalizeSegment(text.slice(cursor, m.index)) + `[[${m[1]}|${normalizeSegment(m[2])}]]`;
    cursor = m.index! + m[0].length;
  }
  return out + normalizeSegment(text.slice(cursor));
}

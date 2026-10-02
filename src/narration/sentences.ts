/**
 * Abbreviation-aware spoken-sentence splitter shared by S4 claim selection.
 * A period after a known abbreviation, a single initial, or inside a number or
 * dotted acronym does not end a sentence. Deterministic; no topic vocabulary.
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie', 'cf', 'fig', 'figs', 'eq', 'eqs',
  'no', 'nos', 'vol', 'approx', 'est', 'inc', 'ltd', 'co', 'dept', 'al', 'ca', 'resp', 'viz', 'ref', 'refs',
]);

export function splitSpokenSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s+)/gu;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const end = match.index + match[0].length;
    if (match[0].startsWith('.') && match[0].length === 1 && isNonTerminalPeriod(text, match.index)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function isNonTerminalPeriod(text: string, index: number): boolean {
  const before = /([\p{L}.]+)$/u.exec(text.slice(0, index))?.[1] ?? '';
  const word = before.replace(/\./g, '').toLowerCase();
  if (!word) return false;
  if (before.includes('.')) return true; // dotted acronym such as "e.g" or "U.S"
  if (word.length === 1) return true; // single initial, e.g. "J. Smith"
  if (ABBREVIATIONS.has(word)) {
    // "etc." / "vs." may still end a sentence when a capitalised word follows and the abbreviation closes a list.
    return word !== 'etc' || !/^\s+[A-Z]/u.test(text.slice(index + 1, index + 3));
  }
  return false;
}

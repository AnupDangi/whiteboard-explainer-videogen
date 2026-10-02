/**
 * Spoken referent -> ordered concept-key candidates (most specific first).
 * Strips determiners, singularises, and emits suffix n-grams so "the red blood cells"
 * tries "red blood cell", "blood cell", "cell". Generic English morphology only; no topic words.
 */
const DETERMINERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'its', 'their', 'our', 'your', 'some', 'each', 'every']);

export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function referentKeys(phrase: string): string[] {
  const words = phrase.toLowerCase().replace(/[^a-z0-9 _-]/g, ' ').split(/[\s_-]+/).filter((word) => word && !DETERMINERS.has(word));
  if (!words.length) return [];
  const last = words.length - 1;
  const base = words.map((word, index) => (index === last ? singularize(word) : word));
  const keys: string[] = [];
  for (let start = 0; start < base.length && keys.length < 4; start++) keys.push(base.slice(start).join(' '));
  return [...new Set(keys)];
}

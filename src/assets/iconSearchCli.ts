import { allCatalogEntries, rankConcepts } from './semantic.js';
import { assetUsageContext } from './normalize.js';

/**
 * Taxonomy-aware icon search over every enabled library: `pnpm run icons:search -- "red blood cell" --domain biology --k 12`.
 * Embedding similarity plus an exact-name/token boost and a lesson-domain boost; the same ranking Visual Discovery sees.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const query = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--')).join(' ').trim();
if (!query) {
  console.error('usage: icons:search -- "<concept>" [--domain <lesson domain>] [--k 12] [--library iconify-lucide]');
  process.exit(2);
}
const k = Number(flag('k') ?? 12);
const library = flag('library');
const domain = flag('domain');
const entries = new Map(allCatalogEntries().map((entry) => [entry.id, entry]));
const ranked = (await rankConcepts([query], library ? 500 : k, undefined, domain ? { domain } : {})).get(query.toLowerCase()) ?? [];
console.log(`context=${assetUsageContext()} entries=${entries.size} query="${query}"${domain ? ` domain=${domain}` : ''}`);
for (const candidate of ranked.filter((item) => !library || item.id.startsWith(`${library}:`)).slice(0, k)) {
  const entry = entries.get(candidate.id);
  console.log(`${candidate.score.toFixed(3)}  ${candidate.name.padEnd(28)} ${(entry?.source ?? '').padEnd(34)} ${(entry?.license ?? '').padEnd(14)} ${entry?.domain ?? 'general'}  ${candidate.id}`);
}

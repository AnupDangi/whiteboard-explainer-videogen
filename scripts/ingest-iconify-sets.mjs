#!/usr/bin/env node
// Vendored Iconify sets -> one runtime catalog per set (offline, deterministic, no network at render time).
// Usage: node scripts/ingest-iconify-sets.mjs [outDir] [set ...]   (needs `pnpm build` and the @iconify/json devDependency)
// Source of truth for which sets are vendored: SETS below. Add a set here, then run `pnpm run icons:iconify` and
// `node scripts/embed-catalog.mjs`, then register the printed libraryId in src/assets/data/enabled-libraries.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ingestSvg } from '../dist/src/assets/libraryIngest.js';

const require = createRequire(import.meta.url);
const jsonDir = join(require.resolve('@iconify/json/package.json'), '..', 'json');
const OUTLINE = 'simi-house-v1/domain-outline';
const FLAT = 'simi-house-v1/emoji-flat';

// `keep` selects the single style variant per set (the house look is one outline + one flat body, not six weights).
const SETS = [
  { prefix: 'lucide', family: OUTLINE, keep: () => true },
  { prefix: 'tabler', family: OUTLINE, keep: (n) => !/-(filled|off)$/.test(n) },
  { prefix: 'ph', family: OUTLINE, keep: (n) => !/-(bold|duotone|fill|light|thin)$/.test(n) },
  { prefix: 'healthicons', family: OUTLINE, domain: 'health', keep: (n) => /-outline$/.test(n), strip: /-outline$/ },
  { prefix: 'carbon', family: OUTLINE, keep: (n) => !/-(filled|fill|off|thin|bold)$/.test(n) },
  { prefix: 'mdi', family: OUTLINE, keep: (n) => !/-(outline|off|light|thin|bold|fill|negative)$/.test(n) },
  { prefix: 'noto', family: FLAT, keep: (n) => !/-skin-tone|-light$|-off$/.test(n) },
];

const [outDir = 'src/assets/data', ...only] = process.argv.slice(2);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (s) => s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const report = {};

// Taxonomy domain for vendored icons: an icon whose name is a Bridge concept (id or alias) in exactly one specific
// domain inherits that domain. Names that are `general`, brand, or span several domains stay untagged.
const bridge = JSON.parse(readFileSync(new URL('../src/assets/data/asset-bridge-v2.json', import.meta.url), 'utf8'));
const domainsByName = new Map();
for (const concept of bridge.concepts) {
  if (!concept.domain || concept.domain === 'general' || concept.domain === 'brand') continue;
  for (const key of new Set([concept.conceptId, ...concept.aliases].map(words))) {
    domainsByName.set(key, new Set([...(domainsByName.get(key) ?? []), concept.domain]));
  }
}
const domainOf = (name) => { const found = domainsByName.get(name); return found?.size === 1 ? [...found][0] : undefined; };

for (const set of SETS) {
  if (only.length && !only.includes(set.prefix)) continue;
  const data = JSON.parse(readFileSync(join(jsonDir, `${set.prefix}.json`), 'utf8'));
  const license = data.info.license.spdx;
  const libraryId = `iconify-${set.prefix}`;
  // Aliases become searchable tags on their parent icon.
  const aliasesOf = new Map();
  for (const [alias, def] of Object.entries(data.aliases ?? {})) {
    if (!def.parent || def.rotate || def.hFlip || def.vFlip) continue;
    aliasesOf.set(def.parent, [...(aliasesOf.get(def.parent) ?? []), words(alias)]);
  }
  const entries = [];
  const rejected = {};
  for (const [iconName, icon] of Object.entries(data.icons).sort(([a], [b]) => a.localeCompare(b))) {
    if (!set.keep(iconName)) continue;
    const name = words(set.strip ? iconName.replace(set.strip, '') : iconName);
    if (!name || /^[\d\s]+$/.test(name)) continue;
    const width = icon.width ?? data.width ?? 24;
    const height = icon.height ?? data.height ?? 24;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`;
    const tags = [...new Set((aliasesOf.get(iconName) ?? []).filter((alias) => alias !== name))].sort();
    const result = ingestSvg(svg, { id: `${libraryId}:${slug(iconName)}`, set: set.prefix, name, tags, category: null, license }, { allowFillOnly: true });
    if (result.ok) entries.push({ ...result.entry, houseFamily: set.family, ...((set.domain ?? domainOf(name)) ? { domain: set.domain ?? domainOf(name) } : {}), conceptType: 'entity' });
    else { const key = result.reason.split(':')[0]; rejected[key] = (rejected[key] ?? 0) + 1; }
  }
  const author = data.info.author?.name ?? set.prefix;
  const catalog = {
    schemaVersion: 'claude-catalog/v2', libraryId,
    version: createHash('sha256').update(JSON.stringify(entries.map((e) => e.contentHash))).digest('hex').slice(0, 16),
    license,
    attribution: `${data.info.name} by ${author} (${license}) via Iconify, ${data.info.license.url ?? 'https://iconify.design'}`,
    entries,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${libraryId}.json`), `${JSON.stringify(catalog)}\n`);
  report[libraryId] = { license, accepted: entries.length, domainTagged: entries.filter((e) => e.domain).length, rejected };
}
console.log(JSON.stringify(report, null, 1));

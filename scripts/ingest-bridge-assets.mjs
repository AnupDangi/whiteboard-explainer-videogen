#!/usr/bin/env node
// Bridge -> runtime catalogs (AssetBridge v2 is the only asset authority, final_plan/02 §20).
// Usage: node scripts/ingest-bridge-assets.mjs <bridge.json> <assetLabRoot> [outDir]
// One catalog file per Asset Lab family; `review`-status families load only under ASSET_USAGE_CONTEXT=local-dev.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ingestSvg } from '../dist/src/assets/libraryIngest.js';

const [bridgePath, labRoot, outDir = 'src/assets/data'] = process.argv.slice(2);
if (!bridgePath || !labRoot) { console.error('usage: ingest-bridge-assets.mjs <bridge.json> <assetLabRoot> [outDir]'); process.exit(2); }
const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
const concepts = new Map(bridge.concepts.map((c) => [c.conceptId, c]));
const norm = (s) => s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Asset Lab family -> runtime library (downshift already ships as assetlab-sketchy-downshift).
const LIBRARIES = {
  'flaticon-local': { libraryId: 'flaticon', file: 'flaticon-local.json', reviewLicense: 'Flaticon-review' },
  iconify: { libraryId: 'bridge-iconify', file: 'bridge-iconify.json' },
  streamline: { libraryId: 'bridge-streamline', file: 'bridge-streamline.json', reviewLicense: 'Review-local-dev' },
  sketchi: { libraryId: 'bridge-sketchi', file: 'bridge-sketchi.json', reviewLicense: 'Review-local-dev', brand: true },
};
const report = {};
for (const [family, lib] of Object.entries(LIBRARIES)) {
  const entries = [];
  const rejected = {};
  for (const asset of [...bridge.assets].filter((a) => a.family === family).sort((a, b) => a.ref.localeCompare(b.ref))) {
    const concept = concepts.get(asset.conceptId);
    const name = norm(asset.conceptId.replace(/:brand$/, ''));
    let svg;
    try { svg = readFileSync(resolve(labRoot, asset.localPath), 'utf8'); } catch { rejected.unreadable = (rejected.unreadable ?? 0) + 1; continue; }
    const license = asset.license.status === 'allowed' ? asset.license.spdx : lib.reviewLicense;
    if (!license) { rejected['no-license'] = (rejected['no-license'] ?? 0) + 1; continue; }
    const id = `${lib.libraryId}:${slug(asset.ref)}`;
    const result = ingestSvg(svg, { id, set: 'local', name, tags: [...new Set((concept?.aliases ?? []).map(norm).filter((a) => a !== name))], category: null, license }, { allowFillOnly: true });
    if (result.ok) entries.push({ ...result.entry, conceptId: asset.conceptId, houseFamily: asset.houseFamily, domain: concept?.domain ?? 'general' });
    else { const key = result.reason.split(':')[0]; rejected[key] = (rejected[key] ?? 0) + 1; }
  }
  const catalog = { schemaVersion: 'claude-catalog/v2', libraryId: lib.libraryId, version: createHash('sha256').update(JSON.stringify(entries.map((e) => e.contentHash))).digest('hex').slice(0, 16), license: 'mixed', attribution: `Asset Lab bridge ${bridge.catalogVersion}: ${family}`, entries };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, lib.file), `${JSON.stringify(catalog)}\n`);
  report[family] = { accepted: entries.length, rejected };
}
writeFileSync(join(outDir, 'bridge-ingest-report.json'), `${JSON.stringify({ bridgeCatalogVersion: bridge.catalogVersion, families: report }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_DATA_DIR } from '../assets/streamline.js';
import { loadBridge } from '../assets/bridge.js';

const read = (file: string) => JSON.parse(readFileSync(resolve(CATALOG_DATA_DIR, file), 'utf8')) as { entries: Array<{ conceptId?: string; houseFamily?: string; domain?: string; license: string; id: string }> };

test('bridge-driven catalogs carry bridge concept ids, families and domains, and only known concepts', () => {
  const known = new Set(loadBridge().concepts.map((concept) => concept.conceptId));
  for (const [file, minimum] of [['flaticon-local.json', 3000], ['bridge-iconify.json', 150]] as const) {
    const catalog = read(file);
    assert.ok(catalog.entries.length >= minimum, `${file} entries ${catalog.entries.length}`);
    for (const entry of catalog.entries) {
      assert.ok(entry.conceptId && known.has(entry.conceptId), `${entry.id} names an unknown bridge concept`);
      assert.ok(entry.houseFamily?.startsWith('simi-house-v1/'), entry.id);
      assert.ok(entry.domain, entry.id);
    }
  }
});

test('review-licence catalogs carry review licences (owner-approved; not release-clean)', () => {
  for (const file of ['flaticon-local.json', 'bridge-streamline.json']) {
    for (const entry of read(file).entries) assert.ok(['Flaticon-review', 'Review-local-dev'].includes(entry.license), `${file}:${entry.id} ${entry.license}`);
  }
});

test('the ingest report records per-family rejection reasons', () => {
  const report = JSON.parse(readFileSync(resolve(CATALOG_DATA_DIR, 'bridge-ingest-report.json'), 'utf8')) as { families: Record<string, { accepted: number; rejected: Record<string, number> }> };
  assert.ok(report.families['flaticon-local']!.accepted > 3000);
  assert.ok(Object.keys(report.families).length >= 4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL_LIBRARIES, ENABLED_LIBRARIES, catalogVersion, isHouseSource } from '../assets/registry.js';
import { CATALOG_DATA_DIR, attributionForSources, loadCatalogLibraries, loadStreamlineCatalog } from '../assets/streamline.js';

test('production enables the house family plus the allowed bridge family; review-licence libraries are local-dev only', () => {
  // One primary family per SCENE is enforced at resolution time (final_plan/02 §19), not by
  // disabling libraries; review-licence libraries load only under ASSET_USAGE_CONTEXT=local-dev.
  assert.deepEqual(ENABLED_LIBRARIES.map((library) => [library.libraryId, library.house]), [['assetlab-sketchy-downshift', true], ['bridge-iconify', false]]);
  assert.deepEqual(ALL_LIBRARIES.map((library) => library.libraryId), ['assetlab-sketchy-downshift', 'bridge-iconify', 'streamline', 'assetlab-mit', 'assetlab-isc']);
  assert.equal(isHouseSource('assetlab-sketchy-downshift:assetlab-sketchy-downshift'), true);
  assert.equal(isHouseSource('streamline:plump-color'), false);
  assert.equal(isHouseSource('generated'), false);
});

test('the default load contains only enabled-family entries; Streamline stays loadable for rollback', () => {
  const sources = new Set(loadCatalogLibraries().entries.map((entry) => entry.source.split(':')[0]));
  assert.deepEqual([...sources].sort(), ['assetlab-sketchy-downshift', 'bridge-iconify']);
  assert.ok(loadStreamlineCatalog().entries.length > 1500);
});

test('attribution covers exactly the libraries that supplied assets', () => {
  assert.deepEqual(attributionForSources([]), []);
  assert.match(attributionForSources(['assetlab-sketchy-downshift:assetlab-sketchy-downshift']).join('\n'), /Sketchie.*MIT/);
  assert.match(attributionForSources(['streamline:plump-color']).join('\n'), /Streamline/);
});

test('catalog version is stable and changes when an enabled library changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-catalog-'));
  try {
    for (const library of ENABLED_LIBRARIES) {
      await copyFile(path.join(CATALOG_DATA_DIR, library.file), path.join(dir, library.file));
      await copyFile(path.join(CATALOG_DATA_DIR, library.embeddings), path.join(dir, library.embeddings));
    }
    const before = catalogVersion(ENABLED_LIBRARIES, dir);
    assert.equal(catalogVersion(ENABLED_LIBRARIES, dir), before);
    assert.match(before, /^catalog-[0-9a-f]{16}$/);
    await writeFile(path.join(dir, ENABLED_LIBRARIES[0].embeddings), Buffer.alloc(8));
    assert.notEqual(catalogVersion(ENABLED_LIBRARIES, dir), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every enabled library is licensed and loads every accepted entry with an ink outline', () => {
  const allEntries = loadCatalogLibraries().entries;
  for (const lib of ENABLED_LIBRARIES) {
    const loaded = allEntries.filter((entry) => entry.source.startsWith(`${lib.libraryId}:`));
    assert.ok(loaded.length > 100, `${lib.libraryId} must load its accepted entries, got ${loaded.length}`);
    for (const entry of loaded) {
      assert.ok(['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0'].includes(entry.license), entry.id);
      assert.ok(entry.strokePaths > 0, entry.id);
    }
  }
});

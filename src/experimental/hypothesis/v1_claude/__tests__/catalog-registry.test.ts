import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENABLED_LIBRARIES, catalogVersion, isHouseSource } from '../catalog/registry.js';
import { CATALOG_DATA_DIR, loadCatalogLibraries, loadStreamlineCatalog } from '../catalog/streamline.js';

test('registry is Streamline (house) plus the ingested user libraries, all non-house', () => {
  assert.deepEqual(ENABLED_LIBRARIES.map((library) => [library.libraryId, library.house]), [
    ['streamline', true],
    ['assetlab-mit', false],
    ['assetlab-isc', false],
  ]);
  assert.equal(isHouseSource('streamline:plump-color'), true);
  assert.equal(isHouseSource('assetlab-mit:assetlab-mit'), false);
  assert.equal(isHouseSource('generated'), false);
});

test('the default multi-library load\'s streamline-sourced entries equal the legacy Streamline load', () => {
  const legacy = loadStreamlineCatalog().entries.map((entry) => entry.id);
  const streamlineFromDefault = loadCatalogLibraries().entries
    .filter((entry) => entry.source.startsWith('streamline:'))
    .map((entry) => entry.id);
  assert.deepEqual(streamlineFromDefault, legacy);
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
    await writeFile(path.join(dir, 'streamline.emb.bin'), Buffer.alloc(8));
    assert.notEqual(catalogVersion(ENABLED_LIBRARIES, dir), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every ingested user library is enabled, licensed, and loads every accepted entry', () => {
  const userLibraries = ENABLED_LIBRARIES.filter((library) => library.libraryId !== 'streamline');
  assert.ok(userLibraries.length >= 2, 'expected assetlab-mit and assetlab-isc to be registered');
  const allEntries = loadCatalogLibraries().entries;
  for (const lib of userLibraries) {
    const loaded = allEntries.filter((entry) => entry.source.startsWith(`${lib.libraryId}:`));
    assert.ok(loaded.length > 0, `${lib.libraryId} must load at least one entry`);
    for (const entry of loaded) {
      assert.ok(['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0'].includes(entry.license), entry.id);
    }
  }
});

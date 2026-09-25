import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENABLED_LIBRARIES, catalogVersion, isHouseSource } from '../catalog/registry.js';
import { CATALOG_DATA_DIR, loadCatalogLibraries, loadStreamlineCatalog } from '../catalog/streamline.js';

test('default registry is Streamline only and marked house style', () => {
  assert.deepEqual(ENABLED_LIBRARIES.map((library) => [library.libraryId, library.house]), [['streamline', true]]);
  assert.equal(isHouseSource('streamline:plump-color'), true);
  assert.equal(isHouseSource('generated'), false);
});

test('default multi-library load equals the legacy Streamline load', () => {
  const legacy = loadStreamlineCatalog().entries.map((entry) => entry.id);
  assert.deepEqual(loadCatalogLibraries().entries.map((entry) => entry.id), legacy);
});

test('catalog version is stable and changes when an enabled library changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-catalog-'));
  try {
    await copyFile(path.join(CATALOG_DATA_DIR, 'streamline.json'), path.join(dir, 'streamline.json'));
    await copyFile(path.join(CATALOG_DATA_DIR, 'streamline.emb.bin'), path.join(dir, 'streamline.emb.bin'));
    const before = catalogVersion(ENABLED_LIBRARIES, dir);
    assert.equal(catalogVersion(ENABLED_LIBRARIES, dir), before);
    assert.match(before, /^catalog-[0-9a-f]{16}$/);
    await writeFile(path.join(dir, 'streamline.emb.bin'), Buffer.alloc(8));
    assert.notEqual(catalogVersion(ENABLED_LIBRARIES, dir), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

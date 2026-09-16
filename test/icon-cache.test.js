import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIconifyClient} from '../dist/src/semantic/assets/external/iconify.js';
import {
  assetCacheKey,
  createFileIconCache,
  createMemoryIconCache,
  resolveExternalConceptCached,
  searchCacheKey,
} from '../dist/src/semantic/assets/external/cache.js';

/** P4 — an external icon lookup must cost the network once. A repeated or
 *  resumed run consults the cache and must issue zero additional fetches, and a
 *  corrupt cache entry must degrade to a miss rather than a crash. */

const BASE = {baseUrl: 'https://fake.test', searchTimeoutMs: 200, fetchTimeoutMs: 200};
const goodSvg = '<svg viewBox="0 0 24 24"><path d="M4 6 L20 6 L20 18 L4 18 Z" stroke="#000" fill="none"/></svg>';
const request = {conceptId: 'c1', query: 'database', archetypes: ['flow']};
const fetchedAt = '2026-01-01T00:00:00.000Z';

/** Counting client: every search or SVG request increments `count`. */
const countingClient = () => {
  let count = 0;
  const client = createIconifyClient({
    ...BASE,
    fetchImpl: async (url) => {
      count++;
      return String(url).includes('/search')
        ? new Response(JSON.stringify({icons: ['tabler:database']}), {status: 200})
        : new Response(goodSvg, {status: 200});
    },
  });
  return {client, count: () => count};
};

const tempRoot = () => mkdtemp(join(tmpdir(), 'icon-cache-'));

const findResolutionFile = async (root) => {
  for (const name of await readdir(root)) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await readFile(join(root, name), 'utf8'));
      if (parsed && parsed.kind === 'resolution') return join(root, name);
    } catch { /* not a readable record */ }
  }
  return undefined;
};

test('a repeated resolve with a warm in-memory cache performs zero additional fetches', async () => {
  const first = countingClient();
  const cache = createMemoryIconCache();
  const options = {client: first.client, mode: 'balanced', fetchedAt, cache};

  const before = await resolveExternalConceptCached(request, options);
  const spent = first.count();
  assert.ok(spent > 0, 'the cold resolve must touch the network');
  assert.equal(before.asset.id, 'external.tabler.database');

  const again = await resolveExternalConceptCached(request, options);
  assert.equal(first.count(), spent, 'a warm cache must issue zero additional fetches');
  assert.deepEqual(again.asset, before.asset, 'the cached asset must be identical');
});

test('a file cache survives a resumed run: a fresh instance issues zero fetches', async () => {
  const root = await tempRoot();
  try {
    const first = countingClient();
    const cold = await resolveExternalConceptCached(request, {client: first.client, mode: 'balanced', fetchedAt, cache: createFileIconCache(root)});
    assert.ok(first.count() > 0);
    assert.equal(cold.asset.id, 'external.tabler.database');

    const resumed = countingClient();
    const warm = await resolveExternalConceptCached(request, {client: resumed.client, mode: 'balanced', fetchedAt, cache: createFileIconCache(root)});
    assert.equal(resumed.count(), 0, 'a resumed run must not touch the network');
    assert.deepEqual(warm.asset, cold.asset);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a corrupt cache entry is treated as a miss and the run still succeeds', async () => {
  const root = await tempRoot();
  try {
    const first = countingClient();
    const good = await resolveExternalConceptCached(request, {client: first.client, mode: 'balanced', fetchedAt, cache: createFileIconCache(root)});

    const target = await findResolutionFile(root);
    assert.ok(target, 'a resolved asset must be written to disk');
    // Valid JSON, structurally invalid asset: re-validation must reject it.
    await writeFile(target, JSON.stringify({kind: 'resolution', asset: {id: 'external.tabler.database'}}));

    const second = countingClient();
    const repaired = await resolveExternalConceptCached(request, {client: second.client, mode: 'balanced', fetchedAt, cache: createFileIconCache(root)});
    assert.equal(second.count(), 1, 'the corrupt asset must be re-fetched (search stays cached)');
    assert.equal(repaired.asset.id, 'external.tabler.database');
    assert.deepEqual(repaired.asset, good.asset);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('file cache files are sha256 digests, so a raw key never becomes a path', async () => {
  const root = await tempRoot();
  try {
    const cache = createFileIconCache(root);
    const key = searchCacheKey('iconify', 'a/b?c=d', 'balanced', 20);
    await cache.putSearch(key, [{prefix: 'tabler', name: 'database'}]);
    const names = await readdir(root);
    assert.equal(names.length, 1);
    assert.match(names[0], /^[a-f0-9]{64}\.json$/);
    assert.equal((await cache.getSearch(key)).length, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('cache keys are deterministic and scoped', () => {
  assert.equal(searchCacheKey('iconify', 'database', 'balanced', 20), searchCacheKey('iconify', 'database', 'balanced', 20));
  assert.notEqual(searchCacheKey('iconify', 'database', 'balanced', 20), searchCacheKey('iconify', 'database', 'strict', 20));
  assert.equal(assetCacheKey('tabler', 'database', 'abc', 'normalize-v1'), assetCacheKey('tabler', 'database', 'abc', 'normalize-v1'));
  assert.notEqual(assetCacheKey('tabler', 'database', 'abc', 'normalize-v1'), assetCacheKey('tabler', 'database', 'def', 'normalize-v1'));
});

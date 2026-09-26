import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { rasterFrameCacheKey, rasterizeCachedFrame } from '../export/videoEncode.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test('raster frame cache keys exact SVG and render settings and reuses only verified PNGs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-raster-cache-'));
  try {
    const settings = { cacheDir: dir, width: 1280 };
    assert.notEqual(rasterFrameCacheKey('<svg/>', settings), rasterFrameCacheKey('<svg><rect/></svg>', settings));
    assert.notEqual(rasterFrameCacheKey('<svg/>', settings), rasterFrameCacheKey('<svg/>', { ...settings, width: 1920 }));
    assert.notEqual(rasterFrameCacheKey('<svg/>', settings), rasterFrameCacheKey('<svg/>', { ...settings, fontSha256: 'f'.repeat(64) }));
    assert.notEqual(rasterFrameCacheKey('<svg/>', settings), rasterFrameCacheKey('<svg/>', { ...settings, rendererVersion: 'next-renderer' }));

    let renders = 0;
    const render = async () => { renders++; return png; };
    const first = await rasterizeCachedFrame('<svg/>', settings, render);
    const warm = await rasterizeCachedFrame('<svg/>', settings, render);
    const changedSvg = await rasterizeCachedFrame('<svg><rect/></svg>', settings, render);
    const changedWidth = await rasterizeCachedFrame('<svg/>', { ...settings, width: 1920 }, render);
    assert.deepEqual([first.cacheHit, warm.cacheHit, changedSvg.cacheHit, changedWidth.cacheHit], [false, true, false, false]);
    assert.equal(renders, 3);

    const fsModule = await import('node:fs/promises');
    await fsModule.writeFile(path.join(dir, `${first.key}.png`), Buffer.from('bad-png'));
    const repaired = await rasterizeCachedFrame('<svg/>', settings, render);
    assert.equal(repaired.cacheHit, false);
    assert.equal(renders, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('raster frame rendering uses the host-wide configured permit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-raster-limit-'));
  let active = 0;
  let peak = 0;
  try {
    await Promise.all(Array.from({ length: 6 }, (_, index) => rasterizeCachedFrame(`<svg>${index}</svg>`, { cacheDir: dir, width: 10, rasterLimit: 2, resourcePoolOptions: { rootDir: path.join(dir, 'pool'), pollMs: 10 } }, async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(10);
      active--;
      return png;
    })));
    assert.equal(peak, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

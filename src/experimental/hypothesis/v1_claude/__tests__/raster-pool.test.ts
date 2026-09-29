import test from 'node:test';
import assert from 'node:assert/strict';
import { RasterPool } from '../export/rasterPool.js';
import { rasterizePng } from '../export/videoEncode.js';

test('raster worker pool preserves deterministic raster output and supports repeated jobs', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="64" height="48" fill="#fff"/><circle cx="32" cy="24" r="12" fill="#e65343"/></svg>';
  const expected = rasterizePng(svg, 64);
  const pool = new RasterPool(2);
  try {
    const [first, second, third] = await Promise.all([
      pool.render(svg, 64),
      pool.render(svg, 64),
      pool.render(svg, 64),
    ]);
    assert.deepEqual(first, expected);
    assert.deepEqual(second, expected);
    assert.deepEqual(third, expected);
  } finally {
    await pool.close();
  }
});

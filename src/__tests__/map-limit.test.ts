import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../pipeline-v2/mapLimit.js';

test('mapLimit bounds concurrency, keeps input order and surfaces the first failure', async () => {
  let active = 0; let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, n)); active--; return n * 10; });
  assert.deepEqual(out, [50, 10, 40, 20, 30]); assert.equal(peak, 2);
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('two'); return n; }), /two/);
  await assert.rejects(mapLimit([1], 0, async (n) => n), /limit/);
  assert.deepEqual(await mapLimit([], 3, async (n) => n), []);
});

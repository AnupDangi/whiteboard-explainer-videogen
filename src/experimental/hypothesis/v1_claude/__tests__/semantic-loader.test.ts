import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetryingLazyLoader } from '../catalog/semantic.js';

test('embedding initialization is shared across concurrent callers and can retry after rejection', async () => {
  let attempts = 0;
  const load = createRetryingLazyLoader(async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporary local model load failure');
    return { model: 'loaded' };
  });

  const first = load();
  const concurrent = load();
  assert.strictEqual(first, concurrent, 'in-flight initialization should be deduplicated');
  await assert.rejects(first, /temporary local model load failure/);
  assert.equal(attempts, 1);

  const retried = load();
  assert.strictEqual(retried, load(), 'the successful retry should then be memoized');
  assert.deepEqual(await retried, { model: 'loaded' });
  assert.equal(attempts, 2);
});

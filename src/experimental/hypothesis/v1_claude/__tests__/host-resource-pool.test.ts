import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withHostResourcePermit } from '../../shared/hostResourcePool.js';

test('host resource permits cap concurrent work and release after success or failure', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hypothesis-host-pool-'));
  let active = 0;
  let peak = 0;
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => withHostResourcePermit('provider-test', 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      if (index === 3) throw new Error('intentional failure');
      return index;
    }, { rootDir, pollMs: 10 }).catch((error: Error) => {
      assert.equal(error.message, 'intentional failure');
    })));
    assert.equal(peak, 2);
    assert.deepEqual(await readdir(path.join(rootDir, 'provider-test')), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('waiting for a host resource lease responds to abort', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hypothesis-host-pool-abort-'));
  const controller = new AbortController();
  try {
    let releaseFirst!: () => void;
    const held = withHostResourcePermit('raster-test', 1, () => new Promise<void>((resolve) => { releaseFirst = resolve; }), { rootDir });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const waiting = withHostResourcePermit('raster-test', 1, async () => undefined, { rootDir, signal: controller.signal, pollMs: 10 });
    controller.abort(new Error('cancelled wait'));
    await assert.rejects(waiting, /cancelled wait/);
    releaseFirst();
    await held;
    assert.deepEqual(await readdir(path.join(rootDir, 'raster-test')), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

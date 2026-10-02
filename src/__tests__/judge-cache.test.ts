import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { judgeCacheKey, readJudgeCache, writeJudgeCache } from '../harness/judgeCache.js';

const resultSchema = z.object({ score: z.number().min(1).max(5), label: z.string() });
const keyInput = { model: 'synthetic-vision-model', promptVersion: 'judge-test/v1', schemaId: 'style/v1', prompt: 'synthetic prompt', images: [Buffer.from('synthetic-image-a'), Buffer.from('synthetic-image-b')] };

test('judge cache key binds model, prompt/schema versions, exact prompt, image bytes, and image order', () => {
  const key = judgeCacheKey(keyInput);
  assert.equal(key.length, 64);
  assert.equal(judgeCacheKey(keyInput), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, model: 'other-model' }), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, promptVersion: 'judge-test/v2' }), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, schemaId: 'clarity/v1' }), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, prompt: 'changed prompt' }), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, images: [Buffer.from('changed image'), keyInput.images[1]] }), key);
  assert.notEqual(judgeCacheKey({ ...keyInput, images: [...keyInput.images].reverse() }), key);
});

test('judge cache reuses schema-valid results and treats corrupt or schema-invalid entries as misses', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'judge-cache-test-'));
  const key = judgeCacheKey(keyInput);
  try {
    assert.equal(await readJudgeCache(cacheDir, key, resultSchema), undefined);
    const value = { score: 4, label: 'coherent' };
    await writeJudgeCache(cacheDir, key, value);
    assert.deepEqual(await readJudgeCache(cacheDir, key, resultSchema), value);

    await writeFile(path.join(cacheDir, `${key}.json`), JSON.stringify({ schemaVersion: 'vision-judge-cache/v1', key, value: { score: 9, label: 'invalid' } }));
    assert.equal(await readJudgeCache(cacheDir, key, resultSchema), undefined);
    await writeFile(path.join(cacheDir, `${key}.json`), '{broken json');
    assert.equal(await readJudgeCache(cacheDir, key, resultSchema), undefined);
    assert.equal(await readJudgeCache(undefined, key, resultSchema), undefined);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

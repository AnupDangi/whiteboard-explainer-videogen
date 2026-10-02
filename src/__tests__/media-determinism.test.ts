import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { decodedMediaDigest, mediaDigestsMatch } from '../export/mediaDigest.js';
import { encodeLockedLessonV2 } from '../pipeline-v2/lockV2.js';
import { encodeLockedLessonV2Clips } from '../pipeline-v2/clipsV2.js';
import { fixtureLock } from './fixtures/lockV2Fixture.js';

// Synthetic lock; this proves encode determinism of the pipeline, not visual quality.
test('decoded video and audio are identical across repeated locked encodes and across the clip and single-pass encoders', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-media-equal-'));
  try {
    const lock = await fixtureLock(dir);
    const a = path.join(dir, 'a.mp4'); const b = path.join(dir, 'b.mp4'); const single = path.join(dir, 'single.mp4');
    await encodeLockedLessonV2Clips(dir, a, { cacheDir: path.join(dir, 'cache-a') });
    await encodeLockedLessonV2Clips(dir, b, { cacheDir: path.join(dir, 'cache-b') });
    await encodeLockedLessonV2(dir, single);
    const [da, db, ds] = await Promise.all([a, b, single].map(decodedMediaDigest));
    assert.equal(da!.videoFrames, lock.render.frames);
    assert.deepEqual(mediaDigestsMatch(da!, db!), [], 'two cold clip encodes decode identically');
    assert.deepEqual(mediaDigestsMatch(da!, ds!).filter((p) => /frame/.test(p)), [], 'clip and single-pass encoders show the same frames');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('digest comparison names what differs', () => {
  const x = { videoFrames: 8, video: 'a'.repeat(64), audio: 'b'.repeat(64) };
  assert.deepEqual(mediaDigestsMatch(x, { ...x }), []);
  assert.deepEqual(mediaDigestsMatch(x, { videoFrames: 9, video: 'c'.repeat(64), audio: 'd'.repeat(64) }), ['frame count 8 vs 9', 'decoded video frames differ', 'decoded audio samples differ']);
});

test('replayDecodedMediaV2 reports equality across cold encodes and flags a different existing video', async () => {
  const { replayDecodedMediaV2 } = await import('../pipeline-v2/replayMedia.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-media-replay-test-'));
  try {
    await fixtureLock(dir);
    const clean = await replayDecodedMediaV2(dir, { runs: 2 });
    assert.deepEqual(clean.problems, []); assert.equal(clean.runs, 2);
    const mine = path.join(dir, 'existing.mp4');
    await encodeLockedLessonV2Clips(dir, mine, { cacheDir: path.join(dir, 'c') });
    assert.deepEqual((await replayDecodedMediaV2(dir, { existingVideo: mine })).problems, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

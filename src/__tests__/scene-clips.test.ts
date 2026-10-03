import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { LessonLockV2 } from '../pipeline-v2/lockV2.js';
import { fixtureLock as fixture } from './fixtures/lockV2Fixture.js';
import { encodeLockedLessonV2Clips, planSceneClips } from '../pipeline-v2/clipsV2.js';
import { probeMediaDurationMs } from '../export/ffmpeg.js';

const fakeEncoder = (log: { frames: number; calls: number; failFirst?: boolean }) => (partial: string) => {
  log.calls++;
  const fail = log.failFirst && log.calls === 1;
  return { write: async () => { if (fail) throw new Error('encoder died'); log.frames++; }, end: () => { writeFileSync(partial, 'clip'); }, abort: () => {}, done: Promise.resolve(), args: [] };
};

test('a scene clip key changes only when a frame of that scene changes, and scenes tile the render', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-clips-plan-'));
  try {
    const lock = await fixture(dir);
    const [one] = planSceneClips(lock);
    assert.equal(one!.frameCount, lock.render.frames);
    assert.match(one!.key, /^[0-9a-f]{64}$/);
    // Build a two-scene lock by cloning the scene under a new id after the first.
    const twin: LessonLockV2 = structuredClone(lock);
    twin.renderPlan = [...lock.renderPlan, ...lock.renderPlan.map((s) => ({ ...s, sceneId: 'two', firstFrame: s.firstFrame + lock.render.frames }))];
    twin.render.frames = lock.render.frames * 2;
    const [a, b] = planSceneClips(twin);
    assert.equal(a!.key, one!.key); assert.equal(a!.key, b!.key, 'identical frames give identical keys (deterministic, scene-id independent)');
    const edited = structuredClone(twin);
    const last = edited.renderPlan[edited.renderPlan.length - 1]!;
    if (last.kind === 'hold') last.svgHash = 'f'.repeat(64); else last.svgHashes[0] = 'f'.repeat(64);
    const [a2, b2] = planSceneClips(edited);
    assert.equal(a2!.key, a!.key, 'an untouched scene keeps its cache key'); assert.notEqual(b2!.key, b!.key);
    const gap = structuredClone(twin); gap.renderPlan[1]!.firstFrame += 1;
    assert.throws(() => planSceneClips(gap), /gap or overlap/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('clips are cached across runs, retried locally, announced in order and joined with one audio snapshot', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-clips-run-'));
  try {
    const lock = await fixture(dir);
    const log = { frames: 0, calls: 0, failFirst: true };
    const ready: string[] = []; let joined = ''; let audioSeen = '';
    const deps = {
      createRasterPool: () => ({ render: async () => Buffer.from('png'), close: async () => {} }),
      spawnClipEncoder: fakeEncoder(log) as never,
      probeDurationMs: async () => Math.round(lock.render.frames * 1000 / lock.render.fps),
      concat: async (list: string, audio: string, out: string) => { joined = await readFile(list, 'utf8'); audioSeen = audio; await writeFile(out, 'joined'); },
      onClipReady: (clip: { sceneId: string }) => { ready.push(clip.sceneId); },
    };
    const out = path.join(dir, 'out.mp4');
    const first = await encodeLockedLessonV2Clips(dir, out, deps);
    assert.equal(first.clips[0]!.attempts, 2, 'a failed clip is retried on its own');
    assert.equal(first.clips[0]!.cached, false); assert.equal(log.frames, lock.render.frames);
    assert.deepEqual(ready, ['one']); assert.match(joined, /^file '.*\.mp4'\n$/); assert.ok(audioSeen.endsWith('.audio.wav'));
    assert.equal(await readFile(out, 'utf8'), 'joined');
    const manifest = JSON.parse(await readFile(path.join(dir, 'v2', 'clip-progress.json'), 'utf8'));
    assert.deepEqual(manifest.ready.map((r: { sceneId: string }) => r.sceneId), ['one']); assert.equal(manifest.total, 1);
    const again = await encodeLockedLessonV2Clips(dir, path.join(dir, 'again.mp4'), deps);
    assert.equal(again.clips[0]!.cached, true); assert.equal(again.rendered, 0); assert.equal(log.calls, 2, 'no clip is encoded twice');
    await writeFile(again.clips[0]!.path, 'corrupt-cache');
    const recovered = await encodeLockedLessonV2Clips(dir, path.join(dir, 'recovered.mp4'), deps);
    assert.equal(recovered.clips[0]!.cached, false, 'a content-hash mismatch is discarded and encoded again');
    assert.equal(log.calls, 3);
    assert.ok(!(await readdir(dir)).some((f) => f.includes('.partial.') || f.endsWith('.audio.wav')));
    await assert.rejects(encodeLockedLessonV2Clips(dir, path.join(dir, 'x.mp4'), { ...deps, cacheDir: path.join(dir, 'fresh'), spawnClipEncoder: (() => ({ write: async () => { throw new Error('boom'); }, end: () => {}, abort: () => {}, done: Promise.resolve(), args: [] })) as never, attempts: 2 }), /clip failed after 2 attempts: boom/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('real ffmpeg: clips join into one video whose duration matches the locked lesson', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-clips-ffmpeg-'));
  try {
    const lock = await fixture(dir);
    const out = path.join(dir, 'lesson.mp4');
    const result = await encodeLockedLessonV2Clips(dir, out);
    assert.equal(result.frames, lock.render.frames);
    const ms = await probeMediaDurationMs(out);
    assert.ok(Math.abs(ms - lock.render.durationMs) < 400, `duration ${ms}ms vs ${lock.render.durationMs}ms`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed raster worker is replaced before its bounded clip retry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-clips-worker-recovery-'));
  try {
    const lock = await fixture(dir);
    let pools = 0;
    const result = await encodeLockedLessonV2Clips(dir, path.join(dir, 'recovered.mp4'), {
      createRasterPool: () => {
        pools++;
        const failedPool = pools === 1;
        return { render: async () => { if (failedPool) throw new Error('worker exited'); return Buffer.from('png'); }, close: async () => {} };
      },
      spawnClipEncoder: fakeEncoder({ frames: 0, calls: 0 }) as never,
      probeDurationMs: async () => Math.round(lock.render.frames * 1000 / lock.render.fps),
      concat: async (_list, _audio, out) => writeFile(out, 'joined'),
      attempts: 2,
    });
    assert.equal(result.clips[0]!.attempts, 2);
    assert.equal(pools, 2, 'retry gets a fresh raster worker pool');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

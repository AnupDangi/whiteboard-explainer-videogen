import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FPS, prepareScenes as prepare } from './fixtures/sceneLockFixture.js';
import {
  publishSceneLockV2, verifySceneLockV2, readyPrefixV2, writeLessonLockV2, verifyLessonLockV2, recordSceneProgressV2,
} from '../pipeline-v2/lockV2.js';

test('a scene lock is published as soon as its scene compiles: immutable, hash-pinned, and verifiable on its own', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-'));
  try {
    const scenes = await prepare(dir);
    const lock = await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    assert.equal(lock.sceneId, 'one');
    assert.equal(lock.firstFrame, 0);
    assert.equal(lock.frames, 10, '2.5 s at 4 fps');
    assert.ok(lock.svgAssets.length >= 1 && lock.renderPlan.length >= 1 && lock.samples.some((s) => s.kind === 'final'));
    assert.deepEqual(await verifySceneLockV2(dir, 'one'), []);
    await assert.rejects(publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS }), /already published/i, 'a published scene lock is immutable');
    assert.ok(!(await readdir(path.join(dir, 'v2', 'locked', 'scene-locks'))).some((f) => f.includes('.partial.')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scene lock verification rejects tampered frames, audio, captured state and a re-signed lock with bad refs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-tamper-'));
  try {
    const scenes = await prepare(dir);
    const lock = await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    for (const rel of [lock.svgAssets[0]!.file, lock.audio.file, lock.captured.file, lock.scene.file]) {
      const file = path.join(dir, rel); const original = await readFile(file);
      await writeFile(file, Buffer.concat([original, Buffer.from('edited')]));
      assert.ok((await verifySceneLockV2(dir, 'one')).length > 0, rel);
      await writeFile(file, original);
    }
    assert.deepEqual(await verifySceneLockV2(dir, 'one'), []);
    const lockFile = path.join(dir, 'v2', 'locked', 'scene-locks', 'one.scene.lock.json');
    const parsed = JSON.parse(await readFile(lockFile, 'utf8'));
    parsed.audio.file = '../outside.wav';
    await writeFile(lockFile, JSON.stringify(parsed));
    assert.ok((await verifySceneLockV2(dir, 'one')).length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the ready prefix is the contiguous run of verified scene locks, and stops at a gap or a tampered scene', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-prefix-'));
  try {
    const scenes = await prepare(dir);
    assert.deepEqual((await readyPrefixV2(dir)).scenes, []);
    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 1, item: scenes[1]!, fps: FPS });
    assert.deepEqual((await readyPrefixV2(dir)).scenes, [], 'scene two alone is not a prefix');
    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    const ready = await readyPrefixV2(dir);
    assert.deepEqual(ready.scenes.map((s) => s.sceneId), ['one', 'two']);
    assert.equal(ready.readyThroughMs, 5000);
    const two = ready.scenes[1]!;
    const audio = path.join(dir, two.audio.file);
    await writeFile(audio, Buffer.concat([await readFile(audio), Buffer.from('edited')]));
    assert.deepEqual((await readyPrefixV2(dir)).scenes.map((s) => s.sceneId), ['one'], 'a tampered scene ends the playable prefix');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the final lesson lock aggregates the published scene locks without re-rendering and equals a lock built from scratch', async () => {
  const fresh = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-fresh-'));
  const incremental = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-incremental-'));
  try {
    const freshScenes = await prepare(fresh);
    const fromScratch = await writeLessonLockV2({ outputDir: fresh, lessonId: 'test', scenes: freshScenes, durationMs: 5000, audioPath: path.join(fresh, 'audio.wav'), fps: FPS });

    const incrementalScenes = await prepare(incremental);
    for (const [index, item] of incrementalScenes.entries()) await publishSceneLockV2({ outputDir: incremental, lessonId: 'test', index, item, fps: FPS });
    const aggregated = await writeLessonLockV2({ outputDir: incremental, lessonId: 'test', scenes: incrementalScenes, durationMs: 5000, audioPath: path.join(incremental, 'audio.wav'), fps: FPS });

    assert.equal(aggregated.contentHash, fromScratch.contentHash, 'incremental publication changes nothing about the final lock');
    assert.deepEqual(aggregated.renderPlan, fromScratch.renderPlan);
    assert.deepEqual(await verifyLessonLockV2(incremental), []);
    assert.deepEqual(await verifyLessonLockV2(fresh), []);
    assert.equal(fromScratch.renderPlan.at(-1)!.firstFrame + fromScratch.renderPlan.at(-1)!.frameCount, fromScratch.render.frames);
  } finally { await rm(fresh, { recursive: true, force: true }); await rm(incremental, { recursive: true, force: true }); }
});

test('aggregation refuses a scene lock that no longer matches the compiled scene', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-scene-lock-mismatch-'));
  try {
    const scenes = await prepare(dir);
    for (const [index, item] of scenes.entries()) await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index, item, fps: FPS });
    const changed = [{ ...scenes[0]!, endMs: 2400 }, { ...scenes[1]!, startMs: 2400 }];
    await assert.rejects(writeLessonLockV2({ outputDir: dir, lessonId: 'test', scenes: changed, durationMs: 5000, audioPath: path.join(dir, 'audio.wav'), fps: FPS }), /scene lock|placement|differs/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('progress events record when each scene became playable, without touching any pinned file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-scene-progress-'));
  try {
    const scenes = await prepare(dir);
    const first = await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    const before = await readFile(path.join(dir, 'v2', 'locked', 'scene-locks', 'one.scene.lock.json'));
    await recordSceneProgressV2(dir, { sceneId: first.sceneId, index: 0, sinceRequestMs: 1234, sinceStartMs: 800 });
    await recordSceneProgressV2(dir, { sceneId: 'two', index: 1, sinceRequestMs: 2345, sinceStartMs: 1900 });
    const progress = JSON.parse(await readFile(path.join(dir, 'v2', 'progress.json'), 'utf8')) as { schemaVersion: string; events: Array<{ sceneId: string; sinceRequestMs: number }> };
    assert.equal(progress.schemaVersion, 'v2-progress/v1');
    assert.deepEqual(progress.events.map((e) => [e.sceneId, e.sinceRequestMs]), [['one', 1234], ['two', 2345]]);
    assert.ok(before.equals(await readFile(path.join(dir, 'v2', 'locked', 'scene-locks', 'one.scene.lock.json'))), 'progress is not part of any lock');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

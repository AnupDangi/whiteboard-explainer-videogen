import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ResolvedMention, SceneSpec } from '../types.js';
import { stableJson } from '../../shared/artifacts.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import {
  buildLessonLock, verifyLessonLock, lockContentHash, rerenderFinalFrame,
  LESSON_LOCK_VERSION, type LessonLock,
} from '../pipeline/lessonLock.js';

const spec: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'lock_test',
  title: 'Lock Test',
  template: 'chain',
  elements: [
    { id: 'a', anchor: 'mention:a', prim: 'box', text: 'First' },
    { id: 'b', anchor: 'mention:b', prim: 'box', text: 'Second' },
  ],
  edges: [{ from: 'a', to: 'b', label: 'flows to' }],
};

const mention = (id: string, startMs: number, endMs: number): ResolvedMention => ({
  sceneId: 'lock_test', mentionId: id, startMs, endMs, ambiguous: false, wordRange: [0, 1],
});

async function fixtureDir(): Promise<{ dir: string; finalFrameSvg: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-'));
  const resolved = resolveScene(spec);
  const laidOut = layoutScene(resolved);
  const timeline = compileTimelineFull(laidOut, [mention('a', 1000, 1200), mention('b', 3000, 3200)], 0, 12000);
  const finalFrameSvg = renderSVG(laidOut, timeline, 11999);
  await writeFile(path.join(dir, 'scene-spec.lock_test.json'), stableJson(spec), 'utf8');
  await writeFile(path.join(dir, 'resolved-scene.lock_test.json'), stableJson(resolved), 'utf8');
  await writeFile(path.join(dir, 'layout.lock_test.json'), stableJson(laidOut), 'utf8');
  await writeFile(path.join(dir, 'timeline.lock_test.json'), stableJson(timeline), 'utf8');
  await writeFile(path.join(dir, 'narration.json'), stableJson({ scenes: [] }), 'utf8');
  return { dir, finalFrameSvg, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('lock version is pinned', () => {
  assert.equal(LESSON_LOCK_VERSION, 'lesson.lock/v1');
});

test('build + verify round-trips on fixture artifacts', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', finalFrameSvg, assetRefs: [] }],
      promptVersions: { test: 'v1' }, modelIds: ['test/model'],
    });
    assert.equal(lock.schemaVersion, 'lesson.lock/v1');
    assert.equal(lock.scenes.length, 1);
    assert.equal(lock.scenes[0].fileHashes.spec.length, 64);
    assert.ok(lock.versions.node.startsWith('v'));
    assert.ok(lock.versions.kalamSha256.length === 64);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`, 'utf8');
    assert.deepEqual(await verifyLessonLock(dir), []);
  } finally {
    await cleanup();
  }
});

test('lock build is deterministic (content hash stable across builds)', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    const opts = {
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', finalFrameSvg, assetRefs: [] }],
    };
    const a = await buildLessonLock(opts);
    const b = await buildLessonLock(opts);
    assert.equal(lockContentHash(a), lockContentHash(b));
    assert.equal(a.contentHash, b.contentHash);
  } finally {
    await cleanup();
  }
});

test('final frame re-derives from locked geometry + timeline', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    const laidOut = JSON.parse(await readFile(path.join(dir, 'layout.lock_test.json'), 'utf8'));
    const timeline = JSON.parse(await readFile(path.join(dir, 'timeline.lock_test.json'), 'utf8'));
    assert.equal(rerenderFinalFrame(laidOut, timeline), finalFrameSvg);
  } finally {
    await cleanup();
  }
});

test('tampered geometry is detected by the verifier', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', finalFrameSvg, assetRefs: [] }],
    });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`, 'utf8');
    assert.deepEqual(await verifyLessonLock(dir), []);
    const layout = JSON.parse(await readFile(path.join(dir, 'layout.lock_test.json'), 'utf8')) as {
      elements: Array<{ bbox: { x: number } }>;
    };
    layout.elements[0].bbox.x += 25;
    await writeFile(path.join(dir, 'layout.lock_test.json'), stableJson(layout), 'utf8');
    const problems = await verifyLessonLock(dir);
    assert.ok(problems.some((p) => p.includes('layout') && p.includes('hash drift')), JSON.stringify(problems));
    assert.ok(problems.some((p) => p.includes('not a pure function')), JSON.stringify(problems));
  } finally {
    await cleanup();
  }
});

test('edited lock content fails the content-hash check', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', finalFrameSvg, assetRefs: [] }],
    });
    const edited = { ...lock, status: 'passed' } as LessonLock;
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(edited)}\n`, 'utf8');
    const problems = await verifyLessonLock(dir);
    assert.ok(problems.some((p) => p.includes('content hash mismatch')), JSON.stringify(problems));
  } finally {
    await cleanup();
  }
});

test('missing lock file is reported, not thrown', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-empty-'));
  try {
    const problems = await verifyLessonLock(dir);
    assert.ok(problems.some((p) => p.includes('unreadable')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

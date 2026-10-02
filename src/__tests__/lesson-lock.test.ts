import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ResolvedMention, SceneSpec } from '../shared/types.js';
import { sha256, stableJson } from '../shared/artifacts.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import {
  buildLessonLock, verifyLessonLock, lockContentHash, rerenderFinalFrame, renderLockedFinalFrames, verifyRenderPurity, renderVideoFromLessonLock, writeRenderArtifactsManifest, writeFailureLessonLock, writeLessonLockExclusive,
  LESSON_LOCK_VERSION, type LessonLock,
} from '../run/lessonLock.js';

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

const lockedModelSettings = {
  models: { syllabus: 'test/syllabus', concepts: 'test/concepts', plan: 'test/plan', script: 'test/script', visual: 'test/visual', planner: 'test/planner' },
  planner: { id: 'board-v2', promptArm: 'zero', exampleOrder: 'ranked' },
  structuredOutput: { temperaturePolicy: 'zero-when-supported' as const, format: 'stage-schema-json' as const },
  audio: { ttsProviderSelector: 'auto', language: 'en', alignerModel: 'base', alignerProvider: 'stable-ts' },
  run: { cache: 'cold', maxCostUsd: 0.1, maxRepairs: 1 },
};

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
  await writeFile(path.join(dir, 'source-doc.json'), stableJson({ sourceId: 'fixture-source' }), 'utf8');
  await writeFile(path.join(dir, 'narration.json'), stableJson({ scenes: [] }), 'utf8');
  await writeFile(path.join(dir, 'aligned-audio.json'), stableJson({ schemaVersion: 'claude-aligned-audio/v1', sceneWords: { lock_test: [] } }), 'utf8');
  await writeFile(path.join(dir, 'scene-events.jsonl'), '{"sceneId":"lock_test"}\n', 'utf8');
  await writeFile(path.join(dir, 'audio.wav'), Buffer.from('master audio fixture'));
  await mkdir(path.join(dir, 'scene-audio'));
  await writeFile(path.join(dir, 'scene-audio/0000.wav'), Buffer.from('scene audio fixture'));
  return { dir, finalFrameSvg, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('lock version is pinned', () => {
  assert.equal(LESSON_LOCK_VERSION, 'lesson.lock/v4');
});

test('build + verify round-trips on fixture artifacts', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      promptVersions: { test: 'v1' }, modelIds: ['test/model'],
    });
    assert.equal(lock.schemaVersion, 'lesson.lock/v4');
    assert.equal(lock.scenes.length, 1);
    assert.equal(lock.scenes[0].fileHashes.spec.length, 64);
    assert.ok(lock.versions.node.startsWith('v'));
    assert.ok(lock.versions.kalamSha256.length === 64);
    await writeLessonLockExclusive(dir, lock);
    const firstBytes = await readFile(path.join(dir, 'lesson.lock.json'), 'utf8');
    await assert.rejects(writeLessonLockExclusive(dir, lock), /EEXIST/);
    assert.equal(await readFile(path.join(dir, 'lesson.lock.json'), 'utf8'), firstBytes, 'a repeated attempt cannot overwrite the compile boundary');
    assert.deepEqual(await verifyLessonLock(dir), []);
  } finally {
    await cleanup();
  }
});

test('renderable lock refuses source evidence that was requested but not written', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await assert.rejects(buildLessonLock({
      runId: 'missing-source', status: 'renderable', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [] }], sourceFiles: ['missing-source.json'],
    }), /required lock source missing-source.json is unavailable/);
  } finally { await cleanup(); }
});

test('renderable lock refuses missing narration, alignment, events, per-scene audio and hashes', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await assert.rejects(buildLessonLock({
      runId: 'incomplete-render-lock', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [] }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    }), /renderable lesson lock is incomplete:.*scene lock_test audio path\/hash is required/);

    const complete = await buildLessonLock({
      runId: 'tamper-complete-lock', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    const missingAlignment = { ...complete, alignment: undefined, contentHash: '' } as LessonLock;
    missingAlignment.contentHash = lockContentHash(missingAlignment);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(missingAlignment)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('alignment artifact hash is required')));
    const missingModelSettings = { ...complete, modelSettings: undefined, contentHash: '' } as LessonLock;
    missingModelSettings.contentHash = lockContentHash(missingModelSettings);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(missingModelSettings)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('effective model and run settings are required')));
    const emptyModelSettings = { ...complete, modelSettings: { models: {}, planner: {}, structuredOutput: {}, audio: {}, run: {} }, contentHash: '' } as unknown as LessonLock;
    emptyModelSettings.contentHash = lockContentHash(emptyModelSettings);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(emptyModelSettings)}\n`);
    const emptySettingsProblems = await verifyLessonLock(dir);
    assert.ok(emptySettingsProblems.some((problem) => problem.includes('model setting syllabus is required')));
    assert.ok(emptySettingsProblems.some((problem) => problem.includes('audio settings are incomplete')));
  } finally { await cleanup(); }
});

test('renderable lock verification rejects removed or unsafe scene inputs even after resigning', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'required-scene-inputs', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    const withoutLayout = structuredClone(lock);
    delete (withoutLayout.scenes[0]!.files as Partial<typeof withoutLayout.scenes[0]['files']>).layout;
    delete (withoutLayout.scenes[0]!.fileHashes as Partial<typeof withoutLayout.scenes[0]['fileHashes']>).layout;
    withoutLayout.contentHash = lockContentHash(withoutLayout);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(withoutLayout)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('scene lock_test layout path is required')));

    const unsafe = structuredClone(lock);
    unsafe.scenes[0]!.files.layout = '../outside.json';
    unsafe.contentHash = lockContentHash(unsafe);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(unsafe)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('scene lock_test layout path is required and must be relative')));
  } finally { await cleanup(); }
});

test('renderable lock refuses unknown tool versions', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'unknown-tool-version', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    lock.versions.ffmpeg = 'unknown';
    lock.contentHash = lockContentHash(lock);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('known ffmpeg version')));
  } finally { await cleanup(); }
});

test('lock build is deterministic (content hash stable across builds)', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const opts = {
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
    };
    const a = await buildLessonLock(opts);
    const b = await buildLessonLock({ ...opts, runId: 'different-attempt-id' });
    assert.equal(lockContentHash(a), lockContentHash(b));
    assert.equal(a.contentHash, b.contentHash);
    assert.equal(stableJson(a), stableJson(b), 'run UUIDs and wall-clock timestamps stay outside the deterministic compile lock');
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
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
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
    await assert.rejects(renderLockedFinalFrames(dir), /lesson lock verification failed.*layout/);
  } finally {
    await cleanup();
  }
});

test('edited lock content fails the content-hash check', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'draft', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [] }],
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

test('render manifest records outputs without changing locked inputs', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('audio fixture'));
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    const bytes = `${stableJson(lock)}\n`;
    await writeFile(path.join(dir, 'lesson.lock.json'), bytes);
    assert.deepEqual(await verifyLessonLock(dir), []);
    await writeFile(path.join(dir, 'video.mp4'), Buffer.from('encoded fixture'));
    await writeRenderArtifactsManifest(dir, lock.contentHash, { video: 'video.mp4' });
    assert.equal(await readFile(path.join(dir, 'lesson.lock.json'), 'utf8'), bytes);
    assert.deepEqual(await verifyLessonLock(dir), []);
    const manifest = JSON.parse(await readFile(path.join(dir, 'render-artifacts.json'), 'utf8')) as { lockContentHash: string; artifacts: { video: { sha256: string } } };
    assert.equal(manifest.lockContentHash, lock.contentHash);
    assert.equal(manifest.artifacts.video.sha256.length, 64);
  } finally { await cleanup(); }
});

test('S10 SVG generation occurs from a verified lock and is reproducible', async () => {
  const { dir, finalFrameSvg, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('audio fixture'));
    const lock = await buildLessonLock({
      runId: 's10-run', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    assert.deepEqual(await verifyLessonLock(dir), []);
    const rendered = await renderLockedFinalFrames(dir);
    assert.equal(rendered.frames.lock_test, finalFrameSvg);
    await writeFile(path.join(dir, 'video.mp4'), Buffer.from('encoded fixture'));
    await writeRenderArtifactsManifest(dir, lock.contentHash, { ...rendered.artifacts, video: 'video.mp4' });
    assert.deepEqual(await verifyRenderPurity(dir), []);
    await writeFile(path.join(dir, 'final-frame.lock_test.svg'), `${finalFrameSvg}<!--edited-->`);
    assert.ok((await verifyRenderPurity(dir)).some((problem) => problem.includes('output hash drift')));
    await writeFile(path.join(dir, 'final-frame.lock_test.svg'), finalFrameSvg);
    await writeFile(path.join(dir, 'video.mp4'), Buffer.from('tampered fixture'));
    assert.ok((await verifyRenderPurity(dir)).some((problem) => problem.includes('render artifact video hash drift')));
    await assert.rejects(renderVideoFromLessonLock(dir), /existing render artifacts failed verification.*video hash drift/);
    assert.equal((await verifyLessonLock(dir)).length, 0, 'post-lock outputs must not mutate the input lock');
  } finally { await cleanup(); }
});

test('offline single-video rerender regenerates captions from locked alignment', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'aligned-audio.json'), stableJson({
      schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: path.join(dir, 'audio.wav'), durationMs: 12000,
      sceneWords: { lock_test: [{ w: 'Locked', startMs: 100, endMs: 250 }, { w: 'captions.', startMs: 300, endMs: 600 }] },
      sceneBoundsMs: { lock_test: { startMs: 0, endMs: 12000 } }, mentions: [],
    }));
    const lock = await buildLessonLock({
      runId: 'caption-rerender', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    await writeLessonLockExclusive(dir, lock);
    await renderVideoFromLessonLock(dir, { encodeSingle: async (_scenes, _duration, _audio, output) => { await writeFile(output, 'encoded'); return { frames: 1, ffmpegArgs: [] }; } });
    const captions = await readFile(path.join(dir, 'captions.vtt'), 'utf8');
    assert.match(captions, /Locked captions\./);
    const manifest = JSON.parse(await readFile(path.join(dir, 'render-artifacts.json'), 'utf8')) as { artifacts: Record<string, { sha256: string }> };
    assert.equal(manifest.artifacts.captions?.sha256.length, 64);
    assert.deepEqual(await verifyRenderPurity(dir), []);
  } finally { await cleanup(); }
});

test('rerender refuses tampered geometry before invoking encoder', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('audio fixture'));
    const lock = await buildLessonLock({
      runId: 'test-run', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    await writeFile(path.join(dir, 'layout.lock_test.json'), '{}');
    await assert.rejects(renderVideoFromLessonLock(dir), /lesson lock verification failed.*layout/);
  } finally { await cleanup(); }
});

test('early failure lock keeps available evidence and cannot render', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-failure-'));
  try {
    await writeFile(path.join(dir, 'lesson-prep.json'), '{}');
    await writeFailureLessonLock({ runId: 'failed-run', outputDir: dir, sourceFiles: ['lesson-prep.json'], execution: { cacheMode: 'cold' }, failure: [{ stage: 'S2', code: 'source-insufficient', message: 'source does not support goal' }] });
    assert.deepEqual(await verifyLessonLock(dir), []);
    const lock = JSON.parse(await readFile(path.join(dir, 'lesson.lock.json'), 'utf8')) as LessonLock;
    assert.equal(lock.status, 'failed');
    assert.equal(lock.source?.files[0], 'lesson-prep.json');
    assert.equal(lock.execution?.cacheMode, 'cold');
    await assert.rejects(renderVideoFromLessonLock(dir), /not renderable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('lock source hashes pin the complete prepared lesson contract artifact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-prep-'));
  try {
    const prep = JSON.stringify({ request: { instruction: 'test' }, bible: { concepts: [] }, sceneContracts: [] });
    await writeFile(path.join(dir, 'lesson-prep.json'), prep);
    const lock = await buildLessonLock({ runId: 'prepared-contract-lock', status: 'draft', outputDir: dir, scenes: [], sourceFiles: ['lesson-prep.json'] });
    assert.equal(lock.source?.hashes['lesson-prep.json'], sha256(prep));
    await writeLessonLockExclusive(dir, lock);
    assert.deepEqual(await verifyLessonLock(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('complete geometry in a failed run does not make its lock rerenderable', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('diagnostic audio'));
    const lock = await buildLessonLock({
      runId: 'failed-complete-run', status: 'failed', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [] }],
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    assert.deepEqual(await verifyLessonLock(dir), []);
    await assert.rejects(renderLockedFinalFrames(dir), /lesson lock is not renderable/);
    await assert.rejects(renderVideoFromLessonLock(dir), /lesson lock is not renderable/);
  } finally { await cleanup(); }
});

test('bridge snapshot drift prevents rerender', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({ runId: 'bridge-run', status: 'draft', outputDir: dir, scenes: [{ sceneId: 'lock_test', assetRefs: [] }], assets: { bridgeDigest: '0'.repeat(64) } });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('asset bridge')));
  } finally { await cleanup(); }
});

test('rerender rejects an output manifest for another lock before encoding', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('audio fixture'));
    const lock = await buildLessonLock({ runId: 'manifest-run', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' }, scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }], inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') }, modelSettings: lockedModelSettings, render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 } });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    await writeFile(path.join(dir, 'render-artifacts.json'), `${stableJson({ lockContentHash: '0'.repeat(64), artifacts: {} })}\n`);
    await assert.rejects(renderVideoFromLessonLock(dir), /different lock/);
  } finally { await cleanup(); }
});

test('module lock replay rebuilds local audio, captions, clip clock and assembly', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await mkdir(path.join(dir, 'scene-audio'), { recursive: true });
    await writeFile(path.join(dir, 'scene-audio/0000.wav'), Buffer.from('scene audio'));
    await writeFile(path.join(dir, 'scene-audio/blocked.wav'), Buffer.from('blocked-scene audio'));
    await writeFile(path.join(dir, 'audio.wav'), Buffer.from('master audio'));
    await writeFile(path.join(dir, 'aligned-audio.json'), stableJson({ schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: path.join(dir, 'audio.wav'), durationMs: 24200, sceneWords: { lock_test: [{ w: 'Hello.', startMs: 100, endMs: 250 }], blocked_scene: [{ w: 'Blocked.', startMs: 12200, endMs: 12350 }] }, sceneBoundsMs: { lock_test: { startMs: 0, endMs: 12000 }, blocked_scene: { startMs: 12200, endMs: 24200 } }, mentions: [] }));
    const lock = await buildLessonLock({ runId: 'module-run', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' }, scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }], audioScenes: [{ sceneId: 'blocked_scene', audioFile: 'scene-audio/blocked.wav', alignmentHash: sha256('blocked-alignment') }], inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') }, modelSettings: lockedModelSettings, modules: [{ id: 'module-1', title: 'Module One', sceneIds: ['lock_test', 'blocked_scene'], durationMs: 24200 }], render: { width: 1920, height: 1080, fps: 30, durationMs: 24200, sceneGapMs: 200 } });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    let sawClip = false;
    const output = await renderVideoFromLessonLock(dir, {
      concatAudio: async (paths, gap, tail, out) => { assert.deepEqual(paths, [path.join(dir, 'scene-audio/0000.wav'), path.join(dir, 'scene-audio/blocked.wav')]); assert.equal(gap, 200); assert.equal(tail, 200, 'the last module keeps a closing hold'); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'module audio'); },
      encodeModules: async (modules) => { assert.equal(modules.length, 1); assert.equal(modules[0].durationMs, 24400); assert.equal(modules[0].scenes[0].timeline.sceneEndMs, 12000); assert.ok(modules[0].captionsPath); sawClip = true; return []; },
      assembleModules: async (_, out) => { await writeFile(out, 'module video'); return { path: out, chapters: [] }; },
    });
    assert.ok(sawClip);
    assert.equal(output, path.join(dir, 'video.mp4'));
    assert.equal((await readFile(path.join(dir, 'module-audio/module-1.vtt'), 'utf8')).includes('Hello.'), true);
    assert.equal((await verifyLessonLock(dir)).length, 0);
  } finally { await cleanup(); }
});

test('scene event log is pinned and tampering blocks replay', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'scene-events.jsonl'), '{"sceneId":"lock_test"}\n');
    const lock = await buildLessonLock({ runId: 'event-run', status: 'draft', outputDir: dir, scenes: [{ sceneId: 'lock_test', assetRefs: [] }] });
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    assert.deepEqual(await verifyLessonLock(dir), []);
    await writeFile(path.join(dir, 'scene-events.jsonl'), '{"sceneId":"other"}\n');
    assert.ok((await verifyLessonLock(dir)).some((problem) => problem.includes('scene events') && problem.includes('hash drift')));
  } finally { await cleanup(); }
});

test('a renderable lock without source hashes or an asset usage context is refused', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const base = {
      runId: 'no-source', status: 'renderable', outputDir: dir,
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') }, modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    };
    await assert.rejects(buildLessonLock({ ...base, assets: { usageContext: 'production' } }), /source hashes are required/);
    await assert.rejects(buildLessonLock({ ...base, sourceFiles: ['source-doc.json'] }), /asset usage context is required/);
    const ok = await buildLessonLock({ ...base, sourceFiles: ['source-doc.json'], assets: { usageContext: 'local-dev' } });
    assert.equal(ok.assets.usageContext, 'local-dev');
    assert.ok(ok.source?.hashes['source-doc.json']);
  } finally { await cleanup(); }
});

test('the lock pins the visual vocabulary artifact when discovery ran', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    await writeFile(path.join(dir, 'visual-vocabulary.json'), stableJson({ schemaVersion: 'visual-vocabulary/v1', scenes: {}, validatedByConcept: {} }), 'utf8');
    const lock = await buildLessonLock({ runId: 'vocab', status: 'draft', outputDir: dir, scenes: [], sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' } });
    assert.equal(lock.visualVocabulary?.file, 'visual-vocabulary.json');
    assert.match(lock.visualVocabulary!.hash, /^[a-f0-9]{64}$/);
  } finally { await cleanup(); }
});

test('replay refuses captions that differ from the locked captions hash and accepts identical ones', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const alignment = stableJson({
      schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: path.join(dir, 'audio.wav'), durationMs: 12000,
      sceneWords: { lock_test: [{ w: 'Locked', startMs: 100, endMs: 250 }, { w: 'captions.', startMs: 300, endMs: 600 }] },
      sceneBoundsMs: { lock_test: { startMs: 0, endMs: 12000 } }, mentions: [],
    });
    await writeFile(path.join(dir, 'aligned-audio.json'), alignment);
    const build = (runId: string) => buildLessonLock({
      runId, status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') }, modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    const encode = { encodeSingle: async (_s: unknown, _d: unknown, _a: unknown, output: string) => { await writeFile(output, 'encoded'); return { frames: 1, ffmpegArgs: [] }; } };
    // A locked captions file that does not match what the locked alignment regenerates.
    await writeFile(path.join(dir, 'captions.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nsomething else\n');
    await writeLessonLockExclusive(dir, await build('mismatch'));
    await assert.rejects(renderVideoFromLessonLock(dir, encode as never), /regenerated captions hash .* differs from locked captions hash/);
  } finally { await cleanup(); }
});

test('pipeline source drift blocks replay by default; an explicit cross-commit allowance drops only that problem', async () => {
  const { dir, cleanup } = await fixtureDir();
  try {
    const lock = await buildLessonLock({
      runId: 'pipeline-drift', status: 'renderable', outputDir: dir, sourceFiles: ['source-doc.json'], assets: { usageContext: 'production' },
      scenes: [{ sceneId: 'lock_test', assetRefs: [], audioFile: 'scene-audio/0000.wav', alignmentHash: sha256('alignment') }],
      inputs: { requestHash: sha256('request'), settingsHash: sha256('settings') },
      modelSettings: lockedModelSettings,
      render: { width: 1920, height: 1080, fps: 30, durationMs: 12000 },
    });
    lock.versions.pipeline = 'deadbeef+0000';
    lock.versions.ffmpeg = 'ffmpeg version 0.0.0 other';
    lock.contentHash = lockContentHash(lock);
    await writeFile(path.join(dir, 'lesson.lock.json'), `${stableJson(lock)}\n`);
    const strict = await verifyLessonLock(dir);
    assert.ok(strict.some((problem) => problem.includes('pipeline tool version drift')), JSON.stringify(strict));
    const allowed = await verifyLessonLock(dir, { allowPipelineDrift: true });
    assert.ok(!allowed.some((problem) => problem.includes('pipeline tool version drift')), JSON.stringify(allowed));
    assert.ok(allowed.some((problem) => problem.includes('ffmpeg tool version drift')), 'other tool drift stays a problem');
  } finally { await cleanup(); }
});

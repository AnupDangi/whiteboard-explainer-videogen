import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline } from '../visual-v2/timeline/compile.js';
import { compileScene } from '../visual-v2/renderer/frame.js';
import { compareReplayDigests, canonicalHash } from '../harness/replayDeterminism.js';
import { writeLessonLockV2, verifyLessonLockV2, verifiedRasterInputs, replayLessonV2, encodeLockedLessonV2, type LessonLockV2 } from '../pipeline-v2/lockV2.js';

// Synthetic contract data, never visual-quality or live-performance evidence.
async function fixture(dir: string, withIdentity = false): Promise<LessonLockV2> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'v2'), { recursive: true });
  await mkdir(path.join(dir, 'scene-audio'), { recursive: true });
  const wav = Buffer.alloc(44 + 22050 * 2 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(path.join(dir, 'audio.wav'), wav);
  await writeFile(path.join(dir, 'scene-audio', 'one.wav'), wav);
  const text = withIdentity ? 'Alpha causes Beta.' : 'A test token appears.';
  const claim = { id: 'c1', statement: 'Alpha causes Beta.', conceptIds: ['alpha', 'beta'], relations: [{ from: 'alpha', to: 'beta', type: 'causes' }], evidenceSpanIds: ['span1'] };
  const teachingBeats = [{
    beatId: 'one.b1', sceneId: 'one', order: 0, claimIds: ['c1'], learnerDelta: 'Understand the direction from Alpha to Beta.', beatType: 'introduce',
    cognitiveOperation: 'explain_cause', representationFamily: 'causal_chain', entities: [{ conceptId: 'alpha' }, { conceptId: 'beta' }], relationships: [{ from: 'alpha', to: 'beta', type: 'causes' }],
    misconceptionIds: [], narrationGoal: 'Explain the cause.', visualInvariant: 'Alpha points to Beta.', mutedMeaning: 'Alpha causes Beta.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none', evidenceSpanIds: ['span1'],
  }];
  const narration = {
    sceneId: 'one', text, beats: [{ beatId: 'one.b1', sentenceIds: ['one.b1.s1'], text }],
    beatSpans: [{ beatId: 'one.b1', pauseIntent: 'none', charStart: 0, charEnd: text.length, sentenceSpans: [{ sentenceId: 'one.b1.s1', charStart: 0, charEnd: text.length }] }],
    claimSpans: [{ claimId: 'c1', exactText: text, plainStart: 0, plainEnd: text.length }],
  };
  const context = withIdentity
    ? { plan: { sections: [{ id: 'one', contract: { essentialClaims: [claim] } }] }, graph: { concepts: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }], relations: [{ from: 'alpha', to: 'beta', type: 'causes' }] }, beatPlans: { one: teachingBeats }, beatNarrations: { one: narration } }
    : { plan: { sections: ['one'] }, graph: { concepts: [] } };
  await writeFile(path.join(dir, 'captions.vtt'), `WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.800\n${text}\n`);
  await writeFile(path.join(dir, 'v2', 'lesson-context.json'), JSON.stringify(context));
  const words = text.match(/\S+/gu) ?? [];
  await writeFile(path.join(dir, 'v2', 'alignment.json'), JSON.stringify({ schemaVersion: 'v2-alignment/v1', scenes: [{ sceneId: 'one', durationMs: 2000, words: words.map((word, i) => ({ word, startMs: i * 400, endMs: i * 400 + 300 })), aligner: 'stable-ts', repairedWordIndexes: [], calibration: { status: 'unmeasured' } }] }));
  const ops = withIdentity ? [
    { op: 'add' as const, opId: 'o1', beatId: 'one.b1', id: 'alpha', element: { type: 'entity' as const, conceptId: 'alpha', label: 'Alpha', provenance: 'illustrative' as const, bindings: { conceptIds: ['alpha'], claimIds: ['c1'] } }, at: { region: 'left' as const }, cue: 0 },
    { op: 'add' as const, opId: 'o2', beatId: 'one.b1', id: 'beta', element: { type: 'entity' as const, conceptId: 'beta', label: 'Beta', provenance: 'illustrative' as const, bindings: { conceptIds: ['beta'], claimIds: ['c1'] } }, at: { region: 'right' as const }, cue: 0 },
    { op: 'connect' as const, opId: 'o3', beatId: 'one.b1', id: 'edge', from: 'alpha', to: 'beta', relation: 'causes', bindings: { conceptIds: ['alpha', 'beta'], claimIds: ['c1'] }, cue: 0 },
  ] : [{ op: 'add' as const, opId: 'o1', beatId: 'one.b1', id: 'token', element: { type: 'token' as const, text: 'sample', provenance: 'illustrative' as const }, at: { region: 'center' as const }, cue: 0 }];
  const timeline = compileSceneTimeline({ initial: withIdentity ? startScene(emptyBoardState(), { mode: 'clean' }, 'one') : emptyBoardState(), ops, beats: [{ beatId: 'one.b1', startMs: 0, endMs: 1800, sentences: [{ startMs: 0, endMs: 1800 }] }] });
  await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify({ transition: { mode: 'clean' }, ops: timeline.ops.map((s) => s.op), beats: withIdentity ? teachingBeats : [], narration: withIdentity ? narration : { text }, beatTimings: [], timelineHash: timeline.hash }));
  const scene = compileScene('one', 'A token', timeline, 'test');
  return writeLessonLockV2({ outputDir: dir, lessonId: 'test', scenes: [{ scene, startMs: 0, endMs: 2000 }], durationMs: 2000, audioPath: path.join(dir, 'audio.wav'), fps: 4 });
}

async function resign(dir: string, lock: LessonLockV2): Promise<void> {
  const { contentHash: _old, ...body } = lock;
  lock.contentHash = canonicalHash(body);
  const bytes = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(path.join(dir, 'lesson.lock.v2.json'), bytes);
  await writeFile(path.join(dir, 'lesson.lock.json'), bytes);
}

test('V2 freezes a deduplicated frame-range plan, context, semantic scene data, audio and representative raster pins before publication', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-contract-'));
  try {
    const lock = await fixture(dir);
    assert.equal(lock.schemaVersion, 'lesson.lock/v5-teaching-compiler-v2');
    assert.equal(lock.render.frames, 8);
    assert.ok(lock.renderPlan.some((s) => s.kind === 'hold' && s.frameCount > 1));
    assert.ok(lock.renderPlan.some((s) => s.kind === 'transition'));
    assert.ok(lock.svgAssets.length < lock.render.frames, 'holds store one SVG, not one per frame');
    assert.ok(lock.samples.some((s) => s.kind === 'final'));
    assert.ok(lock.samples.some((s) => s.kind === 'transition'));
    assert.ok(lock.samples.every((s) => /^[0-9a-f]{64}$/.test(s.pngHash)));
    assert.equal(await readFile(path.join(dir, 'lesson.lock.json'), 'utf8'), await readFile(path.join(dir, 'lesson.lock.v2.json'), 'utf8'));
    assert.deepEqual(await verifyLessonLockV2(dir), []);
    await assert.rejects(fixture(dir), /exist|published|lock/i, 'a published lock cannot be silently regenerated');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 rejects a fully rehashed narration whose claim reverses the canonical graph relation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-identity-'));
  try {
    const lock = await fixture(dir, true);
    assert.deepEqual(await verifyLessonLockV2(dir), [], 'the canonical claim, narration, beat and board identity should verify');

    const contextFile = path.join(dir, lock.context.file);
    const sceneFile = path.join(dir, lock.scenes[0]!.file);
    const alignmentFile = path.join(dir, lock.alignment.file);
    const context = JSON.parse(await readFile(contextFile, 'utf8'));
    const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
    const alignment = JSON.parse(await readFile(alignmentFile, 'utf8'));
    const reversed = 'Beta causes Alpha.';
    context.beatNarrations.one.text = reversed;
    context.beatNarrations.one.beats[0].text = reversed;
    scene.narration.text = reversed;
    scene.narration.beats[0].text = reversed;
    scene.narration.claimSpans[0].exactText = reversed;
    alignment.scenes[0].words = reversed.split(/\s+/u).map((word: string, index: number) => ({ word, startMs: index * 400, endMs: index * 400 + 300 }));
    const contextBytes = JSON.stringify(context);
    const sceneBytes = JSON.stringify(scene);
    const alignmentBytes = JSON.stringify(alignment);
    await writeFile(contextFile, contextBytes);
    await writeFile(sceneFile, sceneBytes);
    await writeFile(alignmentFile, alignmentBytes);
    lock.context.hash = createHash('sha256').update(contextBytes).digest('hex');
    lock.scenes[0]!.fileHash = createHash('sha256').update(sceneBytes).digest('hex');
    lock.alignment.hash = createHash('sha256').update(alignmentBytes).digest('hex');
    await resign(dir, lock);

    const problems = await verifyLessonLockV2(dir);
    assert.ok(problems.some((problem) => /reversed direction/.test(problem)), problems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 rejects a fully rehashed entity whose display label names a different graph concept', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-visual-identity-'));
  try {
    const lock = await fixture(dir, true);
    const sceneFile = path.join(dir, lock.scenes[0]!.file);
    const capturedFile = path.join(dir, lock.scenes[0]!.captured.file);
    const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
    const captured = JSON.parse(await readFile(capturedFile, 'utf8'));
    scene.ops[0].element.label = 'Beta';
    captured.timeline.ops[0].op.element.label = 'Beta';
    for (const state of [...captured.timeline.states, ...(captured.timeline.lifecycleEvents ?? []).map((event: { state: unknown }) => event.state)]) {
      const elements = (state as { elements?: Record<string, { spec?: Record<string, unknown> }> }).elements;
      if (elements?.alpha?.spec) elements.alpha.spec.label = 'Beta';
    }
    const scheduledHashInput = captured.timeline.ops.map((scheduled: { op: { opId: string }; t0: number; t1: number }) => [scheduled.op.opId, Math.round(scheduled.t0), Math.round(scheduled.t1)]);
    captured.timeline.hash = captured.timeline.lifecycleEvents
      ? canonicalHash([scheduledHashInput, captured.timeline.lifecycleEvents.map((event: { kind: string; beatId?: string; atMs: number; state: unknown }) => [event.kind, event.beatId, Math.round(event.atMs), event.state])])
      : canonicalHash(scheduledHashInput);
    const sceneBytes = JSON.stringify(scene);
    const capturedBytes = JSON.stringify(captured);
    await writeFile(sceneFile, sceneBytes);
    await writeFile(capturedFile, capturedBytes);
    lock.scenes[0]!.fileHash = createHash('sha256').update(sceneBytes).digest('hex');
    lock.scenes[0]!.captured.hash = createHash('sha256').update(capturedBytes).digest('hex');
    lock.scenes[0]!.timelineHash = captured.timeline.hash;
    lock.scenes[0]!.boardOpsHash = canonicalHash(captured.timeline.ops.map((scheduled: { op: unknown }) => scheduled.op));
    lock.scenes[0]!.boardStatesHash = canonicalHash(captured.timeline.states);
    await resign(dir, lock);

    const problems = await verifyLessonLockV2(dir);
    assert.ok(problems.some((problem) => /names graph concept beta, but is bound to alpha/.test(problem)), problems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('raster-only verification tolerates known Node and pipeline drift but keeps renderer pins strict', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-raster-bench-'));
  try {
    const lock = await fixture(dir);
    lock.versions.node = 'v0.0.0-benchmark-old-node';
    lock.versions.pipeline = 'old-pipeline-for-benchmark';
    await resign(dir, lock);
    assert.deepEqual(await verifyLessonLockV2(dir), ['node tool version drift or unknown pin', 'pipeline tool version drift or unknown pin']);
    const inputs = await verifiedRasterInputs(dir);
    assert.equal(inputs.svgs.size, lock.svgAssets.length);
    assert.deepEqual(inputs.toleratedToolDrift.map(({ tool }) => tool), ['node', 'pipeline']);
    assert.equal(inputs.toleratedToolDrift.every(({ pinned, current }) => pinned !== 'unknown' && current !== 'unknown'), true);

    lock.versions.resvg = 'different-resvg-version';
    await resign(dir, lock);
    await assert.rejects(verifiedRasterInputs(dir), /resvg tool version drift or unknown pin/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('twenty offline V2 replays recompute every digest and re-rasterize final and transition samples against pinned PNGs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-replay-'));
  try {
    await fixture(dir);
    const digests = [];
    for (let i = 0; i < 20; i++) digests.push(await replayLessonV2(dir));
    assert.deepEqual(compareReplayDigests(digests), { replays: 20, identical: true, mismatches: [] });
    assert.ok(Object.values(digests[0]!).every((hash) => /^[0-9a-f]{64}$/.test(hash)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 verification rejects tampered context, scene, audio, SVG, font, and raster sample pins before replay or export', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-tamper-'));
  try {
    const lock = await fixture(dir);
    const paths = ['v2/lesson-context.json', 'v2/alignment.json', lock.scenes[0]!.file, lock.scenes[0]!.audioFile, lock.media.audio.file, lock.svgAssets[0]!.file, lock.font.file];
    for (const rel of paths) {
      const file = path.join(dir, rel); const original = await readFile(file);
      await writeFile(file, Buffer.concat([original, Buffer.from('edited')]));
      assert.ok((await verifyLessonLockV2(dir)).length > 0, rel);
      await assert.rejects(replayLessonV2(dir), /verification/i);
      await assert.rejects(encodeLockedLessonV2(dir, path.join(dir, 'rejected.mp4')), /verification/i);
      await writeFile(file, original);
    }
    lock.samples[0]!.pngHash = '0'.repeat(64);
    await resign(dir, lock);
    await assert.rejects(replayLessonV2(dir), /raster|sample|PNG/i, 'replay independently checks raster pins');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 fails closed on unknown tool pins, malformed frame ranges and paths escaping the run, including symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-safety-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'v2-lock-outside-'));
  try {
    const initial = await fixture(dir);
    for (const key of ['node', 'pipeline', 'resvg', 'roughjs', 'ffmpeg'] as const) {
      const lock = structuredClone(initial); lock.versions[key] = 'unknown'; await resign(dir, lock);
      assert.ok((await verifyLessonLockV2(dir)).some((s) => s.includes(key)), key);
    }
    const invalid = structuredClone(initial); invalid.renderPlan[0]!.firstFrame = 2; await resign(dir, invalid);
    assert.ok((await verifyLessonLockV2(dir)).some((s) => /range|frame|plan/.test(s)));
    const escaped = structuredClone(initial); escaped.scenes[0]!.file = '../outside.json'; await resign(dir, escaped);
    assert.ok((await verifyLessonLockV2(dir)).some((s) => /path|outside|escape/.test(s)));
    await resign(dir, initial);
    const target = path.join(dir, initial.svgAssets[0]!.file);
    const bytes = await readFile(target); await writeFile(path.join(outside, 'frame.svg'), bytes);
    await rm(target); await symlink(path.join(outside, 'frame.svg'), target);
    assert.ok((await verifyLessonLockV2(dir)).some((s) => /path|outside|escape/.test(s)));
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});


test('V2 pins full word alignment, rejects malformed clocks and mismatched narration even after re-signing, and hashes alignment bytes in replay', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-alignment-'));
  try {
    const initial = await fixture(dir);
    assert.equal(initial.alignment.file, 'v2/alignment.json');
    const before = await replayLessonV2(dir);
    const file = path.join(dir, initial.alignment.file);
    const valid = JSON.parse(await readFile(file, 'utf8'));
    const edits: Array<(record: typeof valid) => void> = [
      (record) => { record.scenes[0].words[0].endMs = record.scenes[0].words[0].startMs; },
      (record) => { record.scenes[0].words[1].startMs = 100; },
      (record) => { record.scenes[0].words[3].endMs = 2001; },
      (record) => { record.scenes[0].durationMs = 0; },
      (record) => { record.scenes[0].words[1].word = 'changed'; },
      (record) => { record.scenes[0].repairedWordIndexes = [99]; },
      (record) => { record.scenes[0].calibration = { status: 'measured' }; },
      (record) => { record.scenes = []; },
    ];
    for (const edit of edits) {
      const record = structuredClone(valid); edit(record);
      const bytes = JSON.stringify(record); await writeFile(file, bytes);
      const lock = structuredClone(initial); lock.alignment.hash = createHash('sha256').update(bytes).digest('hex'); await resign(dir, lock);
      assert.ok((await verifyLessonLockV2(dir)).some((problem) => /alignment|word|narration|calibration/.test(problem)), bytes);
      await assert.rejects(replayLessonV2(dir), /verification/);
    }
    const reformatted = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(file, reformatted);
    const reformattedLock = structuredClone(initial); reformattedLock.alignment.hash = createHash('sha256').update(reformatted).digest('hex'); await resign(dir, reformattedLock);
    const after = await replayLessonV2(dir);
    assert.notEqual(after.events, before.events, 'events digest commits to raw measured alignment bytes');
    assert.equal(after.frames, before.frames);
    await rm(file);
    assert.ok((await verifyLessonLockV2(dir)).some((problem) => /alignment/.test(problem)), 'alignment is mandatory');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a complete canonical V2 lock survives missing compatibility alias and retains exclusive publication', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-canonical-'));
  try {
    await fixture(dir);
    const primary = await readFile(path.join(dir, 'lesson.lock.json'));
    await rm(path.join(dir, 'lesson.lock.v2.json'));
    assert.deepEqual(await verifyLessonLockV2(dir), []);
    await replayLessonV2(dir);
    await assert.rejects(fixture(dir), /exist|published|lock/i);
    assert.deepEqual(await readFile(path.join(dir, 'lesson.lock.json')), primary);
    assert.ok(!(await readdir(dir)).some((file) => file.endsWith('.partial.json')));
    await writeFile(path.join(dir, 'lesson.lock.v2.json'), '{}');
    assert.ok((await verifyLessonLockV2(dir)).some((problem) => /differ|alias/.test(problem)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('locked export encodes a verified audio snapshot despite source mutation and cleans temporary audio and video on success', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-lock-audio-snapshot-'));
  try {
    const lock = await fixture(dir);
    const originalPath = path.join(dir, lock.media.audio.file);
    const verifiedAudio = await readFile(originalPath);
    let snapshotPath = ''; let closes = 0; let writes = 0;
    const outPath = path.join(dir, 'encoded.mp4');
    const result = await encodeLockedLessonV2(dir, outPath, {
      createRasterPool: () => ({ render: async () => Buffer.from('fake-png'), close: async () => { closes++; } }),
      spawnEncoder: (partial, _fps, audioPath) => {
        snapshotPath = audioPath;
        assert.notEqual(snapshotPath, originalPath, 'ffmpeg input is a private WAV snapshot');
        writeFileSync(originalPath, 'changed after verification');
        assert.ok(readFileSync(snapshotPath).equals(verifiedAudio), 'encoder WAV matches verified bytes despite source mutation');
        return { write: async () => { writes++; }, end: () => { writeFileSync(partial, 'completed synthetic encode'); }, abort: () => {}, done: Promise.resolve(), args: [] };
      },
    });
    assert.equal(writes, lock.render.frames); assert.equal(result.frames, lock.render.frames); assert.equal(closes, 1);
    assert.equal(await readFile(outPath, 'utf8'), 'completed synthetic encode');
    await assert.rejects(readFile(snapshotPath), /ENOENT/);
    assert.ok(!(await readdir(dir)).some((file) => file.includes('.partial.')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

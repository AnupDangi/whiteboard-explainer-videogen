import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runLessonV2 } from '../pipeline-v2/runLessonV2.js';
import { compileBeatPlan } from '../teaching/beat-plan/compile.js';
import { BeatPlanDraftSchema } from '../teaching/beat-plan/types.js';
import { compileSceneNarration } from '../narration/beat-narration/compile.js';
import { SceneNarrationDraftSchema } from '../narration/beat-narration/types.js';
import type { PreparedLesson } from '../run/lesson.js';
import type { ModelClient } from '../llm/modelClient.js';
import { runFfmpeg, probeMediaDurationMs } from '../export/ffmpeg.js';
import { tokenizeWords } from '../narration/align.js';
import { replayLessonV2, verifyLessonLockV2 } from '../pipeline-v2/lockV2.js';
import { compareReplayDigests } from '../harness/replayDeterminism.js';
import { canonicalHash } from '../harness/replayDeterminism.js';
import { sha256 } from '../shared/artifacts.js';
import { PIPELINE } from '../run/config.js';

// A contract test for the V2 runner with injected model and aligner. The lesson content is synthetic test data, not a generated lesson.
const claims = (id: string) => [{ id: `${id}_c`, statement: 'x', conceptIds: ['frame', 'stack'], relations: [], evidenceSpanIds: ['s1'] }];
const beatDraft = (sceneId: string) => BeatPlanDraftSchema.parse({ beats: [{
  claimIds: [`${sceneId}_c`], learnerDelta: 'd', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model', entities: [{ conceptId: 'frame' }, { conceptId: 'stack' }],
  relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
}] });
const ctxFor = (sceneId: string) => ({ sceneId, conceptIds: ['frame', 'stack'], claims: claims(sceneId), relations: [], misconceptionIds: [], durationSec: 6 });
const sceneIds = ['one', 'two'];
const beatPlans = Object.fromEntries(sceneIds.map((id) => [id, compileBeatPlan(beatDraft(id), ctxFor(id))]));
const sentences: Record<string, string[]> = { one: ['Each call pushes a frame onto the stack.', 'The newest frame sits on top.'], two: ['A return pops the top frame.', 'The stack shrinks again.'] };
const narrations = Object.fromEntries(sceneIds.map((id) => [id, compileSceneNarration(id, SceneNarrationDraftSchema.parse({ beats: [{ beatId: `${id}.b1`, sentences: sentences[id], claimSentences: [{ claimId: `${id}_c`, sentenceIndex: 0 }], emphasisTerms: [] }] }), beatPlans[id]!)]));
const plan = { targetDurationSec: 10, intro: { sourceTitle: 't', sections: [] }, recap: { keyPoints: [] }, sections: sceneIds.map((id) => ({ id, title: `Scene ${id}`, goal: 'g', kind: 'explain', conceptIds: ['frame', 'stack'], budgetSec: 6, contract: { learningDelta: 'd', targetDurationSec: 6, requiredConceptIds: ['frame', 'stack'], requiredRelations: [], evidenceSpanIds: ['s1'], essentialClaims: claims(id), teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } })) };
const graph = { concepts: [{ id: 'frame', label: 'Frame', kind: 'entity', definition: 'd', evidence: [], level: 'one-step' }, { id: 'stack', label: 'Stack', kind: 'entity', definition: 'd', evidence: [], level: 'one-step' }], relations: [], prerequisites: [] };
const prepared = { plan, graph, beatPlans, beatNarrations: narrations } as unknown as PreparedLesson;
const oneBindings = { conceptIds: ['frame', 'stack'], claimIds: ['one_c'] };
const twoBindings = { conceptIds: ['frame', 'stack'], claimIds: ['two_c'] };
const fixtureDurationSec = (perWordMs: number, sceneOverheadMs: number): number => (
  Object.values(narrations).reduce((sum, narration) => sum + tokenizeWords(narration.text).length * perWordMs + sceneOverheadMs, 0)
  + PIPELINE.sceneGapMs + 1200
) / 1000;

const board: Record<string, unknown> = {
  one: { transition: { mode: 'clean' }, ops: [
    { op: 'add', opId: 'o1', beatId: 'one.b1', id: 'pile', element: { type: 'kit', kit: 'stack', label: 'stack', paramsJson: '{}', provenance: 'metaphorical', bindings: oneBindings }, at: { region: 'center' }, cue: 0 },
    { op: 'add', opId: 'o2', beatId: 'one.b1', id: 'f1', element: { type: 'entity', conceptId: 'frame', label: 'frame', provenance: 'illustrative', bindings: oneBindings }, at: { region: 'center', container: 'pile', slot: 'top' }, cue: 0 },
    { op: 'add', opId: 'o3', beatId: 'one.b1', id: 'f2', element: { type: 'token', text: 'newest', provenance: 'illustrative', bindings: oneBindings }, at: { region: 'center', container: 'pile', slot: 'top' }, cue: 1 },
  ] },
  two: { transition: { mode: 'retain-all' }, ops: [
    { op: 'remove', opId: 'p1', beatId: 'two.b1', target: 'f2', cue: 0 },
    { op: 'highlight', opId: 'p2', beatId: 'two.b1', target: 'f1', cue: 1 },
    { op: 'add', opId: 'p3', beatId: 'two.b1', id: 'note', element: { type: 'text', text: 'stack shrinks', role: 'note', provenance: 'derived', bindings: twoBindings }, at: { region: 'bottom' }, cue: 1 },
  ] },
};
const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
const client: ModelClient = { provider: 'fake', chat: async (r) => { const scene = /SCENE (\w+)/.exec(r.user)?.[1] ?? ''; return { content: JSON.stringify(board[scene]), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }; } };

test('the V2 runner turns beats and narration into a retained-board video with real audio timing, captions, metrics and a scorecard', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lesson-v2-'));
  try {
    const aligner = async (text: string) => {
      const tokens = tokenizeWords(text);
      const words = tokens.map((word, i) => ({ word, startMs: i * 300, endMs: i * 300 + 260 }));
      const durationMs = tokens.length * 300 + 100;
      const audioPath = path.join(dir, `tmp-${tokens.length}-${Math.random().toString(36).slice(2)}.wav`);
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
      return { durationMs, words, aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
    };
    const out = path.join(dir, 'run');
    const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: out, prepared: { ...prepared, requestedDurationSec: fixtureDurationSec(300, 100) }, plannerModel: 'google/x', apiKey: 'k', client, aligner: aligner as never, fps: 8 });
    assert.equal(result.status, 'draft', JSON.stringify(result.failures));
    assert.equal(result.scenes, 2);
    assert.equal(result.metrics['v2.ops'], 6);
    assert.equal(result.metrics['v2.stateChangingOps'], 2, 'remove and highlight change the board');
    assert.equal(result.metrics['v2.visualBeatCoverage'], 1);
    assert.equal(result.metrics['v2.hardGeometryProblems'], 0);
    assert.ok(Number.isFinite(result.metrics['v2.requestToCompleteMs']));
    assert.equal(result.metrics['v2.timeToFirstPlayableMs'], undefined, 'a silent encoded clip is not audible-playable readiness');
    assert.ok(result.compiled[1]!.timeline.states[0]!.elements.pile, 'scene two starts from the board scene one left');
    assert.ok(result.videoPath && (await stat(result.videoPath)).size > 1000);
    const ms = await probeMediaDurationMs(result.videoPath!);
    assert.ok(Math.abs(ms - result.durationMs) < 400, `video ${ms} vs ${result.durationMs}`);
    const vtt = await readFile(path.join(out, 'captions.vtt'), 'utf8');
    assert.match(vtt, /Each call pushes a frame onto the stack\./);
    assert.match(vtt, /A return pops the top frame\./);
    const scorecard = JSON.parse(await readFile(path.join(out, 'v2', 'scorecard.json'), 'utf8')) as { releaseCandidate: boolean; blockers: string[] };
    assert.equal(scorecard.releaseCandidate, false, 'a synthetic run is never a release candidate');
    assert.ok(await stat(path.join(out, 'v2', 'scene.one.json')));
    await writeFile(path.join(dir, 'done'), 'ok');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a scene whose board cannot be planned fails the run and nothing is rendered', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lesson-v2-fail-'));
  try {
    const bad: ModelClient = { provider: 'fake', chat: async () => ({ content: JSON.stringify({ transition: { mode: 'clean' }, ops: [{ op: 'remove', opId: 'x', beatId: 'one.b1', target: 'ghost' }] }), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }) };
    const aligner = async (text: string) => {
      const t = tokenizeWords(text);
      const durationMs = t.length * 200 + 100;
      const audioPath = path.join(dir, `a-${t.length}.wav`);
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
      return { durationMs, words: t.map((word, i) => ({ word, startMs: i * 200, endMs: i * 200 + 150 })), aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
    };
    const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: path.join(dir, 'run'), prepared: { ...prepared, requestedDurationSec: fixtureDurationSec(200, 100) }, plannerModel: 'google/x', apiKey: 'k', client: bad, aligner: aligner as never, fps: 8 });
    assert.equal(result.status, 'failed');
    assert.equal(result.videoPath, undefined);
    assert.ok(result.failures.some((f) => f.code === 'v2-board-failed' && f.hard));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 reports audio synthesis exceptions as failed runs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-audio-fail-'));
  try {
    const result = await runLessonV2({
      lessonId: 'audio-fail', outputDir: path.join(dir, 'run'), prepared, plannerModel: 'google/x', apiKey: 'k', client,
      aligner: (async () => { throw new Error('scripted provider timeout'); }) as never,
      onElevenLabsUsage: () => undefined,
    });
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some((failure) => failure.code === 'v2-audio-generation-failed' && /scripted provider timeout/.test(failure.message)));
    assert.ok(Array.isArray(result.providerUsageEvents));
    assert.equal(result.scenes, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid V2 word clocks stop before paid board planning and cannot publish a lock', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-invalid-clock-'));
  try {
    const audioPath = path.join(dir, 'silence.wav');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '2', audioPath]);
    for (const fault of ['zero', 'overlap', 'outside', 'nonfinite', 'duration']) {
      let boardCalls = 0;
      const model: ModelClient = { ...client, chat: async (request) => { boardCalls++; return client.chat(request); } };
      const aligner = async (text: string) => {
        const words = tokenizeWords(text).map((word, i) => ({ word, startMs: i * 100, endMs: i * 100 + 80 }));
        if (fault === 'zero') words[0]!.endMs = words[0]!.startMs;
        if (fault === 'overlap') words[1]!.startMs = words[0]!.endMs - 1;
        if (fault === 'outside') words.at(-1)!.endMs = 2001;
        if (fault === 'nonfinite') words[0]!.startMs = Number.NaN;
        return { durationMs: fault === 'duration' ? Number.NaN : 2000, words, aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
      };
      const outputDir = path.join(dir, fault);
      const result = await runLessonV2({ lessonId: 'invalid-clock', outputDir, prepared, plannerModel: 'google/x', apiKey: 'k', client: model, aligner: aligner as never, skipEncode: true });
      assert.equal(result.status, 'failed', fault);
      assert.ok(result.failures.some((failure) => failure.code === 'v2-invalid-alignment' && failure.hard), fault);
      assert.equal(boardCalls, 0, `${fault}: invalid audio must prevent paid board calls`);
      await assert.rejects(stat(path.join(outputDir, 'lesson.lock.json')), { code: 'ENOENT' });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a measured audio duration outside the request stops before paid board planning', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-duration-gate-'));
  try {
    const audioPath = path.join(dir, 'speech.wav');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '2', audioPath]);
    let boardCalls = 0;
    const model: ModelClient = { ...client, chat: async (request) => { boardCalls++; return client.chat(request); } };
    const aligner = async (text: string) => {
      const words = tokenizeWords(text).map((word, i) => ({ word, startMs: i * 100, endMs: i * 100 + 80 }));
      return { durationMs: 2000, words, aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
    };
    const result = await runLessonV2({
      lessonId: 'duration-gate', outputDir: path.join(dir, 'run'), prepared: { ...prepared, requestedDurationSec: 1 },
      plannerModel: 'google/x', apiKey: 'k', client: model, aligner: aligner as never, skipEncode: true,
    });
    assert.equal(result.status, 'failed');
    assert.equal(boardCalls, 0);
    assert.ok(result.failures.some((failure) => failure.code === 'v2-fixed-duration' && failure.hard));
    assert.ok(result.metrics['v2.actualDurationDeltaMs']! > 200);
    await assert.rejects(stat(path.join(dir, 'run', 'lesson.lock.v2.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function fixtureRun(dir: string): Promise<string> {
  const aligner = async (text: string) => {
    const tokens = tokenizeWords(text);
    const durationMs = tokens.length * 300 + 100;
    const audioPath = path.join(dir, `tmp-${tokens.length}-${Math.random().toString(36).slice(2)}.wav`);
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
    return { durationMs, words: tokens.map((word, i) => ({ word, startMs: i * 300, endMs: i * 300 + 260 })), aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
  };
  const out = path.join(dir, 'run');
  const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: out, prepared: { ...prepared, requestedDurationSec: fixtureDurationSec(300, 100) }, plannerModel: 'google/x', apiKey: 'k', client, aligner: aligner as never, skipEncode: true });
  assert.equal(result.status, 'draft', JSON.stringify(result.failures));
  return out;
}

test('the V2 lock pins ops, narration, timings, audio and versions before rendering, verifies, and detects any edit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v2-'));
  try {
    const out = await fixtureRun(dir);
    const lock = JSON.parse(await readFile(path.join(out, 'lesson.lock.v2.json'), 'utf8')) as { schemaVersion: string; scenes: Array<{ sceneId: string; fileHash: string; audioHash: string; timelineHash: string }>; versions: Record<string, string>; contentHash: string };
    assert.equal(lock.schemaVersion, 'lesson.lock/v5-teaching-compiler-v2');
    assert.equal(lock.scenes.length, 2);
    assert.ok(lock.scenes.every((scene) => scene.fileHash.length === 64 && scene.audioHash.length === 64 && scene.timelineHash.length === 64));
    assert.ok(lock.versions.resvg && lock.versions.roughjs && lock.versions.pipeline);
    assert.deepEqual(await verifyLessonLockV2(out), []);
    const scenePath = path.join(out, 'v2', 'scene.one.json');
    const original = await readFile(scenePath, 'utf8');
    await writeFile(scenePath, original.replace('"cue": 0', '"cue": 1'));
    assert.ok((await verifyLessonLockV2(out)).some((p) => /scene one.*hash/.test(p)));
    await writeFile(scenePath, original);
    assert.deepEqual(await verifyLessonLockV2(out), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('replaying a V2 lock twenty times gives identical ops, geometry, events, assets, audio and frames without any model call', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-replay-v2-'));
  try {
    const out = await fixtureRun(dir);
    const digests = [];
    for (let i = 0; i < 20; i++) digests.push(await replayLessonV2(out));
    assert.deepEqual(compareReplayDigests(digests), { replays: 20, identical: true, mismatches: [] });
    assert.match(digests[0]!.frames, /^[0-9a-f]{64}$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 lock v5 remains readable when an earlier capture has no lifecycle event field', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-legacy-lock-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { scenes: Array<{ captured: { file: string; hash: string }; timelineHash: string }>; contentHash: string };
    const scene = lock.scenes[0]!;
    const capturedPath = path.join(out, scene.captured.file);
    const captured = JSON.parse(await readFile(capturedPath, 'utf8')) as { timeline: { ops: Array<{ op: { opId: string }; t0: number; t1: number }>; lifecycleEvents?: unknown[]; hash: string } };
    delete captured.timeline.lifecycleEvents;
    const capturedBytes = `${JSON.stringify(captured, null, 2)}\n`;
    await writeFile(capturedPath, capturedBytes);
    scene.captured.hash = sha256(capturedBytes);
    scene.timelineHash = canonicalHash(captured.timeline.ops.map((op) => [op.op.opId, Math.round(op.t0), Math.round(op.t1)]));
    captured.timeline.hash = scene.timelineHash;
    const legacyCapturedBytes = `${JSON.stringify(captured, null, 2)}\n`;
    await writeFile(capturedPath, legacyCapturedBytes);
    scene.captured.hash = sha256(legacyCapturedBytes);
    const { contentHash: _oldHash, ...body } = lock;
    lock.contentHash = canonicalHash(body);
    const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, lockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);
    assert.deepEqual(await verifyLessonLockV2(out), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

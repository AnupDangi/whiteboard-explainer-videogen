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
import { readyPrefixV2, replayLessonV2, verifyLessonLockV2 } from '../pipeline-v2/lockV2.js';
import { compareReplayDigests } from '../harness/replayDeterminism.js';
import { canonicalHash } from '../harness/replayDeterminism.js';
import { sha256 } from '../shared/artifacts.js';
import { PIPELINE } from '../run/config.js';
import { DEFAULT_PACING } from '../pipeline-v2/durationFit.js';
import { pathToFileURL } from 'node:url';
import { resolveSourceEvidence, sourceDocFromText } from '../intake/sourceDoc.js';

// A contract test for the V2 runner with injected model and aligner. The lesson content is synthetic test data, not a generated lesson.
const sentences: Record<string, string[]> = { one: ['Each call pushes a frame onto the stack.', 'The newest frame sits on top.'], two: ['A return pops the top frame.', 'The stack shrinks again.'] };
const sourceDoc = sourceDocFromText(Object.values(sentences).flat().join('\n'));
const sourceEvidenceFor = (quote: string) => {
  const span = sourceDoc.spans.find((candidate) => candidate.text.includes(quote));
  const evidence = span ? resolveSourceEvidence(sourceDoc, span.id, quote) : undefined;
  if (!evidence?.documentSha256 || !evidence.quoteSha256) throw new Error(`fixture source evidence is not hash-pinned: ${quote}`);
  return evidence;
};
const claims = (id: string) => {
  const statement = sentences[id]![0]!;
  const evidence = sourceEvidenceFor(statement);
  return [{
    id: `${id}_c`, statement, epistemicType: 'direct_source' as const, conceptIds: ['frame', 'stack'], relations: [], evidenceSpanIds: [evidence.spanId],
    sourceRefs: [{ documentId: evidence.sourceId, sourceHash: evidence.documentSha256!, spanId: evidence.spanId, startOffset: evidence.startChar, endOffset: evidence.endChar, quoteHash: evidence.quoteSha256!, sourceRole: evidence.sourceRole ?? 'primary' }],
  }];
};
const beatDraft = (sceneId: string) => BeatPlanDraftSchema.parse({ beats: [{
  claimIds: [`${sceneId}_c`], learnerDelta: 'd', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model', entities: [{ conceptId: 'frame' }, { conceptId: 'stack' }],
  relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
}] });
const ctxFor = (sceneId: string) => ({ sceneId, conceptIds: ['frame', 'stack'], claims: claims(sceneId), relations: [], misconceptionIds: [], durationSec: 6 });
const sceneIds = ['one', 'two'];
const beatPlans = Object.fromEntries(sceneIds.map((id) => [id, compileBeatPlan(beatDraft(id), ctxFor(id))]));
const narrations = Object.fromEntries(sceneIds.map((id) => [id, compileSceneNarration(id, SceneNarrationDraftSchema.parse({ beats: [{ beatId: `${id}.b1`, sentences: sentences[id], claimSentences: [{ claimId: `${id}_c`, sentenceIndex: 0 }], emphasisTerms: [] }] }), beatPlans[id]!)]));
const plan = { targetDurationSec: 10, intro: { sourceTitle: 't', sections: [] }, recap: { keyPoints: [] }, sections: sceneIds.map((id) => ({ id, title: `Scene ${id}`, goal: 'g', kind: 'explain', conceptIds: ['frame', 'stack'], budgetSec: 6, contract: { learningDelta: 'd', targetDurationSec: 6, requiredConceptIds: ['frame', 'stack'], requiredRelations: [], evidenceSpanIds: claims(id)[0]!.evidenceSpanIds, essentialClaims: claims(id), teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } })) };
const graphEvidence = Object.values(sentences).flatMap((items) => [sourceEvidenceFor(items[0]!)]);
const graph = { concepts: [{ id: 'frame', label: 'Frame', kind: 'entity', definition: 'd', evidence: graphEvidence, level: 'one-step' }, { id: 'stack', label: 'Stack', kind: 'entity', definition: 'd', evidence: graphEvidence, level: 'one-step' }], relations: [], prerequisites: [] };
const prepared = { plan, graph, sourceDoc, beatPlans, beatNarrations: narrations } as unknown as PreparedLesson;
const oneBindings = { conceptIds: ['frame', 'stack'], claimIds: ['one_c'] };
const twoBindings = { conceptIds: ['frame', 'stack'], claimIds: ['two_c'] };
const fixtureDurationSec = (perWordMs: number, sceneOverheadMs: number): number => (
  Object.values(narrations).reduce((sum, narration) => sum + tokenizeWords(narration.text).length * perWordMs + sceneOverheadMs, 0)
  + PIPELINE.sceneGapMs + 1200
) / 1000;
async function listFiles(root: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await (await import('node:fs/promises')).readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

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
    const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: out, prepared: { ...prepared, groundingMode: 'SOURCE_PLUS_BACKGROUND', requestedDurationSec: fixtureDurationSec(300, 100) }, plannerModel: 'google/x', apiKey: 'k', client, aligner: aligner as never, fps: 8 });
    assert.equal(result.status, 'draft', JSON.stringify(result.failures));
    assert.equal(result.artifactCertification.artifactStatus, 'DRAFT', 'an encoded video is still a draft while required QA gates are unmeasured');
    assert.ok(result.artifactCertification.artifactGates.some((gate) => gate.id === 'complete-semantic-qa-suite' && gate.status === 'unmeasured'));
    assert.equal(result.scenes, 2);
    assert.equal(result.metrics['v2.ops'], 6);
    assert.equal(result.metrics['v2.stateChangingOps'], 2, 'remove and highlight change the board');
    assert.equal(result.metrics['v2.visualBeatCoverage'], 1);
    assert.equal(result.metrics['v2.hardGeometryProblems'], 0);
    assert.equal(result.metrics['v2.pictorialEntities'], 1, 'the exact vendored frame icon is counted after scene-family filtering');
    assert.equal(result.metrics['v2.scenesWithIconFamily'], 2);
    const lessonContext = JSON.parse(await readFile(path.join(out, 'v2', 'lesson-context.json'), 'utf8')) as {
      schemaVersion: string;
      groundingMode: string;
      plan: { sections: Array<{ contract: { essentialClaims: Array<{ epistemicType?: string }> } }> };
      evidenceLedger: { groundingMode: string; claims: Array<{ epistemicType: string; sourceRefs: Array<Record<string, unknown>> }> };
    };
    assert.equal(lessonContext.schemaVersion, 'lesson-context/v3');
    assert.equal(lessonContext.groundingMode, 'SOURCE_PLUS_BACKGROUND');
    assert.equal(lessonContext.evidenceLedger.groundingMode, 'SOURCE_PLUS_BACKGROUND');
    assert.ok(lessonContext.plan.sections.flatMap((section) => section.contract.essentialClaims).every((claim) => claim.epistemicType === 'direct_source'));
    assert.ok(lessonContext.evidenceLedger.claims.every((claim) => claim.epistemicType === 'direct_source'));
    assert.ok(lessonContext.evidenceLedger.claims.flatMap((claim) => claim.sourceRefs).every((ref) => !('spanId' in ref)), 'the ledger stores hash-pinned document ranges; plan span identity remains in the canonical plan');
    const iconFamilies = JSON.parse(await readFile(path.join(out, 'v2', 'scene-icon-families.json'), 'utf8')) as { scenes: Array<{ sceneId: string; houseFamily: string | null }> };
    assert.ok(iconFamilies.scenes.every((scene) => scene.houseFamily === 'simi-house-v1/domain-outline'));
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
    // Each scene was frozen as its board compiled; the whole run is therefore a playable prefix, in order, with timing recorded.
    const ready = await readyPrefixV2(out);
    assert.deepEqual(ready.scenes.map((scene) => scene.sceneId), ['one', 'two']);
    assert.equal(ready.readyThroughMs, result.durationMs);
    const progress = JSON.parse(await readFile(path.join(out, 'v2', 'progress.json'), 'utf8')) as { events: Array<{ sceneId: string; sinceRequestMs: number }> };
    assert.deepEqual(progress.events.map((event) => event.sceneId), ['one', 'two']);
    assert.ok(progress.events[0]!.sinceRequestMs <= progress.events[1]!.sinceRequestMs);
    assert.ok(Number.isFinite(result.metrics['v2.requestToFirstReadySceneMs']) && result.metrics['v2.requestToFirstReadySceneMs']! <= result.metrics['v2.requestToCompleteMs']!);

    // A portable review bundle must verify from its own files and reject any later byte change.
    const evaluation = {
      schemaVersion: 'evaluation-bundle/v2', runId: 'bundle-fixture', caseId: 'synthetic-stack', status: result.status,
      artifactCertification: result.artifactCertification, metrics: result.metrics, failures: result.failures,
    };
    await writeFile(path.join(out, 'evaluation-bundle.json'), `${JSON.stringify(evaluation, null, 2)}\n`);
    const lock = JSON.parse(await readFile(path.join(out, 'lesson.lock.v2.json'), 'utf8')) as { scenes: Array<{ sceneId: string; audioHash: string; captured: { file: string } }>; renderPlan: Array<{ kind: 'hold' | 'transition'; sceneId: string; firstFrame: number; frameCount: number; svgHash?: string; svgHashes?: string[] }> };
    const firstScene = lock.scenes[0]!;
    const capturedScene = JSON.parse(await readFile(path.join(out, firstScene.captured.file), 'utf8')) as { concepts: Array<[string, { houseFamily?: string }]> };
    assert.ok(capturedScene.concepts.every(([, concept]) => concept.houseFamily === 'simi-house-v1/domain-outline'), 'the lock pins the chosen icon family for deterministic replay');
    const firstSegment = lock.renderPlan.find((segment) => segment.firstFrame === 0)!;
    const firstFrameHash = firstSegment.kind === 'hold' ? firstSegment.svgHash! : firstSegment.svgHashes![0]!;
    const acceptedAtEpochMs = 1000;
    await writeFile(path.join(out, 'run-start.json'), `${JSON.stringify({ schemaVersion: 'hypothesis-run-start/v1', runId: 'bundle-fixture', acceptedAtEpochMs })}\n`);
    const artifactSha256 = Object.fromEntries(await Promise.all((await listFiles(out)).map(async (relative) => [relative, sha256(await readFile(path.join(out, relative)))] as const)));
    const manifest = {
      schemaVersion: 'run-manifest/v1', runId: 'bundle-fixture', caseId: 'synthetic-stack', status: result.status,
      artifactSha256, configHash: 'fixture-config', executionTiming: { requestToCompleteMs: result.metrics['v2.requestToCompleteMs'] },
      stages: { sourceDoc: { sha256: 'fixture-source' }, preparationStages: [] },
    };
    await writeFile(path.join(out, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const playerEvent = {
      schemaVersion: 'hypothesis-first-audio-playback/v2', type: 'player.first-audio-playback',
      eventId: 'session-bundle:first-audio-playback/v2', runId: 'bundle-fixture', sessionId: 'session-bundle',
      measurementSource: 'browser-player', requestAcceptedAtEpochMs: acceptedAtEpochMs, browserTimeOriginMs: 1000,
      playerLoadedMonoMs: 10, firstFrameReadyMonoMs: 20, userPlayMonoMs: 100, playerStartMonoMs: 110,
      firstAudioPlaybackMonoMs: 250, readyToUserPlayMs: 80, userPlayToPlayerStartMs: 10,
      playerStartToFirstAudioMs: 140, userPlayToFirstAudioMs: 150, playerLoadToFirstAudioMs: 240,
      requestToFirstAudioMs: 250, audioCurrentTimeSec: 0.08, audioUrl: '/locked/audio.wav', observedFrame: 0,
      observedFrameHash: firstFrameHash, initial: { sceneId: firstScene.sceneId, frame: 0, frameHash: firstFrameHash, sceneAudioHash: firstScene.audioHash },
    };
    await writeFile(path.join(out, 'player-telemetry.jsonl'), `${JSON.stringify(playerEvent)}\n`);
    const bundleModule = await import(pathToFileURL(path.resolve('scripts/v2-review-bundle.mjs')).href) as {
      createReviewBundle: (source: string, destination: string) => Promise<{ verified: boolean }>;
      verifyReviewBundle: (bundle: string) => Promise<{ verified: boolean }>;
    };
    const bundleDir = path.join(dir, 'review-bundle');
    assert.equal((await bundleModule.createReviewBundle(out, bundleDir)).verified, true);
    const timing = JSON.parse(await readFile(path.join(bundleDir, 'timings.json'), 'utf8')) as { firstAudiblePlayableMs: number; playerTelemetry: unknown[] };
    assert.equal(timing.firstAudiblePlayableMs, 250);
    assert.equal(timing.playerTelemetry.length, 1);
    assert.equal((await readFile(path.join(bundleDir, 'player-telemetry.jsonl'), 'utf8')).trim(), JSON.stringify(playerEvent));
    const bundledVideo = path.join(bundleDir, 'video.mp4');
    const videoBytes = await readFile(bundledVideo);
    await writeFile(bundledVideo, Buffer.concat([videoBytes, Buffer.from('tamper')]));
    await assert.rejects(bundleModule.verifyReviewBundle(bundleDir), /bundle hash mismatch: video\.mp4/);
    await writeFile(bundledVideo, videoBytes);
    assert.equal((await bundleModule.verifyReviewBundle(bundleDir)).verified, true);
    await writeFile(path.join(dir, 'done'), 'ok');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('with the fallback off, a scene whose board cannot be planned fails the run and nothing is rendered', async () => {
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
    const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: path.join(dir, 'run'), boardFallback: false, prepared: { ...prepared, failures: [{ code: 's1-hard', stage: 'S1', message: 'synthetic preparation hard failure', hard: true }], requestedDurationSec: fixtureDurationSec(200, 100) }, plannerModel: 'google/x', apiKey: 'k', client: bad, aligner: aligner as never, fps: 8 });
    assert.equal(result.status, 'failed');
    assert.equal(result.artifactCertification.artifactStatus, 'FAILED', 'a run without a valid video artifact is failed');
    assert.equal(result.videoPath, undefined);
    assert.ok(result.failures.some((f) => f.code === 'v2-board-failed' && f.hard));
    assert.equal(result.artifactCertification.artifactGates.find((gate) => gate.id === 'no-hard-failures')?.status, 'failed', 'preparation failures are included in certification evidence');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a scene whose model board cannot be validated uses the deterministic fallback: a draft with a soft failure per scene, never a pass', async () => {
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
    assert.equal(result.failures.some((f) => f.hard), false, JSON.stringify(result.failures.filter((f) => f.hard)));
    assert.equal(result.status, 'draft');
    assert.equal(result.artifactCertification.artifactStatus, 'DRAFT');
    assert.equal(result.scenes, 2);
    assert.equal(result.metrics['v2.fallbackScenes'], 2);
    assert.equal(result.failures.filter((f) => f.code === 'v2-board-fallback' && !f.hard).length, 2);
    assert.ok(result.failures.some((f) => f.code === 'board-ops-repair-failed-fallback' && !f.hard), 'the model failure stays on record, as a soft failure');
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
      const model: ModelClient = { ...client, chat: async (request) => { if (!/REVISION/.test(request.user)) boardCalls++; return client.chat(request); } };
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
    const model: ModelClient = { ...client, chat: async (request) => { if (!/REVISION/.test(request.user)) boardCalls++; return client.chat(request); } };
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

test('the V2 lock rejects an untyped claim in a rehashed lesson-context/v3', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v3-epistemic-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { context: { file: string; hash: string }; contentHash: string };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as {
      schemaVersion: string;
      plan: { sections: Array<{ contract: { essentialClaims: Array<Record<string, unknown>> } }> };
    };
    assert.equal(context.schemaVersion, 'lesson-context/v3');
    delete context.plan.sections[0]!.contract.essentialClaims[0]!.epistemicType;
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, contextBytes);
    lock.context.hash = sha256(contextBytes);
    const { contentHash: _oldHash, ...body } = lock;
    lock.contentHash = canonicalHash(body);
    const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, lockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);

    const problems = await verifyLessonLockV2(out);
    assert.ok(problems.some((problem) => /canonical plan claim one_c has no valid epistemicType/.test(problem)), problems.join('\n'));
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

// --- Fitting speech to the requested runtime: pacing first, then a claim-preserving rewrite measured against real audio ---
const msPerWord = 300;
const speechAligner = (dir: string) => async (text: string) => {
  const tokens = tokenizeWords(text);
  const durationMs = tokens.length * msPerWord + 100;
  const audioPath = path.join(dir, `fit-${tokens.length}-${Math.random().toString(36).slice(2)}.wav`);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
  return { durationMs, words: tokens.map((word, i) => ({ word, startMs: i * msPerWord, endMs: i * msPerWord + 260 })), aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
};
const shorter: Record<string, string[]> = { one: ['Each call pushes a frame onto the stack.', 'It sits on top.'], two: ['A return pops the top frame.'] };
const reviser = (calls: string[], reply: Record<string, string[]> = shorter): ModelClient => ({
  provider: 'fake',
  chat: async (request) => {
    if (/REVISION/.test(request.user)) {
      const scene = /SCENE (\w+)/.exec(request.user)?.[1] ?? '';
      calls.push(scene);
      return { content: JSON.stringify({ beats: [{ beatId: `${scene}.b1`, sentences: reply[scene], claimSentences: [{ claimId: `${scene}_c`, sentenceIndex: 0 }], emphasisTerms: [] }] }), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage };
    }
    return client.chat(request);
  },
});
const speechMs = (perScene: Record<string, string[]>) => Object.values(perScene).reduce((sum, list) => sum + tokenizeWords(list.join(' ')).length * msPerWord + 100, 0);

test('speech within the pause bounds is fitted by moving the gaps and final hold only: no rewrite, an exact runtime', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-pacing-'));
  try {
    const natural = speechMs(sentences) + PIPELINE.sceneGapMs + 1200;
    const requestedMs = natural + 700;
    const calls: string[] = [];
    const result = await runLessonV2({ lessonId: 'pacing', outputDir: path.join(dir, 'run'), prepared: { ...prepared, requestedDurationSec: requestedMs / 1000 }, plannerModel: 'google/x', apiKey: 'k', client: reviser(calls), aligner: speechAligner(dir) as never, skipEncode: true });
    assert.equal(result.status, 'draft', JSON.stringify(result.failures));
    assert.deepEqual(calls, [], 'no narration rewrite was needed');
    assert.equal(result.durationMs, requestedMs, 'the runtime is exact');
    assert.equal(result.metrics['v2.actualDurationDeltaMs'], 0);
    assert.equal(result.metrics['v2.durationRevisionRounds'], 0);
    assert.ok(result.metrics['v2.pacingGapMs']! > PIPELINE.sceneGapMs || result.metrics['v2.pacingTrailingMs']! > 1200);
    assert.deepEqual(await verifyLessonLockV2(path.join(dir, 'run')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('speech far too long is rewritten to a measured word budget, re-synthesized, and the lesson then lands exactly on the request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-revise-'));
  try {
    const requestedMs = speechMs(shorter) + PIPELINE.sceneGapMs + 1200 + 300;
    assert.ok(speechMs(sentences) + DEFAULT_PACING.gapMs.min + DEFAULT_PACING.trailingMs.min > requestedMs, 'even the shortest pauses cannot fit the original narration');
    const calls: string[] = [];
    const result = await runLessonV2({ lessonId: 'revise', outputDir: path.join(dir, 'run'), prepared: { ...prepared, requestedDurationSec: requestedMs / 1000 }, plannerModel: 'google/x', apiKey: 'k', client: reviser(calls), aligner: speechAligner(dir) as never, skipEncode: true });
    assert.equal(result.status, 'draft', JSON.stringify(result.failures));
    assert.deepEqual(calls.sort(), ['one', 'two'], 'each scene was rewritten once');
    assert.equal(result.metrics['v2.durationRevisionRounds'], 1);
    assert.equal(result.durationMs, requestedMs);
    const vtt = await readFile(path.join(dir, 'run', 'captions.vtt'), 'utf8');
    assert.match(vtt, /It sits on top\./, 'captions carry the revised speech');
    assert.doesNotMatch(vtt, /The newest frame sits on top\./);
    const context = JSON.parse(await readFile(path.join(dir, 'run', 'v2', 'lesson-context.json'), 'utf8')) as { beatNarrations: Record<string, { text: string }> };
    assert.match(context.beatNarrations.one!.text, /It sits on top\./, 'the lock pins the revised narration, not the original');
    assert.ok(result.reports.some((report) => report.stage === 'beat-narration'), 'the rewrite is accounted as a structured call');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a rewrite that still cannot fit the runtime fails closed before any board is planned, naming the measured gap', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-revise-fail-'));
  try {
    const requestedMs = speechMs(shorter) + PIPELINE.sceneGapMs + 1200;
    let boards = 0;
    const calls: string[] = [];
    const stubborn = reviser(calls, sentences);
    const counting: ModelClient = { ...stubborn, chat: async (request) => { if (!/REVISION/.test(request.user)) boards++; return stubborn.chat(request); } };
    const result = await runLessonV2({ lessonId: 'revise-fail', outputDir: path.join(dir, 'run'), prepared: { ...prepared, requestedDurationSec: requestedMs / 1000 }, plannerModel: 'google/x', apiKey: 'k', client: counting, aligner: speechAligner(dir) as never, skipEncode: true });
    assert.equal(result.status, 'failed');
    assert.equal(boards, 0, 'no board call was paid for');
    assert.ok(result.failures.some((failure) => failure.hard && /v2-(fixed-duration|duration-revision)/.test(failure.code)), JSON.stringify(result.failures.map((f) => f.code)));
    await assert.rejects(stat(path.join(dir, 'run', 'lesson.lock.v2.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

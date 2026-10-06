import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runLessonV2 } from '../pipeline-v2/runLessonV2.js';
import { compileBeatPlan } from '../teaching/beat-plan/compile.js';
import { BeatPlanDraftSchema } from '../teaching/beat-plan/types.js';
import { compileSceneNarration } from '../narration/beat-narration/compile.js';
import { renderSceneSvg } from '../visual-v2/renderer/frame.js';
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
    id: `${id}_c`, statement, epistemicType: 'direct_source' as const, verificationStatus: 'source_cited' as const, conceptIds: ['frame', 'stack'], relations: [], evidenceSpanIds: [evidence.spanId],
    sourceRefs: [{ documentId: evidence.sourceId, sourceHash: evidence.documentSha256!, spanId: evidence.spanId, startOffset: evidence.startChar, endOffset: evidence.endChar, quoteHash: evidence.quoteSha256!, sourceRole: evidence.sourceRole ?? 'primary' }],
  }];
};
const beatDraft = (sceneId: string) => BeatPlanDraftSchema.parse({ beats: [{
  claimIds: [`${sceneId}_c`], learnerDelta: 'd', learningQuestion: 'What changes in the stack?', learnerBefore: 'The learner knows the stack can hold frames.', learnerAfter: 'The learner can trace how the top frame changes.', dependsOnOrders: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model', entities: [{ identityKey: 'frame_main', conceptId: 'frame' }, { identityKey: 'stack_main', conceptId: 'stack' }], semanticRevealOrder: ['frame_main', 'stack_main'], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'introduce', toState: 'A frame appears.' }, { identityKey: 'stack_main', kind: 'introduce', toState: 'A stack contains the frame.' }],
  relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
}] });
const ctxFor = (sceneId: string) => ({ sceneId, conceptIds: ['frame', 'stack'], claims: claims(sceneId), relations: [], misconceptionIds: [], durationSec: 6 });
const sceneIds = ['one', 'two'];
const beatPlans = Object.fromEntries(sceneIds.map((id) => [id, compileBeatPlan(beatDraft(id), ctxFor(id))]));
const narrations = Object.fromEntries(sceneIds.map((id) => [id, compileSceneNarration(id, SceneNarrationDraftSchema.parse({ beats: [{
  beatId: `${id}.b1`, sentences: sentences[id], claimSentences: [{ claimId: `${id}_c`, sentenceIndex: 0 }],
  semanticAnchors: id === 'one'
    ? [{ semanticEventId: `${id}.b1.e1`, sentenceIndex: 0, phrase: 'pushes a frame' }, { semanticEventId: `${id}.b1.e2`, sentenceIndex: 0, phrase: 'onto the stack' }]
    : [{ semanticEventId: `${id}.b1.e1`, sentenceIndex: 0, phrase: 'pops the top frame' }, { semanticEventId: `${id}.b1.e2`, sentenceIndex: 1, phrase: 'stack shrinks' }],
  emphasisTerms: [],
}] }), beatPlans[id]!)]));
const plan = { targetDurationSec: 10, intro: { sourceTitle: 't', sections: [] }, recap: { keyPoints: [] }, sections: sceneIds.map((id) => ({ id, title: `Scene ${id}`, goal: 'g', kind: 'explain', conceptIds: ['frame', 'stack'], budgetSec: 6, contract: { learningDelta: 'd', targetDurationSec: 6, requiredConceptIds: ['frame', 'stack'], requiredRelations: [], evidenceSpanIds: claims(id)[0]!.evidenceSpanIds, essentialClaims: claims(id), teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } })) };
const graphEvidence = Object.values(sentences).flatMap((items) => [sourceEvidenceFor(items[0]!)]);
const graph = { concepts: [{ id: 'frame', label: 'Frame', kind: 'entity', definition: 'd', evidence: graphEvidence, level: 'one-step' }, { id: 'stack', label: 'Stack', kind: 'entity', definition: 'd', evidence: graphEvidence, level: 'one-step' }], relations: [], prerequisites: [] };
const visualVocabularies = Object.fromEntries(sceneIds.map((sceneId) => [sceneId, {
  sceneId,
  family: 'simi-house-v1/domain-outline',
  concepts: [
    { conceptId: 'frame', label: 'Frame', conceptKind: 'entity', depiction: { kind: 'icon' as const, entryId: 'iconify-lucide:frame', rung: 'R3', houseFamily: 'simi-house-v1/domain-outline' } },
    { conceptId: 'stack', label: 'Stack', conceptKind: 'entity', depiction: { kind: 'labelled' as const } },
  ],
}]));
const prepared = { plan, graph, sourceDoc, beatPlans, beatNarrations: narrations, visualVocabularies, validatedByConcept: { frame: 'iconify-lucide:frame' } } as unknown as PreparedLesson;
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
    const s6Prompts: string[] = [];
    const recordingClient: ModelClient = { provider: 'fake', chat: async (request) => { s6Prompts.push(`${request.system}\n${request.user}`); return client.chat(request); } };
    const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: out, prepared: { ...prepared, groundingMode: 'SOURCE_PLUS_BACKGROUND', requestedDurationSec: fixtureDurationSec(300, 100) }, plannerModel: 'google/x', apiKey: 'k', client: recordingClient, aligner: aligner as never, fps: 8 });
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
    assert.equal(s6Prompts.length, 2);
    assert.ok(s6Prompts.every((prompt) => /Frame \(entity\): a real picture exists \(draw it literally\)/.test(prompt)), 'the actual V2 S6 requests receive S3b depiction guidance');
    assert.ok(s6Prompts.every((prompt) => /add a bound entity element for that exact concept/i.test(prompt)), 'the S6 contract requires the selected icon to be represented by an entity');
    assert.ok(s6Prompts.every((prompt) => !prompt.includes('iconify-lucide:frame')), 'private registry asset IDs stay out of model prompts');
    const iconScene = result.compiled[0]!;
    const iconFrame = iconScene.timeline.durationMs - 1;
    const iconSvg = renderSceneSvg(iconScene, iconFrame);
    const labelledScene = { ...iconScene, concepts: new Map([...(iconScene.concepts ?? [])].filter(([id]) => id !== 'frame')) };
    const labelledSvg = renderSceneSvg(labelledScene, iconFrame);
    assert.notEqual(iconSvg, labelledSvg, 'the approved library picture changes the actual rendered board relative to its labelled fallback');
    assert.match(labelledSvg, />FRAME</, 'without icon metadata the same entity renders as a label');
    const lessonContext = JSON.parse(await readFile(path.join(out, 'v2', 'lesson-context.json'), 'utf8')) as {
      schemaVersion: string;
      groundingMode: string;
      plan: { sections: Array<{ id: string; contract: { evidenceSpanIds: string[]; essentialClaims: Array<{ id: string; epistemicType?: string; verificationStatus?: string; evidenceSpanIds: string[]; sourceRefs?: Array<{ spanId: string }> }> } }> };
      beatPlans: Record<string, Array<{ claimIds: string[]; evidenceSpanIds: string[] }>>;
      beatNarrations: Record<string, { claimSpans: Array<{ claimId: string }> }>;
      validatedByConcept: Record<string, string>;
      evidenceLedger: { groundingMode: string; claims: Array<{ id: string; epistemicType: string; verificationStatus?: string; sourceRefs: Array<Record<string, unknown>> }> };
    };
    assert.equal(lessonContext.schemaVersion, 'lesson-context/v9');
    assert.deepEqual(lessonContext.validatedByConcept, { frame: 'iconify-lucide:frame' });
    assert.equal(lessonContext.groundingMode, 'SOURCE_PLUS_BACKGROUND');
    assert.equal(lessonContext.evidenceLedger.groundingMode, 'SOURCE_PLUS_BACKGROUND');
    assert.ok(lessonContext.plan.sections.flatMap((section) => section.contract.essentialClaims).every((claim) => claim.epistemicType === 'direct_source'));
    assert.ok(lessonContext.plan.sections.flatMap((section) => section.contract.essentialClaims).every((claim) => claim.verificationStatus === 'source_cited'));
    assert.ok(lessonContext.evidenceLedger.claims.every((claim) => claim.epistemicType === 'direct_source'));
    assert.ok(lessonContext.evidenceLedger.claims.every((claim) => claim.verificationStatus === 'source_cited'));
    assert.ok(lessonContext.evidenceLedger.claims.flatMap((claim) => claim.sourceRefs).every((ref) => !('spanId' in ref)), 'the ledger stores hash-pinned document ranges; plan span identity remains in the canonical plan');
    const canonicalOne = lessonContext.plan.sections.find((section) => section.id === 'one')!.contract.essentialClaims.find((claim) => claim.id === 'one_c')!;
    assert.deepEqual(canonicalOne.evidenceSpanIds, claims('one')[0]!.evidenceSpanIds);
    assert.deepEqual(canonicalOne.sourceRefs?.map((ref) => ref.spanId), canonicalOne.evidenceSpanIds);
    assert.equal(lessonContext.evidenceLedger.claims.find((claim) => claim.id === 'one_c')?.id, 'one_c');
    assert.deepEqual(lessonContext.beatPlans.one![0]!.claimIds, ['one_c']);
    assert.deepEqual(lessonContext.beatPlans.one![0]!.evidenceSpanIds, canonicalOne.evidenceSpanIds);
    assert.ok(lessonContext.beatNarrations.one!.claimSpans.some((span) => span.claimId === 'one_c'));
    const lockedSceneOne = JSON.parse(await readFile(path.join(out, 'v2', 'scene.one.json'), 'utf8')) as {
      beats: Array<{ claimIds: string[] }>;
      ops: Array<{ op: string; beatId: string; bindings?: { claimIds?: string[] }; element?: { bindings?: { claimIds?: string[] } } }>;
    };
    assert.deepEqual(lockedSceneOne.beats[0]!.claimIds, ['one_c']);
    assert.ok(lockedSceneOne.ops.every((op) => op.beatId === 'one.b1'));
    assert.ok(lockedSceneOne.ops.filter((op) => op.op === 'add').every((op) => op.element?.bindings?.claimIds?.includes('one_c')));
    const iconFamilies = JSON.parse(await readFile(path.join(out, 'v2', 'scene-icon-families.json'), 'utf8')) as { scenes: Array<{ sceneId: string; houseFamily: string | null }> };
    assert.ok(iconFamilies.scenes.every((scene) => scene.houseFamily === 'simi-house-v1/domain-outline'));
    assert.equal(result.compiled[0]!.concepts?.get('frame')?.validatedAssetId, 'iconify-lucide:frame');
    const assetProvenance = JSON.parse(await readFile(path.join(out, 'v2', 'asset-provenance.json'), 'utf8')) as { assets: Array<{ assetId: string }> };
    assert.ok(assetProvenance.assets.some((asset) => asset.assetId === 'iconify-lucide:frame'), 'V2 records the S3b-selected asset in rights provenance');
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
    const capturedScene = JSON.parse(await readFile(path.join(out, firstScene.captured.file), 'utf8')) as { concepts: Array<[string, { houseFamily?: string; validatedAssetId?: string }]> };
    assert.ok(capturedScene.concepts.every(([, concept]) => concept.houseFamily === 'simi-house-v1/domain-outline'), 'the lock pins the chosen icon family for deterministic replay');
    assert.equal(capturedScene.concepts.find(([id]) => id === 'frame')?.[1].validatedAssetId, 'iconify-lucide:frame', 'the locked V2 scene pins the exact library icon selected by S3b');
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

test('missing compiled semantic phrases fail before audio or board planning', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-semantic-anchor-gate-'));
  try {
    const invalidNarration = structuredClone(narrations.one!);
    invalidNarration.semanticAnchors.pop();
    let audioCalls = 0;
    let boardCalls = 0;
    const result = await runLessonV2({
      lessonId: 'missing-semantic-anchor', outputDir: path.join(dir, 'run'),
      prepared: { ...prepared, beatNarrations: { ...narrations, one: invalidNarration } },
      plannerModel: 'google/x', apiKey: 'k',
      client: { ...client, chat: async (request) => { boardCalls++; return client.chat(request); } },
      aligner: async () => { audioCalls++; throw new Error('must not synthesize invalid narration'); },
    });
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some((failure) => failure.code === 'v2-semantic-anchor-invalid'));
    assert.equal(audioCalls, 0);
    assert.equal(boardCalls, 0);
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

async function fixtureRun(dir: string, hierarchical = false): Promise<string> {
  const aligner = async (text: string) => {
    const tokens = tokenizeWords(text);
    const durationMs = tokens.length * 300 + 100;
    const audioPath = path.join(dir, `tmp-${tokens.length}-${Math.random().toString(36).slice(2)}.wav`);
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
    return { durationMs, words: tokens.map((word, i) => ({ word, startMs: i * 300, endMs: i * 300 + 260 })), aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
  };
  const out = path.join(dir, 'run');
  const hierarchicalPrepared = hierarchical ? {
    ...prepared,
    syllabus: { modules: [
      { id: 'chapter-one', title: 'Foundations', goal: 'Introduce the stack', budgetSec: 150, conceptIds: ['frame', 'stack'], evidenceSpanIds: claims('one')[0]!.evidenceSpanIds, recallOfModuleIds: [] },
      { id: 'chapter-two', title: 'Stack changes', goal: 'Trace a change', budgetSec: 150, conceptIds: ['frame', 'stack'], evidenceSpanIds: claims('two')[0]!.evidenceSpanIds, recallOfModuleIds: ['chapter-one'] },
    ] },
    modules: [
      { moduleId: 'chapter-one', title: 'Foundations', goal: 'Introduce the stack', budgetSec: 150, requestedBudgetSec: 150, conceptIds: ['frame', 'stack'], graph, plan: { ...plan, sections: [plan.sections[0]!] }, script: { scenes: [] } },
      { moduleId: 'chapter-two', title: 'Stack changes', goal: 'Trace a change', budgetSec: 150, requestedBudgetSec: 150, conceptIds: ['frame', 'stack'], graph, plan: { ...plan, sections: [plan.sections[1]!] }, script: { scenes: [] } },
    ],
  } : prepared;
  const result = await runLessonV2({ lessonId: 'lesson-test', outputDir: out, prepared: { ...hierarchicalPrepared, requestedDurationSec: fixtureDurationSec(300, 100) } as PreparedLesson, plannerModel: 'google/x', apiKey: 'k', client, aligner: aligner as never, skipEncode: true });
  assert.equal(result.status, 'draft', JSON.stringify(result.failures));
  return out;
}

test('OPEN_EXPLANATION survives the V2 runner and a rehashed lock still rejects visualized or uncaveated open claims', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-open-v2-'));
  try {
    const openStatement = 'One way to think of a return is that it removes a frame from the stack, but this explanation is not verified by the supplied source.';
    const openClaim = { ...claims('two')[0]!, statement: openStatement, sourceRefs: [], evidenceSpanIds: [], epistemicType: 'unverified_explanation' as const, verificationStatus: 'unverified' as const };
    const openPlan = structuredClone(plan) as unknown as { sections: Array<{ id: string; contract: { essentialClaims: unknown[]; evidenceSpanIds: string[] } }> };
    const openSection = openPlan.sections.find((section) => section.id === 'two')!;
    openSection.contract.essentialClaims = [openClaim];
    openSection.contract.evidenceSpanIds = [];
    const openBeatContext = { ...ctxFor('two'), claims: [openClaim] };
    const openBeats = compileBeatPlan(BeatPlanDraftSchema.parse({ beats: [{
      ...beatDraft('two').beats[0]!, narrationOnly: true, mutedMeaning: '', entities: [], semanticRevealOrder: [], requiredSemanticChanges: [], relationships: [],
    }] }), openBeatContext);
    const openNarrations = {
      ...narrations,
      two: compileSceneNarration('two', SceneNarrationDraftSchema.parse({ beats: [{
        beatId: 'two.b1', sentences: [openStatement], claimSentences: [{ claimId: 'two_c', sentenceIndex: 0 }], semanticAnchors: [], emphasisTerms: [],
      }] }), openBeats),
    };
    const openPrepared = {
      ...prepared, plan: openPlan, groundingMode: 'OPEN_EXPLANATION' as const,
      beatPlans: { ...beatPlans, two: openBeats }, beatNarrations: openNarrations,
    } as unknown as PreparedLesson;
    const openBoard = { ...board, two: { transition: { mode: 'retain-all' }, ops: [] } };
    const openClient: ModelClient = { provider: 'fake', chat: async (request) => {
      const scene = /SCENE (\w+)/.exec(request.user)?.[1] ?? '';
      return { content: JSON.stringify(openBoard[scene as keyof typeof openBoard]), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage };
    } };
    const aligner = async (text: string) => {
      const tokens = tokenizeWords(text);
      const durationMs = tokens.length * 300 + 100;
      const audioPath = path.join(dir, `tmp-open-${tokens.length}-${Math.random().toString(36).slice(2)}.wav`);
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(durationMs / 1000), audioPath]);
      return { durationMs, words: tokens.map((word, index) => ({ word, startMs: index * 300, endMs: index * 300 + 260 })), aligner: 'stable-ts' as const, repairedWordIndexes: [], audioPath };
    };
    const requestedDurationSec = (Object.values(openNarrations).reduce((sum, narration) => sum + tokenizeWords(narration.text).length * 300 + 100, 0) + PIPELINE.sceneGapMs + 1200) / 1000;
    let earlyAudioCalls = 0;
    let earlyBoardCalls = 0;
    const invalidOpenPrepared = { ...openPrepared, beatPlans: { ...openPrepared.beatPlans, two: openBeats.map((beat) => ({ ...beat, narrationOnly: false })) } };
    const invalidAligner = async (text: string) => { earlyAudioCalls++; return aligner(text); };
    const invalidOpen = await runLessonV2({ lessonId: 'open-explanation-invalid', outputDir: path.join(dir, 'invalid-run'), prepared: { ...invalidOpenPrepared, requestedDurationSec }, plannerModel: 'google/x', apiKey: 'k', client: { ...openClient, chat: async (request) => { earlyBoardCalls++; return openClient.chat(request); } }, aligner: invalidAligner as never });
    assert.equal(invalidOpen.status, 'failed');
    assert.equal(earlyAudioCalls, 0, 'an unverified visual beat fails before audio generation');
    assert.equal(earlyBoardCalls, 0, 'an unverified visual beat fails before BoardOps planning');

    const out = path.join(dir, 'run');
    const result = await runLessonV2({ lessonId: 'open-explanation-test', outputDir: out, prepared: { ...openPrepared, requestedDurationSec }, plannerModel: 'google/x', apiKey: 'k', client: openClient, aligner: aligner as never });
    assert.equal(result.status, 'draft', JSON.stringify(result.failures));
    assert.deepEqual(await verifyLessonLockV2(out), [], 'a valid open explanation remains lock-verifiable');

    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
      context: { file: string; hash: string }; alignment: { file: string; hash: string };
      scenes: Array<{ sceneId: string; file: string; fileHash: string }>; contentHash: string;
    };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as {
      beatPlans: Record<string, Array<Record<string, unknown>>>;
      beatNarrations: Record<string, Record<string, unknown>>;
      plan: { sections: Array<{ id: string; contract: { semanticVisualIntents?: Array<Record<string, unknown>>; visualForm?: string } }> };
    };
    context.beatPlans.two![0]!.narrationOnly = false;
    const replaceCaveat = (narration: Record<string, unknown>) => {
      narration.text = String(narration.text).replace('not verified', 'now verified');
      const beats = narration.beats as Array<Record<string, unknown>>;
      beats[0]!.text = String(beats[0]!.text).replace('not verified', 'now verified');
      const spans = narration.claimSpans as Array<Record<string, unknown>>;
      spans[0]!.exactText = String(spans[0]!.exactText).replace('not verified', 'now verified');
    };
    replaceCaveat(context.beatNarrations.two!);
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, contextBytes);
    lock.context.hash = sha256(contextBytes);

    const lockedScene = lock.scenes.find((scene) => scene.sceneId === 'two')!;
    const scenePath = path.join(out, lockedScene.file);
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as { beats: Array<Record<string, unknown>>; narration: Record<string, unknown> };
    scene.beats[0]!.narrationOnly = false;
    replaceCaveat(scene.narration);
    const sceneBytes = `${JSON.stringify(scene, null, 2)}\n`;
    await writeFile(scenePath, sceneBytes);
    lockedScene.fileHash = sha256(sceneBytes);

    const alignmentPath = path.join(out, lock.alignment.file);
    const alignment = JSON.parse(await readFile(alignmentPath, 'utf8')) as { scenes: Array<{ sceneId: string; words: Array<{ word: string }> }> };
    const alignedScene = alignment.scenes.find((candidate) => candidate.sceneId === 'two')!;
    for (const word of alignedScene.words) if (word.word.toLocaleLowerCase('en-US') === 'not') word.word = 'now';
    const alignmentBytes = `${JSON.stringify(alignment, null, 2)}\n`;
    await writeFile(alignmentPath, alignmentBytes);
    lock.alignment.hash = sha256(alignmentBytes);

    const { contentHash: _oldHash, ...body } = lock;
    lock.contentHash = canonicalHash(body);
    const writeResignedLock = async () => {
      const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
      await writeFile(lockPath, lockBytes);
      await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);
    };
    await writeResignedLock();
    const problems = await verifyLessonLockV2(out);
    assert.ok(problems.some((problem) => /unverified explanation beat .* must be narration-only/.test(problem)), problems.join('\n'));
    assert.ok(problems.some((problem) => /not verified by the supplied source/.test(problem)), problems.join('\n'));

    const planOpenSection = context.plan.sections.find((section) => section.id === 'two')!;
    planOpenSection.contract.semanticVisualIntents = [{ claimId: 'two_c' }];
    planOpenSection.contract.visualForm = 'process';
    const intentContextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, intentContextBytes);
    lock.context.hash = sha256(intentContextBytes);
    const { contentHash: _intentHash, ...intentBody } = lock;
    lock.contentHash = canonicalHash(intentBody);
    await writeResignedLock();
    const intentProblems = await verifyLessonLockV2(out);
    assert.ok(intentProblems.some((problem) => /unverified explanation claim two_c must not have a semanticVisualIntent/u.test(problem)), intentProblems.join('\n'));
    assert.ok(intentProblems.some((problem) => /contains only unverified explanations and must omit visualForm/u.test(problem)), intentProblems.join('\n'));

    const duplicateBeat = { ...context.beatPlans.two![0]!, beatId: 'two.b2' };
    context.beatPlans.two!.push(duplicateBeat);
    scene.beats.push({ ...scene.beats[0]!, beatId: 'two.b2' });
    const duplicateContextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, duplicateContextBytes);
    lock.context.hash = sha256(duplicateContextBytes);
    const duplicateSceneBytes = `${JSON.stringify(scene, null, 2)}\n`;
    await writeFile(scenePath, duplicateSceneBytes);
    lockedScene.fileHash = sha256(duplicateSceneBytes);
    const { contentHash: _duplicateHash, ...duplicateBody } = lock;
    lock.contentHash = canonicalHash(duplicateBody);
    await writeResignedLock();
    const duplicateProblems = await verifyLessonLockV2(out);
    assert.ok(duplicateProblems.some((problem) => /unverified explanation claim two_c must appear in exactly one isolated narration-only beat/u.test(problem)), duplicateProblems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the V2 lock pins ops, narration, timings, audio and versions, then rejects rehashed semantic-anchor tampering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v2-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { schemaVersion: string; context: { file: string; hash: string }; scenes: Array<{ sceneId: string; file: string; fileHash: string; audioHash: string; timelineHash: string }>; versions: Record<string, string>; contentHash: string };
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

    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as { beatNarrations: Record<string, { semanticAnchors: Array<Record<string, unknown>> }> };
    context.beatNarrations.one!.semanticAnchors[1] = { ...context.beatNarrations.one!.semanticAnchors[0]!, semanticEventId: 'one.b1.e2' };
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, contextBytes);
    lock.context.hash = sha256(contextBytes);
    const lockedScene = lock.scenes.find((scene) => scene.sceneId === 'one')!;
    const semanticScenePath = path.join(out, lockedScene.file);
    const semanticScene = JSON.parse(await readFile(semanticScenePath, 'utf8')) as { narration: { semanticAnchors: Array<Record<string, unknown>> } };
    semanticScene.narration.semanticAnchors[1] = { ...semanticScene.narration.semanticAnchors[0]!, semanticEventId: 'one.b1.e2' };
    const semanticSceneBytes = `${JSON.stringify(semanticScene, null, 2)}\n`;
    await writeFile(semanticScenePath, semanticSceneBytes);
    lockedScene.fileHash = sha256(semanticSceneBytes);
    const { contentHash: _oldHash, ...lockBody } = lock;
    lock.contentHash = canonicalHash(lockBody);
    const resignedBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, resignedBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), resignedBytes);
    const anchorProblems = await verifyLessonLockV2(out);
    assert.ok(anchorProblems.some((problem) => /overlaps or precedes the previous semantic event phrase/u.test(problem)), anchorProblems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 lesson hierarchy checkpoints bind chapters to final scenes and reject rehashed checkpoint tampering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-hierarchy-'));
  try {
    const out = await fixtureRun(dir, true);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { context: { file: string; hash: string }; contentHash: string };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as {
      schemaVersion: string;
      lessonHierarchy: { mode: string; chapters: Array<{ chapterId: string; sceneIds: string[]; scenes: Array<{ sceneId: string }>; plannedBudgetMs: number; evidenceSpanIds: string[]; recallOfChapterIds: string[]; checkpoint: { cumulativeClaimIds: string[] } }> };
    };
    assert.equal(context.schemaVersion, 'lesson-context/v9');
    assert.equal(context.lessonHierarchy.mode, 'syllabus');
    assert.deepEqual(context.lessonHierarchy.chapters.map((chapter) => chapter.sceneIds), [['one'], ['two']]);
    assert.deepEqual(context.lessonHierarchy.chapters.map((chapter) => chapter.scenes.map((scene) => scene.sceneId)), [['one'], ['two']]);
    assert.deepEqual(context.lessonHierarchy.chapters.map((chapter) => chapter.recallOfChapterIds), [[], ['chapter-one']]);
    assert.deepEqual(context.lessonHierarchy.chapters.map((chapter) => chapter.checkpoint.cumulativeClaimIds), [['one_c'], ['one_c', 'two_c']]);
    assert.deepEqual(await verifyLessonLockV2(out), []);

    const originalHierarchy = structuredClone(context.lessonHierarchy);
    const repinContext = async () => {
      const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
      await writeFile(contextPath, contextBytes);
      lock.context.hash = sha256(contextBytes);
      const { contentHash: _oldHash, ...body } = lock;
      lock.contentHash = canonicalHash(body);
      const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
      await writeFile(lockPath, lockBytes);
      await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);
    };
    context.lessonHierarchy.chapters[1]!.checkpoint.cumulativeClaimIds = ['two_c'];
    await repinContext();
    const problems = await verifyLessonLockV2(out);
    assert.ok(problems.some((problem) => /cumulative claim checkpoint is inconsistent/u.test(problem)), problems.join('\n'));

    context.lessonHierarchy = structuredClone(originalHierarchy);
    context.lessonHierarchy.chapters[0]!.plannedBudgetMs += 1;
    await repinContext();
    const budgetProblems = await verifyLessonLockV2(out);
    assert.ok(budgetProblems.some((problem) => /metadata differs from its pinned syllabus\/module inputs/u.test(problem)), budgetProblems.join('\n'));

    context.lessonHierarchy = structuredClone(originalHierarchy);
    context.lessonHierarchy.mode = 'flat-compatibility';
    await repinContext();
    const modeProblems = await verifyLessonLockV2(out);
    assert.ok(modeProblems.some((problem) => /mode does not match its separately locked input artifact/u.test(problem)), modeProblems.join('\n'));

    delete (context as unknown as Record<string, unknown>).lessonHierarchy;
    await repinContext();
    const missingHierarchyProblems = await verifyLessonLockV2(out);
    assert.ok(missingHierarchyProblems.some((problem) => /no lessonHierarchy field/u.test(problem)), missingHierarchyProblems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the V2 lock rejects untyped claims, invalid learner dependencies, and semantic identity drift in rehashed lesson-context/v9', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v3-epistemic-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { context: { file: string; hash: string }; scenes: Array<{ sceneId: string; file: string; fileHash: string }>; contentHash: string };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as {
      schemaVersion: string;
      plan: { sections: Array<{ contract: { essentialClaims: Array<Record<string, unknown>> } }> };
      beatPlans: Record<string, Array<Record<string, unknown>>>;
      validatedByConcept: Record<string, string>;
    };
    assert.equal(context.schemaVersion, 'lesson-context/v9');
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

    const firstClaim = context.plan.sections[0]!.contract.essentialClaims[0]!;
    firstClaim.epistemicType = 'direct_source';
    firstClaim.verificationStatus = 'unverified';
    const statusBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, statusBytes);
    lock.context.hash = sha256(statusBytes);
    const { contentHash: _oldStatusHash, ...statusBody } = lock;
    lock.contentHash = canonicalHash(statusBody);
    const statusLockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, statusLockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), statusLockBytes);
    const statusProblems = await verifyLessonLockV2(out);
    assert.ok(statusProblems.some((problem) => /verificationStatus must be source_cited/u.test(problem)), statusProblems.join('\n'));

    context.beatPlans.one![0]!.dependsOnOrders = [1];
    context.beatPlans.one![0]!.dependsOnBeatIds = ['one.b1'];
    const dependencyBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, dependencyBytes);
    lock.context.hash = sha256(dependencyBytes);
    const { contentHash: _oldDependencyHash, ...dependencyBody } = lock;
    lock.contentHash = canonicalHash(dependencyBody);
    const dependencyLockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, dependencyLockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), dependencyLockBytes);
    const dependencyProblems = await verifyLessonLockV2(out);
    assert.ok(dependencyProblems.some((problem) => /dependency that does not reference an earlier beat order/u.test(problem)), dependencyProblems.join('\n'));

    context.validatedByConcept.frame = 'iconify-lucide:circle';
    const visualBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, visualBytes);
    lock.context.hash = sha256(visualBytes);
    const { contentHash: _oldVisualHash, ...visualBody } = lock;
    lock.contentHash = canonicalHash(visualBody);
    const visualLockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, visualLockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), visualLockBytes);
    const visualProblems = await verifyLessonLockV2(out);
    assert.ok(visualProblems.some((problem) => /visual asset does not match lesson-context\/v9 Visual Discovery/u.test(problem)), visualProblems.join('\n'));

    context.plan.sections[0]!.contract.essentialClaims[0]!.verificationStatus = 'source_cited';
    context.plan.sections[0]!.contract.essentialClaims[0]!.epistemicType = 'direct_source';
    context.beatPlans.one![0]!.dependsOnOrders = [];
    context.beatPlans.one![0]!.dependsOnBeatIds = [];
    context.validatedByConcept.frame = 'iconify-lucide:frame';
    const semanticSceneRef = lock.scenes.find((scene) => scene.sceneId === 'one')!;
    const semanticScenePath = path.join(out, semanticSceneRef.file);
    const semanticScene = JSON.parse(await readFile(semanticScenePath, 'utf8')) as { beats: Array<Record<string, unknown>> };
    const contextEntity = (context.beatPlans.one![0]!.entities as Array<Record<string, unknown>>)[0]!;
    const sceneEntity = (semanticScene.beats[0]!.entities as Array<Record<string, unknown>>)[0]!;
    contextEntity.entityId = 'se_tampered_entity_id';
    sceneEntity.entityId = 'se_tampered_entity_id';
    const semanticSceneBytes = `${JSON.stringify(semanticScene, null, 2)}\n`;
    await writeFile(semanticScenePath, semanticSceneBytes);
    semanticSceneRef.fileHash = sha256(semanticSceneBytes);
    const semanticContextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, semanticContextBytes);
    lock.context.hash = sha256(semanticContextBytes);
    const { contentHash: _oldSemanticHash, ...semanticBody } = lock;
    lock.contentHash = canonicalHash(semanticBody);
    const semanticLockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, semanticLockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), semanticLockBytes);
    const semanticProblems = await verifyLessonLockV2(out);
    assert.ok(semanticProblems.some((problem) => /semantic entity frame_main has an unstable compiled id/u.test(problem)), semanticProblems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the V2 lock rejects malformed compiled semantic records after all affected hashes are recomputed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v7-semantic-change-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { context: { file: string; hash: string }; contentHash: string };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as { beatPlans: Record<string, Array<Record<string, unknown>>> };
    const changes = context.beatPlans.one![0]!.requiredSemanticChanges as unknown[];
    const entities = context.beatPlans.one![0]!.entities as unknown[];
    entities.push(null);
    changes.push(null, { ...(changes[0] as Record<string, unknown>), fromState: 123, unrecognized: true });
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, contextBytes);
    lock.context.hash = sha256(contextBytes);
    const { contentHash: _oldHash, ...body } = lock;
    lock.contentHash = canonicalHash(body);
    const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, lockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);

    const problems = await verifyLessonLockV2(out);
    assert.ok(problems.some((problem) => /has a malformed semantic entity/u.test(problem)), problems.join('\n'));
    assert.ok(problems.some((problem) => /has a malformed required semantic change/u.test(problem)), problems.join('\n'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the V2 lock recomputes each beat evidence-span union from canonical claims after rehashing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-lock-v7-beat-evidence-'));
  try {
    const out = await fixtureRun(dir);
    const lockPath = path.join(out, 'lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { context: { file: string; hash: string }; scenes: Array<{ sceneId: string; file: string; fileHash: string }>; contentHash: string };
    const contextPath = path.join(out, lock.context.file);
    const context = JSON.parse(await readFile(contextPath, 'utf8')) as { beatPlans: Record<string, Array<Record<string, unknown>>> };
    context.beatPlans.one![0]!.evidenceSpanIds = [];
    const sceneRef = lock.scenes.find((scene) => scene.sceneId === 'one')!;
    const scenePath = path.join(out, sceneRef.file);
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as { beats: Array<Record<string, unknown>> };
    scene.beats[0]!.evidenceSpanIds = [];
    const sceneBytes = `${JSON.stringify(scene, null, 2)}\n`;
    await writeFile(scenePath, sceneBytes);
    sceneRef.fileHash = sha256(sceneBytes);
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextPath, contextBytes);
    lock.context.hash = sha256(contextBytes);
    const { contentHash: _oldHash, ...body } = lock;
    lock.contentHash = canonicalHash(body);
    const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, lockBytes);
    await writeFile(path.join(out, 'lesson.lock.json'), lockBytes);

    const problems = await verifyLessonLockV2(out);
    assert.ok(problems.some((problem) => /evidence span projection does not match its cited canonical claims/u.test(problem)), problems.join('\n'));
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
      const sentences = reply[scene]!;
      const changes = beatPlans[scene]?.[0]?.requiredSemanticChanges ?? [];
      const semanticAnchors = changes.map((_change, index) => {
        const sentenceIndex = Math.min(index, sentences.length - 1);
        const phrase = scene === 'two' && sentences.length === 1 && changes.length > 1
          ? (index === 0 ? 'pops' : 'the top frame')
          : sentences[sentenceIndex]!;
        return { semanticEventId: `${scene}.b1.e${index + 1}`, sentenceIndex, phrase };
      });
      return { content: JSON.stringify({ beatId: `${scene}.b1`, sentences, claimSentences: [{ claimId: `${scene}_c`, sentenceIndex: 0 }], semanticAnchors, emphasisTerms: [] }), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage };
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

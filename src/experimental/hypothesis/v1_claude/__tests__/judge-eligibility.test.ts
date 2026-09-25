import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EvaluationBundle, HypothesisRunManifest } from '../../shared/contracts.js';
import { sha256, stableJson } from '../../shared/artifacts.js';
import { judgeRunEligibility, resolveLocalRunArtifact, sourceDocMatchesRecordedHash, sourceTitleMatchesDeclaredTopic } from '../harness/judgeEligibility.js';
import { judgeRun, timedSamplePoints } from '../harness/judge.js';

const sourceDoc = { schemaVersion: 'source-doc/v2', sourceId: 'src_test', format: 'markdown', title: 'Photosynthesis', text: '# Photosynthesis\n', spans: [] };
const manifest = {
  schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', runId: 'r', caseId: 'photosynthesis',
  startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:01:00.000Z',
  options: {} as HypothesisRunManifest['options'], stages: { sourceDoc: sha256(stableJson(sourceDoc)) }, evaluationBundle: 'evaluation-bundle.json', svg: 'final-scene.svg',
  runClass: 'generated-lesson', status: 'draft', video: 'video.mp4',
} as HypothesisRunManifest & { runClass: string; status: string; video: string };
const bundle = {
  schemaVersion: 'evaluation-bundle/v2', pipeline: 'claude', runClass: 'generated-lesson', status: 'draft', caseId: 'photosynthesis',
  runId: 'r', commit: 'test', configHash: 'c', nativeArtifacts: { video: 'video.mp4', sourceDoc: 'source-doc.json' },
  claims: [], claimEvidence: {}, visualEvidence: {}, relations: [], elements: [], timeline: [], provenance: {},
  metrics: { sceneCount: 1 }, usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0, cacheHits: 0 }, failures: [],
  stageRuns: ['S1-source-intake', 'S2-concepts', 'S3-teaching-plan', 'S4-narration-script', 'S5-tts-alignment', 'S6-scene-planner:s1', 'S7-resolve', 'S8-layout', 'S9-timeline', 'S10-render', 'S11-mp4-encode', 'S12-captions'].map((stage) => ({ stage, kind: 'local' as const, status: 'completed' as const, durationMs: 1, apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: [] })),
  gateRecords: ['claude', 'shared'].map((gateSet) => ({ gateSet: gateSet as 'claude' | 'shared', sceneId: 's1', passed: true, failures: [], warnings: [] })),
} as EvaluationBundle;

test('quality judge accepts only complete generated runs with passed scene gates', () => {
  const narration = { scenes: [{ sceneId: 's1' }] };
  assert.equal(sourceDocMatchesRecordedHash(manifest, sourceDoc), true);
  assert.equal(sourceDocMatchesRecordedHash(manifest, { ...sourceDoc, title: 'Edited title' }), false);
  assert.deepEqual(judgeRunEligibility({ manifest, bundle, narration, videoExists: true, sourceDocExists: true, sourceDocHashMatchesManifest: true }), []);
  const fixture = { ...bundle, runClass: 'renderer-fixture' as const };
  assert.ok(judgeRunEligibility({ manifest, bundle: fixture, narration, videoExists: true, sourceDocExists: true }).includes('run class is not generated-lesson'));
  const partial = { ...bundle, metrics: { sceneCount: 0 } };
  assert.ok(judgeRunEligibility({ manifest, bundle: partial, narration, videoExists: true, sourceDocExists: true }).includes('planned scene count does not match narration scene count'));
  const fallback = { ...bundle, usage: { ...bundle.usage, fallbacks: 1 } };
  assert.ok(judgeRunEligibility({ manifest, bundle: fallback, narration, videoExists: true, sourceDocExists: true }).includes('run contains a planner fallback'));
  const missingGate = { ...bundle, gateRecords: bundle.gateRecords?.filter((gate) => gate.gateSet !== 'shared') };
  assert.ok(judgeRunEligibility({ manifest, bundle: missingGate, narration, videoExists: true, sourceDocExists: true }).some((reason) => reason.includes('shared gate for s1')));
  const missingProviderStage = { ...bundle, stageRuns: bundle.stageRuns?.filter((stage) => stage.stage !== 'S6-scene-planner:s1') };
  assert.ok(judgeRunEligibility({ manifest, bundle: missingProviderStage, narration, videoExists: true, sourceDocExists: true }).some((reason) => reason.includes('S6-scene-planner:s1 is missing')));
  const mismatchedIdentity = { ...manifest, runId: 'other-run' };
  assert.ok(judgeRunEligibility({ manifest: mismatchedIdentity, bundle, narration, videoExists: true, sourceDocExists: true }).includes('manifest and evaluation identities disagree'));
  assert.ok(judgeRunEligibility({ manifest, bundle, narration, videoExists: true, sourceDocExists: true, sourceDocHashMatchesManifest: true, topic: 'attention', sourceTitle: 'Photosynthesis' }).some((reason) => reason.includes('source document title does not identify topic attention')));
  assert.equal(sourceTitleMatchesDeclaredTopic('The Photosynthetic Process', 'photosynthesis', ['photosynthetic process']), true);
  assert.equal(sourceTitleMatchesDeclaredTopic(undefined, 'photosynthesis', []), false);
  assert.equal(sourceTitleMatchesDeclaredTopic('Notes on optics', 'photosynthesis', []), false);
  assert.deepEqual(judgeRunEligibility({ manifest, bundle, narration, videoExists: true, sourceDocExists: true, sourceDocHashMatchesManifest: true, topic: 'photosynthesis', sourceTitle: 'Notes on optics' }).filter((reason) => reason.includes('topic photosynthesis')), ['source document title does not identify topic photosynthesis']);
  assert.deepEqual(judgeRunEligibility({ manifest: { ...manifest, caseId: 'arbitrary-source-filename' }, bundle: { ...bundle, caseId: 'arbitrary-source-filename' }, narration, videoExists: true, sourceDocExists: true, sourceDocHashMatchesManifest: true, topic: 'photosynthesis', sourceTitle: 'Photosynthesis' }), []);
  assert.equal(resolveLocalRunArtifact('/tmp/run', 'video.mp4'), '/tmp/run/video.mp4');
  assert.equal(resolveLocalRunArtifact('/tmp/run', '../../outside.mp4'), undefined);
  const points = timedSamplePoints({ sceneId: 's1', sceneStartMs: 0, sceneEndMs: 5000, events: [1000, 2200, 3800].map((t0) => ({ elementId: 'x', track: 'stroke' as const, t0, t1: t0 + 200 })) }, [
    { w: 'First', startMs: 900, endMs: 1200 }, { w: 'Then', startMs: 2100, endMs: 2400 }, { w: 'Result.', startMs: 3700, endMs: 4000 },
  ]);
  assert.equal(points.length, 3);
  assert.ok(points[0].timeMs < points[1].timeMs && points[1].timeMs < points[2].timeMs);
  assert.deepEqual(points.map((point) => point.activeWord), ['First', 'Then', 'Result.']);
});

test('exported judge API rejects a renderer fixture before any video or provider call', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-judge-policy-'));
  try {
    await writeFile(path.join(dir, 'run-manifest.json'), JSON.stringify({ ...manifest, runClass: 'renderer-fixture' }));
    await writeFile(path.join(dir, 'evaluation-bundle.json'), JSON.stringify({ ...bundle, runClass: 'renderer-fixture' }));
    await writeFile(path.join(dir, 'narration.json'), JSON.stringify({ scenes: [{ sceneId: 's1', plainText: 'fixture narration' }] }));
    await assert.rejects(judgeRun(dir, [], { model: 'unused', apiKey: 'unused', budgetUsd: 1, spentUsd: 0 }), /not eligible for visual-quality judging/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

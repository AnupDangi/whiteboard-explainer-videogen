import test from 'node:test';
import assert from 'node:assert/strict';
import type { E5RunCandidate } from '../harness/e5Comparison.js';
import { e5ComparisonProblems, e5HeldOutSourceProblems, type E5HeldOutSet } from '../harness/e5Comparison.js';

const requiredStages = [
  'S1-source-intake', 'S2-concepts', 'S3-teaching-plan', 'S4-narration-script', 'S5-tts-alignment',
  'S6-scene-planner:s1', 'S7-resolve', 'S8-layout', 'S9-timeline', 'S10-render', 'S11-mp4-encode', 'S12-captions',
];
const stageRuns = requiredStages.map((stage) => ({ stage, kind: 'provider', status: 'completed', durationMs: 10, apiCostUsd: 0.01, cacheHit: false, fallbackCount: 0, failures: [] }));
const base = (id: string, arm: 'zero' | 'text' | 'mechanism' | 'diverse', model = 'planner-a'): E5RunCandidate => ({
  manifest: {
    schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', runClass: 'generated-lesson', status: 'draft', runId: id, caseId: 'same-lesson',
    startedAt: '2026-09-24T00:00:00Z', completedAt: '2026-09-24T00:01:00Z', video: 'video.mp4', evaluationBundle: 'evaluation-bundle.json', svg: 'final.svg',
    options: { mode: 'live', outputDir: `/runs/${id}`, narrationModel: 'content-a', visualModel: model, voice: { provider: 'voice-engine', voiceId: 'voice-a', language: 'en', speed: 1 }, alignment: { provider: 'stable-ts', calibrationMedianErrorMs: 10 }, render: { width: 1920, height: 1080, fps: 30 }, maxRepairs: 1, cache: 'cold', maxCostUsd: 0.1 },
    stages: { input: 'input-hash', sourceDoc: 'source-hash', narration: 'narration-hash', alignedAudio: 'aligned-hash' },
    mediaSha256: { audio: 'identical-audio-bytes' },
    promptExperiment: { arm, exampleOrder: 'ranked', bankVersion: 'bank-v2', bankHash: 'bank-hash', rankVersion: 'rank-v1', catalogVersion: 'catalog-v1', promptVersion: 'prompt-v5', plannerModel: model },
  },
  bundle: {
    schemaVersion: 'evaluation-bundle/v2', pipeline: 'claude', runClass: 'generated-lesson', status: 'draft', caseId: 'same-lesson', runId: id, commit: 'test', configHash: `config-${id}`,
    nativeArtifacts: { video: 'video.mp4', sourceDoc: 'source-doc.json' }, claims: [], claimEvidence: {}, visualEvidence: {}, relations: [], elements: [], timeline: [], provenance: {},
    metrics: { sceneCount: 1 }, usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0, cacheHits: 0 }, failures: [], stageRuns,
    gateRecords: ['claude', 'shared'].map((gateSet) => ({ gateSet, sceneId: 's1', passed: true, failures: [], warnings: [] })),
  } as E5RunCandidate['bundle'],
  narration: { scenes: [{ sceneId: 's1' }] }, videoExists: true, sourceDocExists: true, sourceDocHashMatchesManifest: true,
});

test('E5 accepts only matched, complete generated runs that differ in the declared treatment', () => {
  const zero = base('run-zero', 'zero');
  const retrieval = base('run-mechanism', 'mechanism');
  assert.deepEqual(e5ComparisonProblems(zero, retrieval, 'prompt-arm'), []);

  const cheapModel = base('run-cheap', 'zero', 'planner-b');
  assert.deepEqual(e5ComparisonProblems(zero, cheapModel, 'planner-model'), []);
});

test('E5 rejects fixture runs and mismatched source, narration, audio, or uncontrolled options', () => {
  const a = base('run-a', 'zero');
  const b = base('run-b', 'mechanism');
  const fixture = structuredClone(b);
  fixture.manifest.runClass = 'renderer-fixture';
  fixture.bundle.runClass = 'renderer-fixture';
  assert.ok(e5ComparisonProblems(a, fixture, 'prompt-arm').some((reason) => reason.includes('run class is not generated-lesson')));

  const changedSource = structuredClone(b);
  changedSource.manifest.stages.input = 'different-input';
  assert.ok(e5ComparisonProblems(a, changedSource, 'prompt-arm').some((reason) => reason.includes('input hashes must match')));
  const changedNarration = structuredClone(b);
  changedNarration.manifest.stages.narration = 'different-narration';
  assert.ok(e5ComparisonProblems(a, changedNarration, 'prompt-arm').some((reason) => reason.includes('narration hashes must match')));
  const changedAudio = structuredClone(b);
  changedAudio.manifest.mediaSha256!.audio = 'different-audio';
  assert.ok(e5ComparisonProblems(a, changedAudio, 'prompt-arm').some((reason) => reason.includes('byte-identical narration audio')));
  const changedVoice = structuredClone(b);
  changedVoice.manifest.options.voice.voiceId = 'voice-b';
  assert.ok(e5ComparisonProblems(a, changedVoice, 'prompt-arm').some((reason) => reason.includes('voice options must match')));
  assert.ok(e5ComparisonProblems(a, base('same-arm', 'zero'), 'prompt-arm').some((reason) => reason.includes('must change arm or example order')));
  assert.ok(e5ComparisonProblems(a, b, 'planner-model').some((reason) => reason.includes('must hold prompt arm and example order constant')));
});

test('E5 pack eligibility requires exact membership in a versioned held-out SourceDoc set', () => {
  const run = base('heldout-run', 'zero');
  const sourceDocSha256 = 'a'.repeat(64);
  run.manifest.stages.sourceDoc = sourceDocSha256;
  const set: E5HeldOutSet = {
    schemaVersion: 'e5-heldout-set/v1', setId: 'e5-docs', version: 'v1', createdAt: '2026-09-24T00:00:00Z',
    sources: [{ caseId: run.manifest.caseId, sourceDocSha256 }],
  };
  assert.deepEqual(e5HeldOutSourceProblems(set, run), []);
  assert.ok(e5HeldOutSourceProblems({ ...set, sources: [{ caseId: run.manifest.caseId, sourceDocSha256: 'b'.repeat(64) }] }, run).some((reason) => reason.includes('exact SourceDoc hash')));
  assert.ok(e5HeldOutSourceProblems({ ...set, sources: [] }, run).some((reason) => reason.includes('no frozen source records')));
});

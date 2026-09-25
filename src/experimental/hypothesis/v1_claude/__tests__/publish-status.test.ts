import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRunStatus, deterministicGates } from '../../shared/evaluation.js';
import { loadAlignmentCalibration } from '../../shared/alignment/calibration.js';
import { assertCommonRunOptions, type HypothesisRunOptions } from '../../shared/contracts.js';
import { goldenForRun } from '../pipeline/runLive.js';

test('only an external judge can promote a clean run from draft to passed', () => {
  assert.equal(deriveRunStatus(0), 'draft');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: true }), 'passed');
  assert.equal(deriveRunStatus(1, true), 'failed');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: false, alignmentComplete: true }), 'failed');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: false }), 'failed');
});

test('generic inputs do not receive a golden-duration gate', () => {
  const failures = deterministicGates({
    elements: [], timeline: [], durationMs: 60_000, svg: '<svg></svg>',
  });
  assert.equal(failures.some((failure) => failure.code === 'av-sync'), false);
});

test('a known golden retains its duration gate', () => {
  const failures = deterministicGates({
    golden: {
      schemaVersion: 'golden-case/v1', id: 'fixture', title: 'fixture', targetDurationMs: 30_000,
      teachingBeats: [], requiredClaims: [], requiredRelations: [], learnerInference: '', misconception: '',
    },
    elements: [], timeline: [], durationMs: 60_000, svg: '<svg></svg>',
  });
  assert.equal(failures.some((failure) => failure.code === 'av-sync'), true);
});

test('withdrawn scratch calibration is not supplied to live-run configuration', async () => {
  const calibration = await loadAlignmentCalibration();
  assert.equal(calibration.status, 'unmeasured');
  assert.equal(calibration.boundarySamples, 0);
  assert.equal(calibration.independentClips, 0);
  assert.equal(calibration.medianAbsoluteBoundaryErrorMs, null);
});

test('live options permit an unmeasured diagnostic but reject fabricated/invalid measured error values', () => {
  const options: HypothesisRunOptions = {
    mode: 'live', outputDir: '/tmp/hypothesis-test', narrationModel: 'content', visualModel: 'scene',
    voice: { provider: 'voice-engine', voiceId: 'voice', language: 'en', speed: 1 },
    alignment: { provider: 'stable-ts' }, render: { width: 1920, height: 1080, fps: 30 },
    maxRepairs: 1, cache: 'cold', maxCostUsd: 0.1,
  };
  assert.doesNotThrow(() => assertCommonRunOptions(options));
  assert.throws(() => assertCommonRunOptions({ ...options, alignment: { provider: 'stable-ts', calibrationMedianErrorMs: 80 } }), /Measured alignment calibration/);
  assert.throws(() => assertCommonRunOptions({ ...options, alignment: { provider: 'stable-ts', calibrationMedianErrorMs: Number.NaN } }), /Measured alignment calibration/);
});

test('source-generated IDs cannot activate a frozen golden target by filename or case collision', () => {
  assert.equal(goldenForRun({ caseId: 'photosynthesis', runClass: 'generated-lesson' }), undefined);
  assert.equal(goldenForRun({ caseId: 'transformer-attention', runClass: 'generated-lesson' }), undefined);
  assert.equal(goldenForRun({ caseId: 'photosynthesis', runClass: 'hand-authored-script' })?.id, 'photosynthesis');
});

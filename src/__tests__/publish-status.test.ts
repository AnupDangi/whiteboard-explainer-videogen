import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveRunStatus, deterministicGates } from '../shared/evaluation.js';
import { loadAlignmentCalibration } from '../shared/alignment/calibration.js';
import { assertCommonRunOptions, type HypothesisRunOptions } from '../shared/contracts.js';
import { goldenForRun } from '../run/golden.js';

test('clean runs are draft until judge + evidence + calibration all pass', () => {
  assert.equal(deriveRunStatus(0), 'draft');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: true }), 'passed');
  assert.equal(deriveRunStatus(1, true), 'failed');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: false, alignmentComplete: true }), 'draft');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: false }), 'draft');
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

// No existing test drives runHypothesisLive end-to-end in `mode: 'live'` with mocked TTS/aligner/planner
// providers (checked run-live-concurrency.test.ts, e2e.test.ts, module-audio-budget.test.ts — none of
// them call runHypothesisLive), so a full clean-live-run assertion is not available. Instead this pins
// the two properties the brief cares about: (a) the calibration-unmeasured record stays a soft warning,
// and (b) runLive.ts's own draft/failed split (it always calls deriveRunStatus with judgePassed=false,
// since there is no judge-verdict field yet) is exactly gated by the hard-failure count.
test('uncalibrated live path: calibration failure is soft, and draft status is exactly gated by hard failures', () => {
  const runLiveSource = readFileSync(resolve(process.cwd(), 'src/run/runLive.ts'), 'utf8');
  const calibrationFailureRecord = runLiveSource.match(/\{\s*code:\s*'alignment-calibration-unmeasured'[\s\S]*?hard:\s*(true|false)\s*\}/);
  assert.ok(calibrationFailureRecord, 'expected to find the alignment-calibration-unmeasured failure record in runLive.ts');
  assert.equal(calibrationFailureRecord![1], 'false', 'the calibration gate must not be a hard failure, or every live run would stay failed forever');

  // runLive.ts never has a judge verdict yet, so judgePassed is always false at its deriveRunStatus call sites.
  // With judgePassed=false, deriveRunStatus collapses to: 'failed' when hardFailures > 0, else 'draft' —
  // regardless of factualEvidenceComplete/alignmentComplete. This is the "iff" property the brief asks for.
  for (const evidence of [
    { factualEvidenceComplete: true, alignmentComplete: true },
    { factualEvidenceComplete: false, alignmentComplete: false },
    { factualEvidenceComplete: true, alignmentComplete: false },
  ]) {
    assert.equal(deriveRunStatus(0, false, evidence), 'draft');
    assert.equal(deriveRunStatus(1, false, evidence), 'failed');
  }
});

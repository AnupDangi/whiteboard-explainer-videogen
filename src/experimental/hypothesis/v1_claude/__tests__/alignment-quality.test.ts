import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlignmentCalibration } from '../../shared/alignment/calibration.js';
import type { HypothesisRunOptions } from '../../shared/contracts.js';
import { alignmentCalibrationEligibility, repairedWordIndexProblems, type SceneAlignmentProvenance } from '../pipeline/alignmentQuality.js';

const scene = (aligner: SceneAlignmentProvenance['aligner'], repairedWordIndexes: number[] = []): SceneAlignmentProvenance => ({
  sceneId: 'scene_1', aligner, wordCount: 3, repairedWordIndexes,
});
const calibration: AlignmentCalibration = {
  schemaVersion: 'alignment-calibration/v2', status: 'measured', id: 'test-calibration', voiceEngine: 'voice-engine', voiceProvider: 'supertonic',
  voiceId: null, language: 'en', speed: 1, synthesisProvider: 'auto', aligner: 'stable-ts', alignerModel: 'base', boundarySamples: 10,
  independentClips: 2, medianAbsoluteBoundaryErrorMs: 25, meanAbsoluteBoundaryErrorMs: 30, minimumAbsoluteBoundaryErrorMs: 1,
  maximumAbsoluteBoundaryErrorMs: 70, groundTruthMethod: 'human word boundaries', measurementSource: 'test', limitations: 'test only',
};
const options: Pick<HypothesisRunOptions, 'voice' | 'alignment'> = {
  voice: { provider: 'voice-engine', language: 'en', speed: 1 }, alignment: { provider: 'stable-ts', calibrationMedianErrorMs: 25 },
};

test('S5 calibration applies only to measured stable-ts words', () => {
  assert.deepEqual(alignmentCalibrationEligibility(calibration, options, [scene('stable-ts')], false), { complete: true, identityMatches: true, uncalibratedScenes: [] });
  assert.equal(alignmentCalibrationEligibility(calibration, { ...options, alignment: { provider: 'stable-ts' } }, [scene('stable-ts')], false).complete, false);
  assert.equal(alignmentCalibrationEligibility(calibration, options, [], false).complete, false);
  assert.equal(alignmentCalibrationEligibility(calibration, options, [scene('stable-ts')], true).complete, false);
});

test('CTC, fast mode, and bounded repairs cannot reuse stable-ts calibration', () => {
  for (const aligner of ['stable-ts-fast-mode', 'torchaudio-wav2vec2-ctc', 'stable-ts+collapsed-repair'] as const) {
    assert.deepEqual(alignmentCalibrationEligibility(calibration, options, [scene(aligner)], false), { complete: false, identityMatches: true, uncalibratedScenes: ['scene_1'] });
  }
  assert.deepEqual(alignmentCalibrationEligibility(calibration, options, [scene('stable-ts', [1])], false), { complete: false, identityMatches: true, uncalibratedScenes: ['scene_1'] });
});

test('a scalar calibration cannot cover another voice or synthesis configuration', () => {
  assert.equal(alignmentCalibrationEligibility(calibration, { ...options, voice: { ...options.voice, voiceId: 'different' } }, [scene('stable-ts')], false).complete, false);
  assert.equal(alignmentCalibrationEligibility(calibration, { ...options, voice: { ...options.voice, language: 'fr' } }, [scene('stable-ts')], false).complete, false);
  assert.equal(alignmentCalibrationEligibility(calibration, { ...options, voice: { ...options.voice, speed: 1.25 } }, [scene('stable-ts')], false).complete, false);
  assert.equal(alignmentCalibrationEligibility({ ...calibration, synthesisProvider: undefined }, options, [scene('stable-ts')], false).complete, false);
  assert.equal(alignmentCalibrationEligibility({ ...calibration, status: 'unmeasured' }, options, [scene('stable-ts')], false).complete, false);
});

test('S5 rejects repair indexes outside measured words or repeated indexes', () => {
  assert.deepEqual(repairedWordIndexProblems(scene('stable-ts+collapsed-repair', [1])), []);
  assert.deepEqual(repairedWordIndexProblems(scene('stable-ts+collapsed-repair', [1, 1, 3, -1, 0.5])), [
    'duplicate repaired word index 1', 'invalid repaired word index 3', 'invalid repaired word index -1', 'invalid repaired word index 0.5',
  ]);
});

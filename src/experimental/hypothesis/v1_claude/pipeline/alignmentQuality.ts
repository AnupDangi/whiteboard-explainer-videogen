import type { AlignerIdentity } from '../../shared/alignment/align.js';
import type { AlignmentCalibration } from '../../shared/alignment/calibration.js';
import type { HypothesisRunOptions } from '../../shared/contracts.js';

export interface SceneAlignmentProvenance {
  sceneId: string;
  aligner: AlignerIdentity;
  wordCount: number;
  /** These intervals were synthesized by the bounded repair pass, not measured by an aligner. */
  repairedWordIndexes: number[];
}

export function repairedWordIndexProblems(scene: SceneAlignmentProvenance): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const index of scene.repairedWordIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= scene.wordCount) problems.push(`invalid repaired word index ${index}`);
    else if (seen.has(index)) problems.push(`duplicate repaired word index ${index}`);
    seen.add(index);
  }
  return problems;
}

/** The current calibration record covers stable-ts/base output only. Escalated or repaired timings need their own measurement. */
export function alignmentCalibrationEligibility(
  calibration: AlignmentCalibration,
  options: Pick<HypothesisRunOptions, 'voice' | 'alignment'>,
  scenes: readonly SceneAlignmentProvenance[],
  hasHardAlignmentFailure: boolean,
): { complete: boolean; identityMatches: boolean; uncalibratedScenes: string[] } {
  const uncalibratedScenes = scenes
    .filter((scene) => scene.aligner !== 'stable-ts' || scene.repairedWordIndexes.length > 0)
    .map((scene) => scene.sceneId);
  const identityMatches = calibration.status === 'measured'
    && calibration.voiceEngine === 'voice-engine'
    && calibration.voiceProvider === 'supertonic'
    && calibration.synthesisProvider === 'auto'
    && calibration.voiceId === (options.voice.voiceId ?? null)
    && calibration.language === options.voice.language
    && calibration.speed === options.voice.speed
    && calibration.aligner === 'stable-ts'
    && calibration.alignerModel === 'base'
    && calibration.medianAbsoluteBoundaryErrorMs === options.alignment.calibrationMedianErrorMs;
  return {
    complete: identityMatches && scenes.length > 0 && !hasHardAlignmentFailure && uncalibratedScenes.length === 0,
    identityMatches,
    uncalibratedScenes,
  };
}

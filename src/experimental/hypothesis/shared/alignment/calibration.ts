import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface AlignmentCalibration {
  schemaVersion: 'alignment-calibration/v2';
  status: 'measured' | 'unmeasured';
  id: string;
  voiceEngine: string;
  voiceProvider: string;
  aligner: string;
  alignerModel: string;
  boundarySamples: number;
  independentClips: number;
  medianAbsoluteBoundaryErrorMs: number | null;
  meanAbsoluteBoundaryErrorMs: number | null;
  minimumAbsoluteBoundaryErrorMs: number | null;
  maximumAbsoluteBoundaryErrorMs: number | null;
  groundTruthMethod: string;
  measurementSource: string;
  limitations: string;
}

const CALIBRATION_RELATIVE_PATH = 'src/experimental/hypothesis/shared/alignment/calibration.v2.json';

/**
 * Aligner identities recorded by run_alignment (shared/alignment/align.py).
 * The loader accepts the whole recorded family so a human-measured calibration
 * file written by word_boundary_review.py --write-calibration loads; it never
 * accepts an invented name.
 */
export const RECORDED_ALIGNERS = [
  'stable-ts',
  'stable-ts-fast-mode',
  'torchaudio-wav2vec2-ctc',
  'stable-ts+collapsed-repair',
] as const;

export async function loadAlignmentCalibration(projectRoot = process.cwd()): Promise<AlignmentCalibration> {
  const value = JSON.parse(await readFile(resolve(projectRoot, CALIBRATION_RELATIVE_PATH), 'utf8')) as Partial<AlignmentCalibration>;
  const validMeasurement = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const identityValid = value.schemaVersion === 'alignment-calibration/v2'
    && (value.status === 'measured' || value.status === 'unmeasured')
    && typeof value.id === 'string' && value.id.length > 0
    && value.voiceEngine === 'voice-engine' && value.voiceProvider === 'supertonic'
    && typeof value.aligner === 'string' && (RECORDED_ALIGNERS as readonly string[]).includes(value.aligner)
    && value.alignerModel === 'base'
    && typeof value.groundTruthMethod === 'string' && value.groundTruthMethod.length > 0
    && typeof value.measurementSource === 'string' && value.measurementSource.length > 0
    && typeof value.limitations === 'string' && value.limitations.length > 0;
  const countsValid = Number.isInteger(value.boundarySamples) && Number(value.boundarySamples) >= 0
    && Number.isInteger(value.independentClips) && Number(value.independentClips) >= 0;
  const unmeasuredValid = value.status === 'unmeasured'
    && value.boundarySamples === 0 && value.independentClips === 0
    && value.medianAbsoluteBoundaryErrorMs === null && value.meanAbsoluteBoundaryErrorMs === null
    && value.minimumAbsoluteBoundaryErrorMs === null && value.maximumAbsoluteBoundaryErrorMs === null;
  const measuredValid = value.status === 'measured'
    && Number(value.boundarySamples) > 0 && Number(value.independentClips) > 0
    && validMeasurement(value.medianAbsoluteBoundaryErrorMs)
    && validMeasurement(value.meanAbsoluteBoundaryErrorMs)
    && validMeasurement(value.minimumAbsoluteBoundaryErrorMs)
    && validMeasurement(value.maximumAbsoluteBoundaryErrorMs)
    && Number(value.minimumAbsoluteBoundaryErrorMs) <= Number(value.medianAbsoluteBoundaryErrorMs)
    && Number(value.medianAbsoluteBoundaryErrorMs) <= Number(value.maximumAbsoluteBoundaryErrorMs);
  const valid = identityValid && countsValid && (unmeasuredValid || measuredValid);
  if (!valid) throw new Error(`Invalid alignment calibration at ${resolve(projectRoot, CALIBRATION_RELATIVE_PATH)}`);
  return value as AlignmentCalibration;
}

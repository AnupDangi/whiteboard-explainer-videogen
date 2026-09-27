import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface AlignmentCalibration {
  schemaVersion: 'alignment-calibration/v2';
  status: 'measured' | 'unmeasured';
  id: string;
  voiceEngine: string;
  voiceProvider: string;
  /** Exact synthesis request used in the calibration clips; required for measured records. */
  voiceId?: string | null;
  language?: string;
  speed?: number;
  synthesisProvider?: 'auto';
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

export async function loadAlignmentCalibration(projectRoot = process.cwd()): Promise<AlignmentCalibration> {
  const value = JSON.parse(await readFile(resolve(projectRoot, CALIBRATION_RELATIVE_PATH), 'utf8')) as Partial<AlignmentCalibration>;
  const validMeasurement = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const identityValid = value.schemaVersion === 'alignment-calibration/v2'
    && (value.status === 'measured' || value.status === 'unmeasured')
    && typeof value.id === 'string' && value.id.length > 0
    && value.voiceEngine === 'voice-engine' && value.voiceProvider === 'supertonic'
    && value.aligner === 'stable-ts' && value.alignerModel === 'base'
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
    && (value.voiceId === null || typeof value.voiceId === 'string')
    && typeof value.language === 'string' && value.language.length > 0
    && value.speed === 1 && value.synthesisProvider === 'auto'
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

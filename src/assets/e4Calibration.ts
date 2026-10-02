import { z } from 'zod';
import { sha256, stableJson } from '../shared/artifacts.js';

const E4PairSchema = z.object({
  id: z.string().trim().min(1),
  caseId: z.string().trim().min(1),
  sourceDocSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  concept: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  cosineScore: z.number().finite().min(-1).max(1),
  vlmLabel: z.enum(['correct', 'incorrect']),
  humanLabel: z.enum(['correct', 'incorrect']).optional(),
  humanReviewer: z.string().trim().min(1).optional(),
}).strict().superRefine((pair, context) => {
  if (pair.humanLabel && !pair.humanReviewer) context.addIssue({ code: 'custom', path: ['humanReviewer'], message: 'human reviewer ID is required when a human label is present' });
  if (!pair.humanLabel && pair.humanReviewer) context.addIssue({ code: 'custom', path: ['humanLabel'], message: 'human reviewer ID requires an adjudicated human label' });
});

const E4DatasetSchema = z.object({
  schemaVersion: z.literal('e4-labeled-pairs/v1'),
  datasetId: z.string().trim().min(1),
  catalogSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  embeddingModelId: z.string().trim().min(1),
  scoreKind: z.literal('cosine-similarity'),
  pairs: z.array(E4PairSchema),
}).strict();

export interface E4ThresholdPoint {
  threshold: number;
  selectedPairs: number;
  correctMatches: number;
  incorrectMatches: number;
  precision: number;
  iconCoverage: number;
  overallSemanticMatch: number;
}

export interface E4CalibrationReport {
  schemaVersion: 'e4-calibration-report/v1';
  datasetId: string;
  datasetSha256?: string;
  catalogSha256?: string;
  embeddingModelId?: string;
  status: 'passed' | 'failed' | 'unmeasured';
  sampleSize: number;
  humanChecked: number;
  humanAgreementRate?: number;
  labelCounts: { correct: number; incorrect: number };
  target: { minimumPairs: 200; minimumHumanChecks: 50; minimumIconPrecision: 0.9; minimumSemanticMatch: 0.85 };
  selectedThreshold?: number;
  selected?: E4ThresholdPoint;
  thresholdCurve: E4ThresholdPoint[];
  reasons: string[];
}

const TARGET = { minimumPairs: 200 as const, minimumHumanChecks: 50 as const, minimumIconPrecision: 0.9 as const, minimumSemanticMatch: 0.85 as const };

function emptyReport(datasetId: string, reasons: string[], sampleSize = 0, humanChecked = 0): E4CalibrationReport {
  return { schemaVersion: 'e4-calibration-report/v1', datasetId, status: 'unmeasured', sampleSize, humanChecked, labelCounts: { correct: 0, incorrect: 0 }, target: TARGET, thresholdCurve: [], reasons };
}

/** Sweep supplied catalog similarity scores against adjudicated labels; never changes runtime thresholds. */
export function calibrateE4Thresholds(input: unknown): E4CalibrationReport {
  const parsed = E4DatasetSchema.safeParse(input);
  if (!parsed.success) return emptyReport('', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'dataset'}: ${issue.message}`));
  const dataset = parsed.data;
  const reasons: string[] = [];
  const sampleSize = dataset.pairs.length;
  const humanChecked = dataset.pairs.filter((pair) => pair.humanLabel !== undefined).length;
  if (sampleSize < TARGET.minimumPairs) reasons.push(`E4 requires at least ${TARGET.minimumPairs} concept-asset pairs; found ${sampleSize}`);
  const ids = dataset.pairs.map((pair) => pair.id);
  if (new Set(ids).size !== ids.length) reasons.push('E4 pair IDs must be unique');
  const semanticPairs = dataset.pairs.map((pair) => `${pair.caseId}\0${pair.sourceDocSha256}\0${pair.concept.toLowerCase()}\0${pair.assetId}`);
  if (new Set(semanticPairs).size !== semanticPairs.length) reasons.push('E4 concept-asset pairs must be unique within a source');
  if (humanChecked < TARGET.minimumHumanChecks) reasons.push(`E4 requires at least ${TARGET.minimumHumanChecks} human checks; found ${humanChecked}`);
  const effective = dataset.pairs.map((pair) => ({ ...pair, label: pair.humanLabel ?? pair.vlmLabel }));
  const correctCount = effective.filter((pair) => pair.label === 'correct').length;
  const incorrectCount = effective.length - correctCount;
  const humanAgreement = dataset.pairs.filter((pair) => pair.humanLabel !== undefined);
  const humanAgreementRate = humanAgreement.length ? humanAgreement.filter((pair) => pair.humanLabel === pair.vlmLabel).length / humanAgreement.length : undefined;
  const scores = [...new Set(effective.map((pair) => pair.cosineScore))].sort((a, b) => a - b);
  const thresholdCurve: E4ThresholdPoint[] = scores.map((threshold) => {
    const selected = effective.filter((pair) => pair.cosineScore >= threshold);
    const correct = selected.filter((pair) => pair.label === 'correct').length;
    const incorrect = selected.length - correct;
    return {
      threshold,
      selectedPairs: selected.length,
      correctMatches: correct,
      incorrectMatches: incorrect,
      precision: selected.length ? correct / selected.length : 1,
      iconCoverage: sampleSize ? selected.length / sampleSize : 0,
      overallSemanticMatch: sampleSize ? correct / sampleSize : 0,
    };
  });
  const enoughData = sampleSize >= TARGET.minimumPairs && humanChecked >= TARGET.minimumHumanChecks;
  const acceptable = thresholdCurve.filter((point) => point.precision >= TARGET.minimumIconPrecision && point.overallSemanticMatch >= TARGET.minimumSemanticMatch);
  const candidate = acceptable.sort((a, b) => b.overallSemanticMatch - a.overallSemanticMatch || b.precision - a.precision || b.threshold - a.threshold)[0];
  const selected = enoughData ? candidate : undefined;
  if (enoughData && !selected) reasons.push('No threshold meets both icon precision ≥0.90 and overall semantic match ≥0.85');
  if (reasons.some((reason) => reason.includes('must be unique'))) {
    return { ...emptyReport(dataset.datasetId, reasons, sampleSize, humanChecked), datasetSha256: sha256(stableJson(dataset)), catalogSha256: dataset.catalogSha256, embeddingModelId: dataset.embeddingModelId, labelCounts: { correct: correctCount, incorrect: incorrectCount }, ...(humanAgreementRate !== undefined ? { humanAgreementRate } : {}), thresholdCurve };
  }
  return {
    schemaVersion: 'e4-calibration-report/v1', datasetId: dataset.datasetId, datasetSha256: sha256(stableJson(dataset)), catalogSha256: dataset.catalogSha256, embeddingModelId: dataset.embeddingModelId,
    status: !enoughData ? 'unmeasured' : selected ? 'passed' : 'failed', sampleSize, humanChecked,
    ...(humanAgreementRate !== undefined ? { humanAgreementRate } : {}), labelCounts: { correct: correctCount, incorrect: incorrectCount }, target: TARGET,
    ...(selected ? { selectedThreshold: selected.threshold, selected } : {}), thresholdCurve, reasons,
  };
}

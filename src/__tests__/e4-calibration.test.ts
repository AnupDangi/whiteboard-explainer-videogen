import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateE4Thresholds } from '../assets/e4Calibration.js';

const makeDataset = (correctAtHigh = 180, incorrectAtHigh = 0) => ({
  schemaVersion: 'e4-labeled-pairs/v1', datasetId: 'synthetic-contract-test', catalogSha256: 'a'.repeat(64), embeddingModelId: 'embedding-test', scoreKind: 'cosine-similarity',
  pairs: Array.from({ length: 200 }, (_, index) => {
    const high = index < correctAtHigh + incorrectAtHigh;
    const correct = index < correctAtHigh;
    return {
      id: `pair-${index}`, caseId: `case-${index % 5}`, sourceDocSha256: `${String(index % 5).repeat(64)}`,
      concept: `concept ${index}`, assetId: `asset-${index}`, cosineScore: high ? 0.9 : 0.4,
      vlmLabel: correct ? 'correct' : 'incorrect', ...(index < 50 ? { humanLabel: correct ? 'correct' : 'incorrect', humanReviewer: `reviewer-${index % 3}` } : {}),
    };
  }),
});

test('E4 selects a threshold only with 200 unique pairs, 50 human checks, and both quality targets', () => {
  const report = calibrateE4Thresholds(makeDataset());
  assert.equal(report.status, 'passed');
  assert.equal(report.sampleSize, 200);
  assert.equal(report.humanChecked, 50);
  assert.equal(report.selectedThreshold, 0.9);
  assert.equal(report.selected?.precision, 1);
  assert.equal(report.selected?.overallSemanticMatch, 0.9);
  assert.equal(report.datasetSha256?.length, 64);
  assert.equal(report.thresholdCurve.length, 2);
});

test('E4 fails measured data when no threshold reaches precision and semantic-match gates', () => {
  const report = calibrateE4Thresholds(makeDataset(170, 30));
  assert.equal(report.status, 'failed');
  assert.equal(report.selectedThreshold, undefined);
  assert.match(report.reasons.join('|'), /No threshold meets both/);
});

test('E4 reports unmeasured when minimum data or human-check counts are absent', () => {
  const tooFewPairs = makeDataset().pairs.slice(0, 199);
  const fewerHumanChecks = makeDataset().pairs.map((pair, index) => index < 49 ? pair : { ...pair, humanLabel: undefined, humanReviewer: undefined });
  const shortReport = calibrateE4Thresholds({ ...makeDataset(), pairs: tooFewPairs });
  assert.equal(shortReport.status, 'unmeasured');
  assert.equal(shortReport.selectedThreshold, undefined);
  const report = calibrateE4Thresholds({ ...makeDataset(), pairs: fewerHumanChecks });
  assert.equal(report.status, 'unmeasured');
  assert.ok(report.reasons.some((reason) => reason.includes('50 human checks')));
});

test('E4 uses human adjudication for checked pairs and rejects duplicate pairs', () => {
  const dataset = makeDataset();
  dataset.pairs[0]!.vlmLabel = 'incorrect';
  dataset.pairs[0]!.humanLabel = 'correct';
  dataset.pairs[0]!.humanReviewer = 'reviewer-a';
  const report = calibrateE4Thresholds(dataset);
  assert.equal(report.humanAgreementRate, 49 / 50);
  const duplicate = structuredClone(dataset);
  duplicate.pairs[1] = { ...duplicate.pairs[0]! };
  const duplicateReport = calibrateE4Thresholds(duplicate);
  assert.equal(duplicateReport.status, 'unmeasured');
  assert.match(duplicateReport.reasons.join('|'), /pairs must be unique/);
});

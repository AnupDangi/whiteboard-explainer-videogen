import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReliability, type ReliabilityAttempt } from '../harness/reliability.js';

const row = (reached: ReliabilityAttempt['reached'], codes: string[] = []): ReliabilityAttempt => ({
  sourceId: 's', durationSec: 60, attempt: 1, reached, passed: reached === 'done', failureCodes: codes,
  transportRetries: 0, anchoredEvidence: false, costUsd: 0.01, durationMs: 1,
});

test('stage pass rates are conditional on reaching the stage', () => {
  const summary = summarizeReliability([row('done'), row('S3', ['plan-repair-failed']), row('S2', ['concepts-repair-failed']), row('done')]);
  assert.equal(summary.byStage.s2PassRate, 0.75);
  assert.equal(summary.byStage.s3PassRate, 2 / 3);
  assert.equal(summary.byStage.s4PassRate, 1);
  assert.equal(summary.byStage.endToEndPassRate, 0.5);
  assert.deepEqual(summary.failureCodeCounts, { 'concepts-repair-failed': 1, 'plan-repair-failed': 1 });
  assert.ok(Math.abs(summary.totalCostUsd - 0.04) < 1e-9);
});

test('an empty run summarizes to zeros', () => {
  const summary = summarizeReliability([]);
  assert.deepEqual(summary.byStage, { s2PassRate: 0, s3PassRate: 0, s4PassRate: 0, endToEndPassRate: 0 });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clusterFailures, promotionVerdict, type ExperimentRecord } from '../harness/improvement.js';

/** T8 gates: clusters separate by owner; promotion needs improvement + gates + no regressions + determinism + generalization. */

const record = (over: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  schemaVersion: 'improvement-experiment/v1',
  taskId: 't1', hypothesis: 'Moves improve continuity.', stageOwner: 'S4',
  regressionDataset: 'dev-v1', targetMetric: 'continuity-hard-failures', direction: 'lower',
  baseline: { 'continuity-hard-failures': 4 }, candidate: { 'continuity-hard-failures': 1 },
  correctnessGates: [{ name: 'grounding', passed: true }], regressions: [],
  determinismPreserved: true, topics: ['osmosis', 'pythagoras'],
  recommendation: 'PROMOTE', ...over,
});

describe('improvement loop', () => {
  it('clusters failures by owning stage and code, hard clusters first', () => {
    const clusters = clusterFailures([
      { stage: 'board-ops', code: 'repair-failed', hard: true, message: 'scene 3 invalid' },
      { stage: 'board-ops', code: 'repair-failed', hard: true, message: 'scene 5 invalid' },
      { stage: 'audio', code: 'tts-timeout', hard: false, message: 'retry ok' },
    ]);
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0]!.stage, 'board-ops');
    assert.equal(clusters[0]!.count, 2);
    assert.deepEqual(clusters[0]!.evidence, ['scene 5 invalid', 'scene 3 invalid']);
  });

  it('a measured safe winner promotes', () => {
    const verdict = promotionVerdict(record());
    assert.equal(verdict.promote, true);
    assert.deepEqual(verdict.reasons, []);
  });

  it('no improvement, failed gate, regression, lost determinism, or single topic each block promotion', () => {
    assert.equal(promotionVerdict(record({ candidate: { 'continuity-hard-failures': 4 } })).promote, false);
    assert.equal(promotionVerdict(record({ correctnessGates: [{ name: 'grounding', passed: false }] })).promote, false);
    assert.equal(promotionVerdict(record({ regressions: ['hi narration broke'] })).promote, false);
    assert.equal(promotionVerdict(record({ determinismPreserved: false })).promote, false);
    assert.equal(promotionVerdict(record({ topics: ['osmosis'] })).promote, false);
    assert.equal(promotionVerdict(record({ recommendation: 'REJECT' })).promote, false);
  });

  it('an unmeasured target never promotes', () => {
    assert.equal(promotionVerdict(record({ candidate: {} })).promote, false);
  });
});

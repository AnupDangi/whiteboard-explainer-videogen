import test from 'node:test';
import assert from 'node:assert/strict';
import { stageCostRows, stageFamily, v2RemainderUsd, type StageRunRecord } from '../harness/stageCost.js';

const runA: StageRunRecord[] = [
  { stage: 'S1-syllabus', modelId: 'm/strong', status: 'completed', durationMs: 10000, apiCostUsd: 0.001 },
  { stage: 'S2-concepts:01-module_1', modelId: 'm/strong', status: 'completed', durationMs: 9000, apiCostUsd: 0.002 },
  { stage: 'S1-evidence-retrieval', status: 'completed', durationMs: 0, apiCostUsd: 0 },
];
const runB: StageRunRecord[] = [
  { stage: 'S2-concepts:01-module_1', modelId: 'm/cheap', status: 'failed', durationMs: 3000, apiCostUsd: 0.0002 },
];

test('stage rows merge module-suffixed stages and keep every model and failure', () => {
  assert.equal(stageFamily('S3b-beats:01-module_1'), 'S3b-beats');
  const rows = stageCostRows([runA, runB]);
  const concepts = rows.find((row) => row.stage === 'S2-concepts')!;
  assert.deepEqual(concepts.models, ['m/cheap', 'm/strong']);
  assert.equal(concepts.runs, 2);
  assert.equal(concepts.failed, 1);
  assert.equal(concepts.meanDurationMs, 6000);
  assert.equal(rows[0]!.stage, 'S2-concepts', 'sorted by cost, highest first');
});

test('V2 remainder is evaluation total minus recorded prep stages, never negative', () => {
  assert.equal(Number(v2RemainderUsd(0.0188, runA).toFixed(4)), 0.0158);
  assert.equal(v2RemainderUsd(0.001, runA), 0);
});

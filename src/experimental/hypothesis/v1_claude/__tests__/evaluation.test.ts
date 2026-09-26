import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicGates } from '../../shared/evaluation.js';
import { EXPERIMENT } from '../../shared/contracts.js';

function safeAreaFailures(x: number) {
  return deterministicGates({
    elements: [{ id: 'e', kind: 'text', bbox: { x, y: EXPERIMENT.safeArea, w: 100, h: 100 } }],
    timeline: [],
    durationMs: 1_000,
    svg: '<svg />',
  }).filter((failure) => failure.code === 'safe-area');
}

test('safe-area gate absorbs only sub-micro-pixel layout roundoff', () => {
  assert.deepEqual(safeAreaFailures(EXPERIMENT.safeArea - 1e-7), []);
  assert.equal(safeAreaFailures(EXPERIMENT.safeArea - 1e-3).length, 1);
});

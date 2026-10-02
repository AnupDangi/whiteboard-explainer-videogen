import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicGates } from '../shared/evaluation.js';
import { EXPERIMENT } from '../shared/contracts.js';

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

import { deterministicGates as gatesForOverlap } from '../shared/evaluation.js';

test('boxes that only touch (floating-point dust) are not an overlap, but a real overlap still is', () => {
  const el = (id: string, y: number) => ({ id, kind: 'box', label: id, bbox: { x: 100, y, w: 200, h: 100 } });
  const run = (second: number) => gatesForOverlap({ elements: [el('a', 100), el('b', second)] as never, timeline: [], durationMs: 1000, svg: '<svg/>' }).filter((failure) => failure.code === 'overlap');
  assert.equal(run(200 - 1e-9).length, 0);
  assert.equal(run(199).length, 1);
});

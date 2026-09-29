import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipPaidPlanning } from '../planner/plan.js';

test('default behaviour still skips paid planning after hard S5 failures', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: false }), true);
});

test('explicit diagnostic opt-in runs S6 despite hard S5 failures', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: true }), false);
});

test('clean alignment never skips, and hand-authored specs never call the planner', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 0, planDespiteAlignmentFailure: false }), false);
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: true, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: true }), false);
});

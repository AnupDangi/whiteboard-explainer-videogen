import test from 'node:test';
import assert from 'node:assert/strict';
import { rebalanceSceneBudgets, SCENE_SEC } from '../plan/analyze.js';

const sections = (budgets: number[]) => budgets.map((budgetSec, i) => ({ id: `s${i}`, budgetSec }));
const total = (list: Array<{ budgetSec: number }>) => list.reduce((sum, section) => sum + section.budgetSec, 0);

test('a scene below the hard floor borrows from scenes above it even when every scene wants more than the lesson can give', () => {
  const out = rebalanceSceneBudgets(sections([15, 15, 15, 10, 5]), () => 1);
  assert.ok(out.every((section) => section.budgetSec >= SCENE_SEC.min), JSON.stringify(out));
  assert.equal(total(out), 60, 'the lesson total is kept');
});

test('a scene above the hard ceiling gives seconds to scenes below it', () => {
  const out = rebalanceSceneBudgets(sections([40, 10, 10]), () => 1);
  assert.ok(out.every((section) => section.budgetSec <= SCENE_SEC.max && section.budgetSec >= SCENE_SEC.min), JSON.stringify(out));
  assert.equal(total(out), 60);
});

test('budgets that cannot all fit the bounds are left as they are so the plan validator reports them', () => {
  const out = rebalanceSceneBudgets(sections([10, 10, 5]), () => 1);
  assert.equal(total(out), 25);
  assert.ok(out.some((section) => section.budgetSec < SCENE_SEC.min));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {StageBudget, jobBudgetMs} from '../dist/src/semantic/harness/budget.js';
import {DEFAULT_STAGE_POLICIES} from '../dist/src/semantic/harness/stage.js';

/** S7 — a job-relative latency budget.
 *
 *  The stage ceilings are absolute and far above what a short lesson can
 *  justify: knowledge 600s and visual-director 360s for a one-minute video. A
 *  budget narrows each stage to a share of the time the job actually has, so a
 *  single stage can never consume minutes the lesson cannot afford. */

const clock = (start = 0) => { let t = start; return {now: () => t, advance: (ms) => { t += ms; }}; };

test('the default allowance scales with the requested lesson length', () => {
  assert.equal(jobBudgetMs(1, {}), 120_000, 'one minute allows two');
  assert.equal(jobBudgetMs(2, {}), 240_000);
  assert.equal(jobBudgetMs(undefined, {}), 120_000, 'an unspecified target is treated as one minute');
  assert.equal(jobBudgetMs(1, {V2_JOB_BUDGET_FACTOR: '3'}), 180_000);
  assert.equal(jobBudgetMs(1, {V2_JOB_BUDGET_MS: '45000'}), 45_000, 'an explicit budget wins');
  assert.equal(jobBudgetMs(1, {V2_JOB_BUDGET_FACTOR: 'nonsense'}), 120_000, 'a bad factor falls back');
  assert.throws(() => jobBudgetMs(0, {}), /greater than zero/);
});

test('a stage is narrowed to its share of the remaining budget, never above its ceiling', () => {
  const c = clock();
  const budget = new StageBudget({totalMs: 120_000, now: c.now});
  const knowledge = budget.policyFor('knowledge-compiler');
  assert.ok(knowledge.timeoutMs <= 48_000, `expected at most 40% of 120s, got ${knowledge.timeoutMs}`);
  assert.ok(knowledge.timeoutMs < DEFAULT_STAGE_POLICIES['knowledge-compiler'].timeoutMs,
    'the 600s ceiling must never be reachable');
  const director = budget.policyFor('visual-director');
  assert.ok(director.timeoutMs < DEFAULT_STAGE_POLICIES['visual-director'].timeoutMs, 'nor the 360s one');
});

test('the budget shrinks as the job consumes time and never starves a stage below the floor', () => {
  const c = clock();
  const budget = new StageBudget({totalMs: 120_000, now: c.now});
  const first = budget.policyFor('knowledge-compiler').timeoutMs;
  c.advance(100_000);
  const later = budget.policyFor('knowledge-compiler').timeoutMs;
  assert.ok(later < first, 'a later stage sees less time');
  assert.ok(later >= 8_000, 'but never below the per-stage floor');
  assert.equal(budget.remainingMs(), 20_000);
  assert.equal(budget.expired(), false);
});

test('repairs are shed before a stage is allowed to overrun', () => {
  const c = clock();
  const budget = new StageBudget({totalMs: 120_000, now: c.now});
  assert.equal(budget.policyFor('knowledge-compiler').maxRepairs, 1, 'repairs are available while there is time');
  c.advance(110_000);
  assert.equal(budget.policyFor('knowledge-compiler').maxRepairs, 0, 'a thin remainder drops the second model call');
});

test('an exhausted budget fails explicitly instead of starting work it cannot finish', () => {
  const c = clock();
  const budget = new StageBudget({totalMs: 10_000, now: c.now});
  c.advance(10_000);
  assert.equal(budget.expired(), true);
  assert.throws(() => budget.policyFor('visual-director'), /budget is exhausted/);
  assert.throws(() => new StageBudget({totalMs: 0}), /greater than zero/);
});

test('the owner and cost allocation of a narrowed policy are unchanged', () => {
  const budget = new StageBudget({totalMs: 120_000, now: () => 0});
  const narrowed = budget.policyFor('knowledge-compiler');
  assert.equal(narrowed.owner, DEFAULT_STAGE_POLICIES['knowledge-compiler'].owner);
  assert.equal(narrowed.budgetUsd, DEFAULT_STAGE_POLICIES['knowledge-compiler'].budgetUsd);
});

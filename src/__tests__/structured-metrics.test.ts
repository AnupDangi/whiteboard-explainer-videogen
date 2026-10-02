import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { computeStructuredMetrics, evaluatePhase1Gates, silentSemanticCoercions } from '../harness/structuredMetrics.js';
import { structuredCall, type StructuredCallReport } from '../llm/structuredCall.js';
import type { ModelClient } from '../llm/modelClient.js';

const report = (over: Partial<StructuredCallReport> = {}): StructuredCallReport => ({
  stage: 'plan', subject: 's', provider: 'openai-strict', clientProvider: 'openrouter', model: 'm', schemaName: 'n', schemaHash: 'h', schemaConstrained: true, strict: true,
  droppedKeywords: [], attempts: 1, repairs: 0, firstTryValid: true, succeeded: true, coercions: { total: 0, low: 0, semantic: 0 }, silentSemanticCoercions: 0, retained: { raw: true, replayFixture: true }, ...over,
});

test('silent coercions are semantic diffs between the model JSON and the validated value that the ledger does not cover', () => {
  const before = { title: 'T', kind: 'bogus', items: ['a', 'b'] };
  const after = { title: 'T', kind: 'entity', items: ['a'] };
  assert.equal(silentSemanticCoercions(before, after, []), 2);
  assert.equal(silentSemanticCoercions(before, after, [{ path: '/kind', oldValue: 'bogus', newValue: 'entity', reason: 'r', semanticRisk: 'semantic' }]), 1);
  assert.equal(silentSemanticCoercions(before, after, [{ path: '/kind', oldValue: 'b', newValue: 'e', reason: 'r', semanticRisk: 'semantic' }, { path: '/items', oldValue: [], newValue: [], reason: 'r', semanticRisk: 'semantic' }]), 0, 'a ledger path covers its subtree');
  assert.equal(silentSemanticCoercions({ a: 'x  y' }, { a: 'x y' }, []), 0, 'whitespace is allowed silent normalization');
});

test('structuredCall counts a validator that quietly rewrites the value as a silent semantic coercion', async () => {
  const client: ModelClient = { provider: 'fake', chat: async () => ({ content: '{"title":"T"}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0001 } }) };
  const schema = z.object({ title: z.string() }).strict();
  const quiet = await structuredCall({ stage: 'plan', subject: 'q', model: 'google/x', apiKey: 'k', system: 's', user: 'u', schema, schemaName: 'n', maxTokens: 50, remainingBudgetUsd: 1, client, validate: (v) => { v.title = 'rewritten'; return []; } });
  assert.equal(quiet.reports[0]!.silentSemanticCoercions, 1);
  const clean = await structuredCall({ stage: 'plan', subject: 'c', model: 'google/x', apiKey: 'k', system: 's', user: 'u', schema, schemaName: 'n', maxTokens: 50, remainingBudgetUsd: 1, client });
  assert.equal(clean.reports[0]!.silentSemanticCoercions, 0);
});

test('metrics aggregate constraint, first-try validity per stage class, repairs, coercions and retention', () => {
  const metrics = computeStructuredMetrics([
    report({ stage: 'plan' }), report({ stage: 'plan', firstTryValid: false, repairs: 1 }),
    report({ stage: 'script' }), report({ stage: 'script' }),
    report({ stage: 'planner', schemaConstrained: false, repairs: 2, coercions: { total: 3, low: 1, semantic: 2 }, silentSemanticCoercions: 1, retained: { raw: false, replayFixture: false } }),
    report({ stage: 'concepts' }),
  ]);
  assert.equal(metrics.calls, 6);
  assert.equal(metrics.constrainedRate, 5 / 6);
  assert.equal(metrics.firstTryValid.S3.rate, 0.5);
  assert.equal(metrics.firstTryValid.S4.rate, 1);
  assert.equal(metrics.firstTryValid.S6.rate, 1);
  assert.equal(metrics.maxRepairsPerCall, 2);
  assert.equal(metrics.semanticCoercions, 2);
  assert.equal(metrics.silentSemanticCoercions, 1);
  assert.equal(metrics.rawRetainedRate, 5 / 6);
  assert.equal(metrics.replayFixtureRate, 5 / 6);
});

test('phase 1 gates pass, fail or stay unmeasured per metric against the plan thresholds', () => {
  const good = evaluatePhase1Gates(computeStructuredMetrics([report({ stage: 'plan' }), report({ stage: 'script' }), report({ stage: 'planner' })]));
  assert.equal(good.passed, true);
  assert.ok(good.gates.every((gate) => gate.status === 'pass'), JSON.stringify(good.gates));
  const bad = evaluatePhase1Gates(computeStructuredMetrics([
    report({ stage: 'plan', firstTryValid: false, repairs: 1 }), report({ stage: 'script', schemaConstrained: false }), report({ stage: 'planner', silentSemanticCoercions: 1, repairs: 3 }),
  ]));
  assert.equal(bad.passed, false);
  const failed = bad.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.name).sort();
  assert.deepEqual(failed, ['first-try-valid-S3', 'repairs-per-unit', 'schema-constrained', 'silent-semantic-coercions'].sort());
  const partial = evaluatePhase1Gates(computeStructuredMetrics([report({ stage: 'plan' })]));
  assert.equal(partial.gates.find((gate) => gate.name === 'first-try-valid-S4')!.status, 'unmeasured');
  assert.equal(partial.passed, false, 'an unmeasured gate is not a pass');
});

test('V2 beat, narration and BoardOps calls participate in their stage gates', () => {
  const metrics = computeStructuredMetrics([
    report({ stage: 'plan' }), report({ stage: 'beats' }),
    report({ stage: 'beat-narration' }), report({ stage: 'beat-narration', firstTryValid: false, repairs: 1 }),
    report({ stage: 'board-ops', firstTryValid: false, repairs: 1 }),
  ]);
  assert.deepEqual(metrics.firstTryValid.S3, { calls: 2, valid: 2, rate: 1 });
  assert.deepEqual(metrics.firstTryValid.S4, { calls: 2, valid: 1, rate: 0.5 });
  assert.deepEqual(metrics.firstTryValid.S6, { calls: 1, valid: 0, rate: 0 });
  const gates = evaluatePhase1Gates(metrics);
  assert.equal(gates.gates.find((gate) => gate.name === 'first-try-valid-S4')?.status, 'fail');
  assert.equal(gates.gates.find((gate) => gate.name === 'first-try-valid-S6')?.status, 'fail');
});

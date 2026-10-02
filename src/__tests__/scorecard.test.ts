import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScorecard } from '../harness/scorecard.js';
import type { StructuredCallReport } from '../llm/structuredCall.js';

const report = (over: Partial<StructuredCallReport> = {}): StructuredCallReport => ({
  stage: 'plan', subject: 's', provider: 'openai-strict', clientProvider: 'openrouter', model: 'm', schemaName: 'n', schemaHash: 'h', schemaConstrained: true, strict: true,
  droppedKeywords: [], attempts: 1, repairs: 0, firstTryValid: true, succeeded: true, coercions: { total: 0, low: 0, semantic: 0 }, silentSemanticCoercions: 0, retained: { raw: true, replayFixture: true }, ...over,
});

test('a scorecard is never a release candidate while any required measurement is missing', () => {
  const card = buildScorecard({ compilerVersion: 'v1', reports: [report()], coverageMetrics: {} });
  assert.equal(card.releaseCandidate, false);
  assert.ok(card.unmeasured.includes('unsupported-major-claims'));
  assert.ok(card.unmeasured.includes('wrong-semantic-icons'));
  assert.ok(card.unmeasured.includes('deterministic-replay'));
  assert.deepEqual(card.blockers, []);
});

test('hard blockers from the plan are raised from measured values', () => {
  const card = buildScorecard({
    compilerVersion: 'v1',
    reports: [report({ schemaConstrained: false }), report({ silentSemanticCoercions: 2 })],
    coverageMetrics: { 'semantic.r10OnlyMajorClaims': 3 },
    replay: { replays: 20, identical: false, mismatches: [{ replay: 3, kind: 'events', expected: 'a', actual: 'b' }] },
  });
  assert.deepEqual([...card.blockers].sort(), ['deterministic-replay-mismatch', 'major-claim-r10-only', 'schema-not-constrained', 'silent-semantic-coercion'].sort());
  assert.equal(card.releaseCandidate, false);
  assert.ok(!card.unmeasured.includes('deterministic-replay'));
});

test('the scorecard carries the structured-harness metrics, gates and the compiler version', () => {
  const card = buildScorecard({ compilerVersion: 'v2', reports: [report({ stage: 'plan' }), report({ stage: 'script' }), report({ stage: 'planner' })], coverageMetrics: { 'semantic.meaningfulClaimCoverage': 0.5 } });
  assert.equal(card.compilerVersion, 'v2');
  assert.equal(card.structured.gates.passed, true);
  assert.equal(card.coverage['semantic.meaningfulClaimCoverage'], 0.5);
  assert.equal(card.schemaVersion, 'scorecard/v1');
});

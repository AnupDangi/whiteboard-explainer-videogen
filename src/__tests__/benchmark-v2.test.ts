import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BenchmarkManifestSchema, evaluateStageA, freezeBenchmarkSources, stageAccepted, verifyFrozenBenchmark, type TrialSummary } from '../harness/benchmarkV2.js';

test('a frozen benchmark detects a changed, missing or extra source', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bench-v2-'));
  try {
    await writeFile(path.join(dir, 'a.txt'), 'source a'); await writeFile(path.join(dir, 'b.txt'), 'source b');
    const manifest = BenchmarkManifestSchema.parse({ schemaVersion: 'benchmark-v2/v1', name: 'synthetic', trialsPerCase: 3, cases: [{ id: 'case-a', domain: 'x', capability: 'y', sourceFile: 'a.txt' }, { id: 'case-b', domain: 'x', capability: 'y', sourceFile: 'b.txt' }] });
    const frozen = await freezeBenchmarkSources(dir, manifest);
    assert.deepEqual(await verifyFrozenBenchmark(dir, manifest, frozen), []);
    await writeFile(path.join(dir, 'a.txt'), 'edited');
    assert.deepEqual(await verifyFrozenBenchmark(dir, manifest, frozen), ['case-a: source changed since it was frozen']);
    assert.deepEqual(await verifyFrozenBenchmark(dir, manifest, { 'case-a': frozen['case-a']!, ghost: 'x' }), ['case-a: source changed since it was frozen', 'case-b: no frozen source hash', 'ghost: frozen hash for a case not in the manifest']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const trial = (caseId: string, n: number, metrics: Record<string, number>, extra: Partial<TrialSummary> = {}): TrialSummary => ({ caseId, trial: n, status: 'draft', hardFailures: 0, artifactsComplete: true, requestStarted: true, cold: true, majorR10OnlyClaims: 0, totalCostUsd: 0.05, ttsUsdKnown: true, metrics, ...extra });
const fast = { 'v2.timeToFirstPlayableMs': 15_000, 'v2.requestToCompleteMs': 50_000, 'v2.encodeMs': 8_000 };

test('Stage A: the worst trial decides latency, missing metrics are unmeasured, and unmeasured blocks acceptance', () => {
  const trials = ['a', 'b'].flatMap((id) => [1, 2].map((n) => trial(id, n, fast)));
  const gates = evaluateStageA(trials, { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] });
  assert.equal(gates.find((g) => /first playable/.test(g.gate))!.status, 'passed');
  assert.equal(gates.find((g) => /wrong icons/.test(g.gate))!.status, 'unmeasured');
  assert.equal(gates.find((g) => /total lesson cost/.test(g.gate))!.status, 'passed');
  assert.equal(stageAccepted(gates), false, 'wrong icons still need human review');
  const reviewed = evaluateStageA(trials.map((t) => ({ ...t, wrongIcons: 0 })), { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] });
  assert.equal(stageAccepted(reviewed), true);
  const slow = evaluateStageA([...trials.slice(0, 3), trial('b', 2, { ...fast, 'v2.requestToCompleteMs': 61_000 }, { wrongIcons: 0 })], { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] });
  assert.equal(slow.find((g) => /full generation/.test(g.gate))!.status, 'failed');
  const missing = evaluateStageA([trial('a', 1, { 'v2.requestToCompleteMs': 1 })], { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] });
  assert.equal(missing.find((g) => /trial slots/.test(g.gate))!.status, 'failed');
  assert.equal(missing.find((g) => /encode/.test(g.gate))!.status, 'unmeasured');
  const hard = evaluateStageA(trials.map((t, i) => ({ ...t, hardFailures: i === 0 ? 2 : 0, wrongIcons: 0 })), { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] });
  assert.equal(hard.find((g) => /hard semantic/.test(g.gate))!.status, 'failed');
});

test('Stage A rejects duplicate, unexpected and interrupted case/trial slots', () => {
  const valid = ['a', 'b'].flatMap((id) => [1, 2].map((n) => trial(id, n, fast, { wrongIcons: 0 })));
  const expected = { cases: 2, trialsPerCase: 2, caseIds: ['a', 'b'] };
  const duplicate = evaluateStageA([...valid.slice(0, 3), valid[0]!], expected);
  assert.equal(duplicate[0]!.status, 'failed');
  assert.match(duplicate[0]!.detail!, /duplicate/);
  const unexpected = evaluateStageA([...valid.slice(0, 3), trial('c', 2, fast, { wrongIcons: 0 })], expected);
  assert.equal(unexpected[0]!.status, 'failed');
  const interrupted = evaluateStageA(valid.map((t, i) => i === 3 ? { ...t, artifactsComplete: false } : t), expected);
  assert.equal(interrupted.find((g) => /verified artifacts/.test(g.gate))!.status, 'failed');
  const unknownSpendFail = evaluateStageA(valid.map((t, i) => i === 0 ? { ...t, hardFailures: undefined } : t), expected);
  assert.equal(unknownSpendFail.find((g) => /hard semantic/.test(g.gate))!.status, 'unmeasured');
  const unknownTts = evaluateStageA(valid.map((t) => ({ ...t, ttsUsdKnown: false })), expected);
  assert.equal(unknownTts.find((g) => /total lesson cost/.test(g.gate))!.status, 'unmeasured');
  const overBudget = evaluateStageA(valid.map((t) => ({ ...t, totalCostUsd: 0.11 })), expected);
  assert.equal(overBudget.find((g) => /total lesson cost/.test(g.gate))!.status, 'failed');
});

test('Stage A reports every outcome unmeasured when there are no trial artifacts', () => {
  const gates = evaluateStageA([], { cases: 2, trialsPerCase: 3, caseIds: ['a', 'b'] });
  assert.equal(gates.find((gate) => /full generation/.test(gate.gate))!.status, 'unmeasured');
  assert.equal(gates.find((gate) => /hard semantic/.test(gate.gate))!.status, 'unmeasured');
  assert.equal(gates.find((gate) => /R10-only/.test(gate.gate))!.status, 'unmeasured');
  assert.equal(gates.find((gate) => /wrong icons/.test(gate.gate))!.status, 'unmeasured');
});

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

const trial = (caseId: string, n: number, metrics: Record<string, number>, extra: Partial<TrialSummary> = {}): TrialSummary => ({ caseId, trial: n, status: 'draft', hardFailures: 0, metrics, ...extra });
const fast = { 'v2.timeToFirstClipMs': 15_000, 'v2.totalMs': 50_000, 'v2.encodeMs': 8_000, 'v2.labelledEntities': 0 };

test('Stage A: the worst trial decides latency, missing metrics are unmeasured, and unmeasured blocks acceptance', () => {
  const trials = ['a', 'b'].flatMap((id) => [1, 2].map((n) => trial(id, n, fast)));
  const gates = evaluateStageA(trials, { cases: 2, trialsPerCase: 2 });
  assert.equal(gates.find((g) => /first playable/.test(g.gate))!.status, 'passed');
  assert.equal(gates.find((g) => /wrong icons/.test(g.gate))!.status, 'unmeasured');
  assert.equal(stageAccepted(gates), false, 'wrong icons still need human review');
  const reviewed = evaluateStageA(trials.map((t) => ({ ...t, wrongIcons: 0 })), { cases: 2, trialsPerCase: 2 });
  assert.equal(stageAccepted(reviewed), true);
  const slow = evaluateStageA([...trials.slice(0, 3), trial('b', 2, { ...fast, 'v2.totalMs': 61_000 }, { wrongIcons: 0 })], { cases: 2, trialsPerCase: 2 });
  assert.equal(slow.find((g) => /full generation/.test(g.gate))!.status, 'failed');
  const missing = evaluateStageA([trial('a', 1, { 'v2.totalMs': 1 })], { cases: 2, trialsPerCase: 2 });
  assert.equal(missing.find((g) => /all trials/.test(g.gate))!.status, 'failed');
  assert.equal(missing.find((g) => /encode/.test(g.gate))!.status, 'unmeasured');
  const hard = evaluateStageA(trials.map((t, i) => ({ ...t, hardFailures: i === 0 ? 2 : 0, wrongIcons: 0 })), { cases: 2, trialsPerCase: 2 });
  assert.equal(hard.find((g) => /hard semantic/.test(g.gate))!.status, 'failed');
});

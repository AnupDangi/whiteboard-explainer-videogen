import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReliability, type ReliabilityAttempt } from '../harness/reliability.js';

const row = (reached: ReliabilityAttempt['reached'], codes: string[] = []): ReliabilityAttempt => ({
  sourceId: 's', durationSec: 60, attempt: 1, reached, passed: reached === 'done', failureCodes: codes,
  transportRetries: 0, anchoredEvidence: false, costUsd: 0.01, durationMs: 1,
});

test('stage pass rates are conditional on reaching the stage', () => {
  const summary = summarizeReliability([row('done'), row('S3', ['plan-repair-failed']), row('S2', ['concepts-repair-failed']), row('done')]);
  assert.equal(summary.byStage.s2PassRate, 0.75);
  assert.equal(summary.byStage.s3PassRate, 2 / 3);
  assert.equal(summary.byStage.s4PassRate, 1);
  assert.equal(summary.byStage.endToEndPassRate, 0.5);
  assert.deepEqual(summary.failureCodeCounts, { 'concepts-repair-failed': 1, 'plan-repair-failed': 1 });
  assert.ok(Math.abs(summary.totalCostUsd - 0.04) < 1e-9);
});

test('an empty run summarizes to zeros', () => {
  const summary = summarizeReliability([]);
  assert.deepEqual(summary.byStage, { s2PassRate: 0, s3PassRate: 0, s4PassRate: 0, endToEndPassRate: 0 });
});

test('per-call budget follows opts.budgetUsd instead of a hardcoded value (audit Batch 3)', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runReliability } = await import('../harness/reliability.js');
  const { PersistentBudgetLedger } = await import('../pipeline/budgetLedger.js');
  const dir = await mkdtemp(join(tmpdir(), 'hyp-reliability-budget-'));
  try {
    const text = '# Light and leaves\n\nThe leaf uses light to build sugar.';
    const sourcePath = join(dir, 'leaf.md');
    await writeFile(sourcePath, text);
    const sourceSpan = 'The leaf uses light to build sugar.';
    const evidence = [{ spanId: 's1', quote: sourceSpan }];
    const payloads: Record<string, unknown> = {
      concept_graph: {
        concepts: [
          { id: 'leaf', label: 'Leaf', kind: 'entity', definition: 'The leaf uses light to build sugar.', evidence, level: 'one-step' },
          { id: 'sugar', label: 'Sugar', kind: 'entity', definition: 'Sugar is built by the leaf using light.', evidence, level: 'one-step' },
        ],
        relations: [{ from: 'leaf', to: 'sugar', type: 'produces', evidence }],
        prerequisites: [],
      },
    };
    const fetcher: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
      const name = request.response_format?.json_schema?.name;
      assert.ok(name && payloads[name], `unexpected structured stage ${name}`);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payloads[name]) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 80, completion_tokens: 30, cost: 0.001 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const budgetLedger = new PersistentBudgetLedger(join(dir, 'ledger.json'), 1.0);
    // A zero per-call budget must refuse every provider call. Fail-pre: the
    // hardcoded 0.1 ignored opts.budgetUsd, so this run succeeded.
    const report = await runReliability({
      sources: [{ id: 'leaf', path: sourcePath }],
      durationsSec: [15],
      repeats: 1,
      model: 'test/reliability-budget',
      apiKey: 'test-only',
      budgetUsd: 0,
      budgetLedger,
      fetcher,
    });
    assert.equal(report.attempts.length, 1);
    assert.equal(report.attempts[0]!.passed, false);
    assert.ok(report.attempts[0]!.failureCodes.includes('cost-ceiling'), `zero budget must surface cost-ceiling, got: ${report.attempts[0]!.failureCodes.join(',')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { maxPriceForCallBudget } from '../llm/openrouter.js';
import { structuredCall } from '../llm/structuredCall.js';

test('structured provider call uses the remaining shared ledger balance for its price ceiling', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-structured-budget-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    await ledger.call(0.01, async () => ({ value: 'S2', costUsd: 0.007 }));
    let request: Record<string, unknown> | undefined;
    const system = 'test system';
    const user = 'test user';
    const result = await structuredCall({
      stage: 'S3-teaching-plan', subject: 'synthetic contract test', model: 'test/model', apiKey: 'test-only',
      system, user, schema: z.object({ ok: z.boolean() }), schemaName: 'test', maxTokens: 100,
      remainingBudgetUsd: 0.009, budgetLedger: ledger,
      fetcher: async (_input, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: 'gen-budget-test', model: 'test/model', openrouter_metadata: { attempt: 1, strategy: 'direct', endpoints: { available: [{ provider: 'test-provider', selected: true }] } },
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 2, cost: 0.001 },
        }), { status: 200 });
      },
    });
    assert.deepEqual(result.value, { ok: true });
    const provider = request?.provider as { max_price?: { prompt: number; completion: number } };
    assert.deepEqual(
      provider.max_price,
      maxPriceForCallBudget(0.003, Buffer.byteLength(`${system}\n${user}`, 'utf8'), 100),
      'request ceiling must use the $0.003 lesson balance, not the stage-local $0.009 allowance',
    );
    assert.equal((await ledger.snapshot()).spentUsd, 0.008);
    assert.deepEqual(result.rawResponses[0]?.requestPriceCeiling, maxPriceForCallBudget(0.003, Buffer.byteLength(`${system}\n${user}`, 'utf8'), 100));
    assert.equal(result.rawResponses[0]?.routing?.selectedProvider, 'test-provider');
    assert.equal(result.rawResponses[0]?.usage.costUsd, 0.001);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing provider billing usage blocks the persistent ledger instead of silently recording zero spend', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-structured-missing-cost-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    const result = await structuredCall({
      stage: 'S6-scene-plan', subject: 'synthetic billing contract test', model: 'test/model', apiKey: 'test-only',
      system: 'test system', user: 'test user', schema: z.object({ ok: z.boolean() }), schemaName: 'test', maxTokens: 100,
      remainingBudgetUsd: 0.01, budgetLedger: ledger,
      fetcher: async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 2, completion_tokens: 2 },
      }), { status: 200 }),
    });
    const snapshot = await ledger.snapshot();
    assert.equal(result.value, undefined);
    assert.equal(snapshot.spentUsd, 0);
    assert.equal(snapshot.blocked, true);
    assert.match(snapshot.uncertainty ?? '', /usage\.cost.*unverified spend/);
    assert.ok(result.failures.some((failure) => failure.hard));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

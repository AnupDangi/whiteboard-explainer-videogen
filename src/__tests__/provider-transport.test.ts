import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { ProviderNotDispatchedError, RETRYABLE_NOT_DISPATCHED, chatStructured } from '../llm/openrouter.js';
import { structuredCall } from '../llm/structuredCall.js';

const okBody = (content: string) => JSON.stringify({ id: 'gen-t', model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0.0001 } });
const noEndpoint = () => new Response('{"error":{"message":"No endpoints found that satisfy the max price"}}', { status: 404 });
const noSleep = async () => {};

test('chatStructured types a 404 no-endpoint rejection as not dispatched', async () => {
  await assert.rejects(
    chatStructured('k', { model: 'test/model', system: 's', user: 'u', schema: {}, schemaName: 't', maxTokens: 10, temperature: 0 }, async () => noEndpoint()),
    (error: unknown) => error instanceof ProviderNotDispatchedError && error.code === 'PROVIDER_NO_ENDPOINT' && error.message.startsWith('OpenRouter HTTP 404'),
  );
});

test('chatStructured keeps other HTTP errors as plain errors', async () => {
  await assert.rejects(
    chatStructured('k', { model: 'test/model', system: 's', user: 'u', schema: {}, schemaName: 't', maxTokens: 10, temperature: 0 }, async () => new Response('boom', { status: 500 })),
    (error: unknown) => !(error instanceof ProviderNotDispatchedError) && String(error).includes('OpenRouter HTTP 500'),
  );
});

test('not-dispatched retry set covers no-endpoint and rate-limit rejections only', () => {
  // Donor retry vocabulary (replaces the old isTransportError classifier):
  // PROVIDER_NO_ENDPOINT and PROVIDER_RATE_LIMITED retry as transport;
  // PROVIDER_REJECTED and PROVIDER_NOT_SENT never retry.
  assert.deepEqual([...RETRYABLE_NOT_DISPATCHED], ['PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED']);
  for (const code of ['PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED'] as const) {
    assert.ok(RETRYABLE_NOT_DISPATCHED.includes(code), `${code} must retry`);
    assert.ok(new ProviderNotDispatchedError(404, code, 'd') instanceof Error);
  }
  for (const code of ['PROVIDER_REJECTED', 'PROVIDER_NOT_SENT'] as const) {
    assert.ok(!RETRYABLE_NOT_DISPATCHED.includes(code), `${code} must not retry`);
  }
});

test('route rejection is retried as transport, not as the one repair, and the ledger stays unblocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    let calls = 0;
    const result = await structuredCall({
      stage: 'concepts', subject: 'transport test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
      schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, budgetLedger: ledger, sleep: noSleep,
      fetcher: async () => (++calls <= 2 ? noEndpoint() : new Response(okBody('{"ok":true}'), { status: 200 })),
    });
    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.usage.repairs, 0);
    assert.equal(result.rawResponses.length, 1);
    assert.equal(result.failures.filter((f) => f.code === 'concepts-transport-retry' && !f.hard).length, 2);
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.preflightFailures, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('all route rejections end in one hard failure and leave the ledger unblocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    const result = await structuredCall({
      stage: 'plan', subject: 'transport test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
      schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, budgetLedger: ledger, sleep: noSleep,
      fetcher: async () => noEndpoint(),
    });
    assert.equal(result.value, undefined);
    assert.equal(result.failures.filter((f) => f.hard).map((f) => f.code).join(','), 'plan-call-failed');
    assert.equal((await ledger.snapshot()).blocked, false);
    assert.equal((await ledger.snapshot()).spentUsd, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generic fetch failures retry as transport and do not poison the shared ledger', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    let calls = 0;
    const result = await structuredCall({
      stage: 'syllabus', subject: 'fetch retry test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
      schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, budgetLedger: ledger, sleep: noSleep,
      fetcher: async () => {
        calls++;
        if (calls === 1) throw new TypeError('fetch failed');
        return new Response(okBody('{"ok":true}'), { status: 200 });
      },
    });
    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.usage.repairs, 0);
    assert.equal(result.failures.filter((f) => f.code === 'syllabus-transport-retry' && !f.hard).length, 1);
    assert.equal((await ledger.snapshot()).blocked, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('RAG sidecar 429 is recorded as non-blocking preflight and does not poison later provider spend', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    await assert.rejects(ledger.call(0.05, async () => { throw new Error('RAG sidecar index failed: RateLimitError HTTP 429 Too Many Requests'); }), /429/);
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.preflightFailures, 1);
    assert.equal(snapshot.spentUsd, 0);
    const next = await ledger.call(0.05, async () => ({ value: 'ok', costUsd: 0.001 }));
    assert.equal(next.allowed, true);
    assert.equal((await ledger.snapshot()).spentUsd, 0.001);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a validator exception is a distinct hard failure and spends no repair', async () => {
  const result = await structuredCall({
    stage: 'plan', subject: 'validator test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
    schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, sleep: noSleep,
    validate: () => { throw new Error('validator bug'); },
    fetcher: async () => new Response(okBody('{"ok":true}'), { status: 200 }),
  });
  assert.equal(result.value, undefined);
  assert.equal(result.usage.repairs, 0);
  assert.ok(result.failures.some((f) => f.code === 'plan-validator-threw' && f.hard && f.message.includes('validator bug')));
});

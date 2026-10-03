import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { chatVision, priceCeilingForModel, worstCaseCallUsd, type ChatRequest, type ChatResult } from '../llm/openrouter.js';
import type { ModelClient } from '../llm/modelClient.js';
import { structuredCall } from '../llm/structuredCall.js';
import { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { loadOpenRouterEnv } from '../planner/env.js';
import { openRouterBaseUrl, setOpenRouterBaseUrl } from '../llm/openrouter.js';

const chatResponse = (content: string, finishReason = 'stop', costUsd = 0.001) => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 10, completion_tokens: 10, cost: costUsd },
}), { status: 200 });

const baseCall = { stage: 'plan', subject: 'synthetic model-layer test', model: 'test/model', apiKey: 'test-only', system: 'system', user: 'user', schema: z.object({ ok: z.boolean() }), schemaName: 'test' };

test('a model whose worst-case cost cannot fit the remaining budget fails before anything is sent', async () => {
  let sent = 0;
  const result = await structuredCall({
    ...baseCall, maxTokens: 10_000, remainingBudgetUsd: 0.01,
    modelPricing: { promptUsdPerToken: 1e-6, completionUsdPerToken: 10e-6 },
    fetcher: async () => { sent++; return chatResponse('{"ok":true}'); },
  });
  assert.equal(sent, 0);
  assert.equal(result.value, undefined);
  assert.equal(result.failures[0]?.code, 'model-too-expensive-for-budget');
  assert.match(result.failures[0]!.message, /could cost up to \$0\.10/);
});

test('known model prices pin max_price to the model\'s own price plus headroom, not a budget split', async () => {
  let body: Record<string, unknown> | undefined;
  const pricing = { promptUsdPerToken: 0.3e-6, completionUsdPerToken: 2.5e-6 };
  const result = await structuredCall({
    ...baseCall, maxTokens: 4000, remainingBudgetUsd: 0.05, modelPricing: pricing,
    fetcher: async (_url, init) => { body = JSON.parse(String(init?.body)); return chatResponse('{"ok":true}'); },
  });
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual((body?.provider as { max_price?: unknown }).max_price, priceCeilingForModel(pricing));
  assert.deepEqual(priceCeilingForModel(pricing), { prompt: 0.375, completion: 3.125 });
  // A cheap flash model now fits where the old one-byte-per-token split priced it out.
  assert.ok(worstCaseCallUsd(pricing, 120_000, 10_000) < 0.05);
});

test('calls with a reserved worst case run concurrently and settle their billed cost', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-ledger-reserve-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.1);
    // A barrier, not a sleep: each call waits (up to 5 s) until both are inside
    // the provider. If the ledger held its lock during a call, the second could
    // not start and the first would time out, so the check does not depend on load.
    let started = 0;
    let bothInside!: () => void;
    const barrier = new Promise<void>((resolve) => { bothInside = resolve; });
    const overlapped: boolean[] = [];
    const work = async () => {
      if (++started === 2) bothInside();
      overlapped.push(await Promise.race([barrier.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]));
      return { value: 'ok', costUsd: 0.002 };
    };
    const results = await Promise.all([ledger.call(0.1, work, { reserveUsd: 0.02 }), ledger.call(0.1, work, { reserveUsd: 0.02 })]);
    assert.ok(results.every((result) => result.allowed));
    assert.deepEqual(overlapped, [true, true], 'the lock is not held while the provider works');
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.calls, 2);
    assert.ok(Math.abs(snapshot.spentUsd - 0.004) < 1e-12);
    assert.equal(snapshot.reservedUsd, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a reservation that does not fit waits for in-flight calls, then fails only if it still does not fit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-ledger-wait-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.03);
    const slow = ledger.call(0.03, async () => { await new Promise((resolve) => setTimeout(resolve, 80)); return { value: 'first', costUsd: 0.001 }; }, { reserveUsd: 0.02 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const waited = await ledger.call(0.03, async () => ({ value: 'second', costUsd: 0.001 }), { reserveUsd: 0.02 });
    assert.equal(waited.allowed, true, 'it ran after the first call settled well below its reservation');
    await slow;
    const tooBig = await ledger.call(0.03, async () => ({ value: 'never', costUsd: 0 }), { reserveUsd: 0.05 });
    assert.deepEqual(tooBig, { allowed: false, spentUsd: 0.002, reason: 'reservation-exceeds-budget' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a response cut off at the token limit is labelled truncated and the repair gets more output tokens', async () => {
  const maxTokens: number[] = [];
  const prompts: string[] = [];
  let call = 0;
  const result = await structuredCall({
    ...baseCall, maxTokens: 1000, remainingBudgetUsd: 1,
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { max_tokens: number; messages: Array<{ role: string; content: string }> };
      maxTokens.push(request.max_tokens);
      prompts.push(request.messages[1]!.content);
      return ++call === 1 ? chatResponse(`{"ok": tr${' '.repeat(100_000)}`, 'length') : chatResponse('{"ok":true}');
    },
  });
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(maxTokens, [1000, 1500]);
  assert.match(prompts[1]!, /incomplete output is omitted/);
  assert.match(prompts[1]!, /Rebuild the entire response from the original instructions/);
  assert.doesNotMatch(prompts[1]!, /\{"ok": tr/);
  assert.ok(prompts[1]!.length < 500, 'a huge truncated whitespace tail must not be copied into the repair prompt');
  assert.doesNotMatch(prompts[1]!, /[ \t]{50}/);
  assert.equal(result.failures.find((failure) => failure.code === 'plan-truncated')?.hard, false);
  assert.equal(result.rawResponses[0]?.finishReason, 'length');
});

test('a request the provider rejects (4xx) is not retried and leaves the ledger usable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-ledger-4xx-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.1);
    let sent = 0;
    const result = await structuredCall({
      ...baseCall, maxTokens: 100, remainingBudgetUsd: 0.1, budgetLedger: ledger, sleep: async () => {},
      fetcher: async () => { sent++; return new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 }); },
    });
    assert.equal(sent, 1, 'a rejected request is never retried');
    assert.equal(result.failures[0]?.code, 'plan-call-failed');
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, false, 'no model ran, so spend is not uncertain');
    assert.equal(snapshot.preflightFailures, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stages can run on any ModelClient adapter', async () => {
  const seen: ChatRequest[] = [];
  const client: ModelClient = {
    provider: 'fake',
    chat: async (request): Promise<ChatResult> => {
      seen.push(request);
      return { content: '{"ok":true}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0 } };
    },
    pricing: async () => ({ promptUsdPerToken: 1e-7, completionUsdPerToken: 1e-7 }),
  };
  const result = await structuredCall({ ...baseCall, maxTokens: 100, remainingBudgetUsd: 0.01, client });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(seen[0]?.timeoutMs, 180_000);
  assert.deepEqual(seen[0]?.maxPriceUsdPerMillionTokens, priceCeilingForModel({ promptUsdPerToken: 1e-7, completionUsdPerToken: 1e-7 }));
});

test('the vision judge refuses a response without billed cost instead of recording $0', async () => {
  await assert.rejects(
    () => chatVision('test-only', { model: 'test/vision', prompt: 'judge', imagesPng: [], maxTokens: 10 }, async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })),
    /usage\.cost/,
  );
});

test('each content stage can use its own model; the content model is the default and the director key is a legacy alias', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-env-'));
  const previous = openRouterBaseUrl();
  try {
    const envFile = path.join(root, '.env');
    await writeFile(envFile, ['OPENROUTER_API_KEY=file-secret-test-value', 'OPENROUTER_DIRECTOR_MODEL=provider/content-test', 'OPENROUTER_SCENE_MODEL=provider/scene-test', 'OPENROUTER_PLAN_MODEL=provider/plan-test', 'OPENROUTER_BASE_URL=https://example.test/api/v1'].join('\n'));
    const env = await loadOpenRouterEnv(envFile, {});
    assert.equal(env.contentModel, 'provider/content-test');
    assert.deepEqual(env.stageModels, { plan: 'provider/plan-test' });
    assert.equal(openRouterBaseUrl(), 'https://example.test/api/v1');
    await writeFile(envFile, 'OPENROUTER_API_KEY=x\nOPENROUTER_SCENE_MODEL=provider/scene-test\n');
    await assert.rejects(() => loadOpenRouterEnv(envFile, {}), /OPENROUTER_CONTENT_MODEL \(or OPENROUTER_DIRECTOR_MODEL\) is not set/);
  } finally {
    setOpenRouterBaseUrl(previous);
    await rm(root, { recursive: true, force: true });
  }
});

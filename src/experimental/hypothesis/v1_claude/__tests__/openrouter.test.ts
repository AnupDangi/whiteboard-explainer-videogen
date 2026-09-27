import test from 'node:test';
import assert from 'node:assert/strict';
import { chatStructured, maxPriceForCallBudget, promptTokenEstimate, schemaLimitLines } from '../llm/openrouter.js';

test('call budget derives per-token provider ceilings with framing headroom', () => {
  const budget = 0.02;
  const promptBytes = 1200;
  const maxTokens = 1000;
  const ceilings = maxPriceForCallBudget(budget, promptBytes, maxTokens)!;
  const promptUpperBound = promptTokenEstimate(promptBytes);
  const promptSpendUpperBound = promptUpperBound * ceilings.prompt / 1_000_000;
  const completionSpendUpperBound = maxTokens * ceilings.completion / 1_000_000;
  assert.ok(promptSpendUpperBound + completionSpendUpperBound <= budget * 0.9);
  assert.ok(budget * 0.1 >= 0.0019, 'ten percent remains unallocated for request/framing charges');
  assert.equal(maxPriceForCallBudget(0, promptBytes, maxTokens), undefined);
});

test('OpenRouter request carries per-million-token ceilings while preserving parameter constraints', async () => {
  let body: Record<string, unknown> | undefined;
  let headers: HeadersInit | undefined;
  const result = await chatStructured('test-key', {
    model: 'anthropic/claude-sonnet-test', system: 'system', user: 'user', schema: { type: 'object' },
    schemaName: 'test', maxTokens: 100, temperature: 0,
    maxPriceUsdPerMillionTokens: { prompt: 3.25, completion: 7.5 },
  }, async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    headers = init?.headers;
    return new Response(JSON.stringify({ id: 'gen-test', model: 'anthropic/claude-sonnet-test', openrouter_metadata: { attempt: 1, strategy: 'direct', endpoints: { available: [{ model: 'anthropic/claude-sonnet-test', provider: 'Anthropic', selected: true }], total: 1 } }, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.0001 } }), { status: 200 });
  });
  const provider = body?.provider as Record<string, unknown>;
  assert.deepEqual(provider, { max_price: { prompt: 3.25, completion: 7.5 } });
  assert.equal(new Headers(headers).get('X-OpenRouter-Metadata'), 'enabled');
  assert.equal(result.content, '{"ok":true}');
  assert.deepEqual(result.routing, { generationId: 'gen-test', selectedModel: 'anthropic/claude-sonnet-test', selectedProvider: 'Anthropic', strategy: 'direct', attempt: 1 });
});

test('OpenRouter rejects a response with missing or invalid billing usage instead of recording zero spend', async () => {
  await assert.rejects(() => chatStructured('test-key', {
    model: 'test/model', system: 'system', user: 'user', schema: { type: 'object' },
    schemaName: 'test', maxTokens: 10, temperature: 0,
  }, async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), { status: 200 })), /usage\.cost.*unverified spend/);

  await assert.rejects(() => chatStructured('test-key', {
    model: 'test/model', system: 'system', user: 'user', schema: { type: 'object' },
    schemaName: 'test', maxTokens: 10, temperature: 0,
  }, async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, cost: 'NaN' },
  }), { status: 200 })), /usage\.cost.*unverified spend/);
});

test('OpenAI routes get the schema non-strict (they reject optional properties); other routes stay strict', async () => {
  const strictFor = async (model: string): Promise<unknown> => {
    let body: Record<string, unknown> = {};
    await chatStructured('test-key', { model, system: 'system', user: 'user', schema: { type: 'object' }, schemaName: 'test', maxTokens: 10, temperature: 0 }, async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }), { status: 200 });
    });
    return (body.response_format as { json_schema: { strict: boolean } }).json_schema.strict;
  };
  assert.equal(await strictFor('openai/gpt-test'), false);
  assert.equal(await strictFor('google/gemini-test'), true);
});

test('non-strict routes state schema length/count limits in the system prompt', () => {
  const schema = { type: 'object', properties: { intro: { type: 'object', properties: { sections: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 80 } } } } } };
  assert.deepEqual(schemaLimitLines(schema), ['intro.sections: at most 12 items', 'intro.sections[]: at most 80 characters']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { chatStructured } from '../llm/openrouter.js';
import { structuredCall } from '../llm/structuredCall.js';

const reply = (content: string): Response => new Response(JSON.stringify({ id: 'g', model: 'm', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0.0001 } }), { status: 200 });
const base = { stage: 'S3-teaching-plan', subject: 'strict contract', apiKey: 'test-only', system: 's', user: 'u', schemaName: 'strict_test', maxTokens: 100, remainingBudgetUsd: 1 };
const schema = z.object({ a: z.string(), b: z.string().optional() }).strict();

test('an OpenAI route sends the compiled strict schema, accepts null for optional fields and reports truthful constraint', async () => {
  let body: Record<string, unknown> = {};
  const result = await structuredCall({
    ...base, model: 'openai/gpt-test', schema,
    fetcher: async (_u, init) => { body = JSON.parse(String(init?.body)) as Record<string, unknown>; return reply('{"a":"x","b":null}'); },
  });
  const format = (body.response_format as { json_schema: { strict: boolean; schema: { required: string[]; properties: Record<string, unknown> } } }).json_schema;
  assert.equal(format.strict, true);
  assert.deepEqual([...format.schema.required].sort(), ['a', 'b']);
  assert.deepEqual(format.schema.properties.b, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.deepEqual(result.value, { a: 'x' });
  assert.equal(result.failures.length, 0);
  assert.equal(result.reports[0]!.schemaConstrained, true);
  assert.equal(result.reports[0]!.strict, true);
  assert.equal(result.reports[0]!.provider, 'openai-strict');
  assert.equal(result.reports[0]!.model, 'openai/gpt-test');
  assert.equal(result.reports[0]!.firstTryValid, true);
  assert.match(result.reports[0]!.schemaHash, /^[0-9a-f]{64}$/);
  assert.equal(result.rawResponses[0]!.schemaConstrained, true);
});

test('a generic route keeps the schema unchanged and is reported constrained', async () => {
  let body: Record<string, unknown> = {};
  const result = await structuredCall({ ...base, model: 'google/gemini-test', schema, fetcher: async (_u, init) => { body = JSON.parse(String(init?.body)) as Record<string, unknown>; return reply('{"a":"x"}'); } });
  const format = (body.response_format as { json_schema: { schema: { required: string[] } } }).json_schema;
  assert.deepEqual(format.schema.required, ['a']);
  assert.equal(result.reports[0]!.provider, 'generic');
  assert.equal(result.reports[0]!.schemaConstrained, true);
});

test('a schema the provider cannot decode under is reported UNCONSTRAINED, never claimed constrained', async () => {
  const wide = z.object(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, z.string().optional()]))).strict();
  const result = await structuredCall({ ...base, model: 'anthropic/claude-test', schema: wide, fetcher: async () => reply('{}') });
  assert.equal(result.reports[0]!.schemaConstrained, false);
  assert.equal(result.reports[0]!.strict, true);
});

test('first-try validity is false when the first response needed a repair', async () => {
  let calls = 0;
  const result = await structuredCall({ ...base, model: 'google/gemini-test', schema, fetcher: async () => { calls++; return reply(calls === 1 ? '{"a":1}' : '{"patches":[{"op":"replace","path":"/a","valueJson":"\\"fixed\\""}]}'); } });
  assert.deepEqual(result.value, { a: 'fixed' });
  assert.equal(result.reports[0]!.firstTryValid, false);
  assert.equal(result.reports[0]!.repairs, 1);
});

test('chatStructured reports a non-strict OpenAI request as not schema-constrained', async () => {
  const run = (strictSchema: boolean) => chatStructured('k', { model: 'openai/gpt-test', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 't', maxTokens: 10, temperature: 0, ...(strictSchema ? { strictSchema: true } : {}) }, async () => reply('{}'));
  assert.equal((await run(false)).schemaConstrained, false);
  assert.equal((await run(true)).schemaConstrained, true);
});

test('limits the strict compile had to drop are still stated to the model in the system prompt', async () => {
  let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
  const bounded = z.object({ id: z.string().min(1).max(40), note: z.string().max(120).optional() }).strict();
  const result = await structuredCall({ ...base, model: 'openai/gpt-test', schema: bounded, fetcher: async (_u, init) => { body = JSON.parse(String(init?.body)); return reply('{"id":"x","note":null}'); } });
  const system = body.messages.find((m) => m.role === 'system')!.content;
  assert.match(system, /id: at most 40 characters/);
  assert.match(system, /note: at most 120 characters/);
  assert.deepEqual(result.reports[0]!.droppedKeywords.map((d) => d.keyword).sort(), ['maxLength', 'maxLength', 'minLength']);
});

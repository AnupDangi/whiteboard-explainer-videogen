import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { applyPatches, decodePatchResponse, patchOutsideTargets, pointerFromPath, valueAtPointer } from '../structured/jsonPointerRepair.js';
import { structuredCall } from '../llm/structuredCall.js';
import type { ModelClient } from '../llm/modelClient.js';
import type { ChatRequest } from '../llm/openrouter.js';

test('pointers are built from zod paths and resolve values, with ~ and / escaped', () => {
  assert.equal(pointerFromPath(['a', 0, 'b/c', 'd~e']), '/a/0/b~1c/d~0e');
  assert.equal(pointerFromPath([]), '');
  const doc = { a: [{ 'b/c': { 'd~e': 7 } }] };
  assert.equal(valueAtPointer(doc, '/a/0/b~1c/d~0e'), 7);
  assert.equal(valueAtPointer(doc, '/a/3'), undefined);
});

test('applyPatches replaces, adds and removes without mutating the input and refuses a pointer that does not resolve', () => {
  const doc = { items: [{ n: 'x', qty: 'bad' }, { n: 'y', qty: 2 }], note: 'keep' };
  const out = applyPatches(doc, [
    { op: 'replace', path: '/items/0/qty', value: 5 },
    { op: 'add', path: '/items/1/tag', value: 'new' },
    { op: 'remove', path: '/note' },
  ]) as typeof doc & { items: Array<Record<string, unknown>> };
  assert.deepEqual(out, { items: [{ n: 'x', qty: 5 }, { n: 'y', qty: 2, tag: 'new' }] });
  assert.equal(doc.items[0]!.qty, 'bad');
  assert.throws(() => applyPatches(doc, [{ op: 'replace', path: '/items/9/qty', value: 1 }]), /does not resolve/);
  assert.throws(() => applyPatches(doc, [{ op: 'replace', path: '/nope', value: 1 }]), /does not resolve/);
});

const schema = z.object({ title: z.string(), items: z.array(z.object({ n: z.string(), qty: z.number() }).strict()) }).strict();
const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0001 };
function scripted(replies: string[]): { client: ModelClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return { requests, client: { provider: 'fake', chat: async (request) => { requests.push(request); return { content: replies[requests.length - 1] ?? '{}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }; } } };
}
const base = { stage: 'plan', subject: 'pointer repair', model: 'google/x', apiKey: 'k', system: 's', user: 'ORIGINAL PROMPT', schema, schemaName: 'doc', maxTokens: 200, remainingBudgetUsd: 1 };

test('array add accepts the append pointer in sequential repairs without mutating accepted data', () => {
  const doc = { items: [{ n: 'a', qty: 1 }], title: 'accepted' };
  const out = applyPatches(doc, [
    { op: 'add', path: '/items/0', value: { n: 'before', qty: 2 } },
    { op: 'add', path: '/items/-', value: { n: 'after', qty: 3 } },
    { op: 'add', path: '/items/-', value: { n: 'last', qty: 4 } },
  ]);
  assert.deepEqual(out, { title: 'accepted', items: [{ n: 'before', qty: 2 }, { n: 'a', qty: 1 }, { n: 'after', qty: 3 }, { n: 'last', qty: 4 }] });
  assert.deepEqual(doc, { items: [{ n: 'a', qty: 1 }], title: 'accepted' });
  for (const op of ['replace', 'remove'] as const) assert.throws(() => applyPatches(doc, [{ op, path: '/items/-', value: 0 }]), /does not resolve/);
  for (const key of ['', '01', '+1', '1.0', '1e0', ' ', '2']) assert.throws(() => applyPatches(doc, [{ op: 'add', path: `/items/${key}`, value: 0 }]), /does not resolve/);
});

test('a missing array member can be repaired by an append patch and remains explicitly counted as a repair', async () => {
  const { client } = scripted([
    JSON.stringify({ title: 'accepted', items: [{ n: 'a', qty: 1 }] }),
    JSON.stringify({ patches: [{ op: 'add', path: '/items/-', valueJson: '{"n":"b","qty":2}' }] }),
  ]);
  const result = await structuredCall({ ...base, client, validate: (v) => v.items.length < 2 ? [{ path: '/items', message: 'missing required member' }] : [] });
  assert.deepEqual(result.value, { title: 'accepted', items: [{ n: 'a', qty: 1 }, { n: 'b', qty: 2 }] });
  assert.equal(result.reports[0]!.repairs, 1);
  assert.equal(result.reports[0]!.firstTryValid, false);
  assert.equal(result.trace.repairs[0]!.mode, 'patch');
});

test('a schema failure at a pointer is repaired with a patch for that pointer only, not a regenerated document', async () => {
  const bad = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 1 }, { n: 'b', qty: 'many' }] });
  const { client, requests } = scripted([bad, JSON.stringify({ patches: [{ op: 'replace', path: '/items/1/qty', valueJson: '5' }] })]);
  const result = await structuredCall({ ...base, client });
  assert.deepEqual(result.value, { title: 'T', items: [{ n: 'a', qty: 1 }, { n: 'b', qty: 5 }] });
  assert.equal(requests[1]!.schemaName, 'json_patch');
  assert.match(requests[1]!.user, /\/items\/1\/qty/);
  assert.match(requests[1]!.user, /"many"/, 'the current bad value is shown');
  assert.doesNotMatch(requests[1]!.user, /title.*items.*qty.*regenerate/i);
  const [repair] = result.trace.repairs;
  assert.equal(repair!.mode, 'patch');
  assert.deepEqual(repair!.targets, ['/items/1/qty']);
  assert.deepEqual(repair!.patches, [{ op: 'replace', path: '/items/1/qty', value: 5 }]);
  assert.equal(result.reports[0]!.repairs, 1);
  assert.equal(result.reports[0]!.firstTryValid, false);
});

test('a validator problem without a pointer falls back to a full-document repair and says so', async () => {
  const ok = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 1 }] });
  const { client, requests } = scripted([ok, JSON.stringify({ title: 'Fixed', items: [{ n: 'a', qty: 1 }] })]);
  const result = await structuredCall({ ...base, client, validate: (v) => (v.title === 'T' ? ['title must not be T'] : []) });
  assert.equal(result.value?.title, 'Fixed');
  assert.equal(requests[1]!.schemaName, 'doc');
  assert.equal(result.trace.repairs[0]!.mode, 'full');
});

test('an unusable patch costs a repair, leaves the document unchanged, and at most two repairs run', async () => {
  const bad = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 'x' }] });
  const { client, requests } = scripted([bad, JSON.stringify({ patches: [{ op: 'replace', path: '/items/0/qty/deep', valueJson: '1' }] }), JSON.stringify({ patches: [{ op: 'replace', path: '/items/0/qty', valueJson: '"still bad"' }] })]);
  const result = await structuredCall({ ...base, client, maxRepairs: 2 });
  assert.equal(result.value, undefined);
  assert.equal(requests.length, 3, 'one call + two repairs');
  assert.equal(result.reports[0]!.repairs, 2);
  assert.ok(result.failures.some((f) => f.code === 'plan-repair-failed' && f.hard));
  assert.match(result.trace.repairs[0]!.error ?? '', /does not resolve/);
  assert.equal(result.trace.repairs[1]!.mode, 'patch');
});

test('a patch whose value is not valid JSON text is rejected as an unusable patch', async () => {
  const bad = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 'x' }] });
  const { client } = scripted([bad, JSON.stringify({ patches: [{ op: 'replace', path: '/items/0/qty', valueJson: 'not json' }] })]);
  const result = await structuredCall({ ...base, client });
  assert.equal(result.value, undefined);
  assert.match(result.trace.repairs[0]!.error ?? '', /valueJson/);
});

test('a validator problem that carries a pointer is repaired by a patch; a mixed list falls back to the full repair', async () => {
  const doc = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 0 }] });
  const patchReply = JSON.stringify({ patches: [{ op: 'replace', path: '/items/0/qty', valueJson: '3' }] });
  const pointed = scripted([doc, patchReply]);
  const ok = await structuredCall({ ...base, client: pointed.client, validate: (v) => (v.items[0]!.qty <= 0 ? [{ path: '/items/0/qty', message: 'qty must be positive' }] : []) });
  assert.deepEqual(ok.value?.items[0]?.qty, 3);
  assert.equal(pointed.requests[1]!.schemaName, 'json_patch');
  assert.match(pointed.requests[1]!.user, /qty must be positive/);
  assert.deepEqual(ok.trace.repairs[0]!.targets, ['/items/0/qty']);

  const mixed = scripted([doc, JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 3 }] })]);
  const full = await structuredCall({ ...base, client: mixed.client, validate: (v) => (v.items[0]!.qty <= 0 ? [{ path: '/items/0/qty', message: 'qty must be positive' }, 'the document needs a different title'] : []) });
  assert.equal(mixed.requests[1]!.schemaName, 'doc');
  assert.equal(full.trace.repairs[0]!.mode, 'full');
});

test('patches outside the rejected pointers are refused, descendants of a target are allowed', () => {
  const ok = [{ op: 'replace' as const, path: '/items/1/qty', value: 1 }, { op: 'add' as const, path: '/items/-', value: {} }];
  assert.equal(patchOutsideTargets(ok, ['/items/1/qty', '/items']), undefined);
  assert.deepEqual(patchOutsideTargets([{ op: 'replace', path: '/title', value: 'x' }], ['/items/1/qty'])?.path, '/title');
  assert.equal(patchOutsideTargets([{ op: 'replace', path: '/items', value: [] }], ['/items/1/qty'])?.path, '/items');
  assert.equal(patchOutsideTargets([{ op: 'replace', path: '/anything', value: 1 }], ['']), undefined);
});

test('a repair patch that rewrites accepted content is an unusable patch and leaves the document unchanged', async () => {
  const bad = JSON.stringify({ title: 'T', items: [{ n: 'a', qty: 1 }, { n: 'b', qty: 'many' }] });
  const { client } = scripted([bad, JSON.stringify({ patches: [{ op: 'replace', path: '/title', valueJson: '"changed"' }] }), JSON.stringify({ patches: [{ op: 'replace', path: '/items/1/qty', valueJson: '5' }] })]);
  const result = await structuredCall({ ...base, client, maxRepairs: 2 });
  assert.deepEqual(result.value, { title: 'T', items: [{ n: 'a', qty: 1 }, { n: 'b', qty: 5 }] });
  assert.match(result.trace.repairs[0]!.error ?? '', /outside the rejected fields/);
});

test('bare text for a string pointer is accepted as that string; for non-strings it is still unusable', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' }, qty: { type: 'number' } } };
  const patches = (valueJson: string, path: string) => JSON.stringify({ patches: [{ op: 'replace', path, valueJson }] });
  assert.deepEqual(decodePatchResponse(patches('A plain sentence.', '/title'), schema), [{ op: 'replace', path: '/title', value: 'A plain sentence.' }]);
  assert.throws(() => decodePatchResponse(patches('five', '/qty'), schema), /not valid JSON text/);
  assert.throws(() => decodePatchResponse(patches('A plain sentence.', '/title')), /not valid JSON text/, 'without a schema nothing is guessed');
});

test('a remove patch may carry a null valueJson (strict providers send every key)', () => {
  const patches = decodePatchResponse(JSON.stringify({ patches: [{ op: 'remove', path: '/items/0', valueJson: null }] }));
  assert.deepEqual(patches, [{ op: 'remove', path: '/items/0' }]);
  assert.throws(() => decodePatchResponse(JSON.stringify({ patches: [{ op: 'replace', path: '/title', valueJson: null }] })), /valueJson is required/);
});

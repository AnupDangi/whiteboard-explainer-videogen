import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { collectCoercions, diffCoercions, ledgerPreprocess, recordCoercion } from '../structured/coercionLedger.js';
import { ConceptGraphSchema, TeachingPlanDraftSchema } from '../plan/schemas.js';
import { SyllabusOutputSchema } from '../plan/hierarchical.js';
import { structuredCall } from '../llm/structuredCall.js';

test('diff classifies truncation as low, replaced enum / removed item / removed key as semantic, whitespace and id slugs as none', () => {
  const before = { title: 'Hello brave new world', kind: 'bogus', items: ['a', 'b', 'c'], extra: 1, spaced: 'a  b', id: 'My Concept', same: 'x' };
  const after = { title: 'Hello brave', kind: 'entity', items: ['a'], spaced: 'a b', id: 'my_concept', same: 'x' };
  const entries = diffCoercions(before, after, 'test');
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  assert.equal(byPath['/title']!.semanticRisk, 'low');
  assert.equal(byPath['/kind']!.semanticRisk, 'semantic');
  assert.equal(byPath['/kind']!.oldValue, 'bogus');
  assert.equal(byPath['/kind']!.newValue, 'entity');
  assert.equal(byPath['/items/1']!.semanticRisk, 'semantic');
  assert.equal(byPath['/items/2']!.semanticRisk, 'semantic');
  assert.equal(byPath['/extra']!.semanticRisk, 'semantic');
  assert.equal(byPath['/spaced'], undefined, 'whitespace-only change is allowed silent normalization');
  assert.equal(byPath['/id'], undefined, 'id slug normalization is allowed silent normalization');
  assert.equal(byPath['/same'], undefined);
  assert.ok(entries.every((e) => e.reason === 'test'));
});

test('a field added with an empty default is low risk; any other added value is semantic', () => {
  const entries = diffCoercions({ a: 1 }, { a: 1, recall: [], note: 'invented' }, 'defaulted');
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  assert.equal(byPath['/recall']!.semanticRisk, 'low');
  assert.equal(byPath['/note']!.semanticRisk, 'semantic');
});

test('recording outside a scope is a no-op and scopes do not leak into each other', () => {
  recordCoercion({ path: '/x', oldValue: 1, newValue: 2, reason: 'outside', semanticRisk: 'low' });
  const outer = collectCoercions(() => {
    recordCoercion({ path: '/a', oldValue: 1, newValue: 2, reason: 'outer', semanticRisk: 'low' });
    const inner = collectCoercions(() => { recordCoercion({ path: '/b', oldValue: 1, newValue: 2, reason: 'inner', semanticRisk: 'low' }); return 'in'; });
    assert.equal(inner.entries.length, 1);
    return 'out';
  });
  assert.equal(outer.result, 'out');
  assert.deepEqual(outer.entries.map((e) => e.path), ['/a']);
});

test('ledgerPreprocess records what its coercer changed and nothing when the input was already clean', () => {
  const schema = ledgerPreprocess('upper', (raw) => (raw && typeof raw === 'object' ? { ...(raw as object), tag: String((raw as { tag: string }).tag).slice(0, 3) } : raw), z.object({ tag: z.string() }));
  const dirty = collectCoercions(() => schema.parse({ tag: 'abcdef' }));
  assert.deepEqual(dirty.result, { tag: 'abc' });
  assert.deepEqual(dirty.entries.map((e) => [e.path, e.semanticRisk]), [['/tag', 'low']]);
  assert.equal(collectCoercions(() => schema.parse({ tag: 'abc' })).entries.length, 0);
});

test('the S2 concept graph coercer records an unknown kind and level as semantic coercions', () => {
  const raw = { concepts: [{ id: 'c1', label: 'A', kind: 'bogus', definition: 'd', evidence: [{ spanId: 's1', quote: 'q' }], level: 'x' }], relations: [], prerequisites: [] };
  const { result, entries } = collectCoercions(() => ConceptGraphSchema.safeParse(raw));
  assert.equal(result.success, true);
  const semantic = entries.filter((e) => e.semanticRisk === 'semantic').map((e) => e.path).sort();
  assert.deepEqual(semantic, ['/concepts/0/kind', '/concepts/0/level']);
});

test('the S3 plan coercer records advisory enum fallbacks and dropped values', () => {
  const raw = { targetDurationSec: 60, intro: { sourceTitle: 't', sections: [] }, recap: { keyPoints: [] }, sections: [{ id: 's', title: 'T', goal: 'g', kind: 'weird', conceptIds: ['c'], budgetSec: 10, teachingSkill: 'nonsense', candidateMechanisms: ['focus', 'bogus'], essentialClaims: [], visualForm: 'hologram' }] };
  const { entries } = collectCoercions(() => TeachingPlanDraftSchema.safeParse(raw));
  const paths = entries.filter((e) => e.semanticRisk === 'semantic').map((e) => e.path).sort();
  assert.deepEqual(paths, ['/sections/0/candidateMechanisms/1', '/sections/0/kind', '/sections/0/teachingSkill', '/sections/0/visualForm']);
});

test('the syllabus coercer records clamped prose as low risk', () => {
  const long = 'word '.repeat(80).trim();
  const raw = { coverageReason: long, learningObjective: 'ok', concepts: [], prerequisites: [], modules: [] };
  const { entries } = collectCoercions(() => SyllabusOutputSchema.safeParse(raw));
  assert.ok(entries.some((e) => e.path === '/coverageReason' && e.semanticRisk === 'low'), JSON.stringify(entries.map((e) => e.path)));
});

test('structuredCall returns only the accepted attempt\'s coercions and counts them in the report', async () => {
  const reply = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }), { status: 200 });
  const run = (content: string) => structuredCall({
    stage: 'concepts', subject: 'ledger', model: 'google/x', apiKey: 'k', system: 's', user: 'u', schema: ConceptGraphSchema, schemaName: 'cg', maxTokens: 100, remainingBudgetUsd: 1,
    fetcher: async () => reply(content),
  });
  const dirty = await run(JSON.stringify({ concepts: [{ id: 'c1', label: 'A', kind: 'bogus', definition: 'd', evidence: [{ spanId: 's1', quote: 'q' }], level: 'one-step' }], relations: [], prerequisites: [] }));
  assert.equal(dirty.reports[0]!.coercions.semantic, 1);
  assert.deepEqual(dirty.trace.coercions.map((e) => e.path), ['/concepts/0/kind']);
  const clean = await run(JSON.stringify({ concepts: [{ id: 'c1', label: 'A', kind: 'entity', definition: 'd', evidence: [{ spanId: 's1', quote: 'q' }], level: 'one-step' }], relations: [], prerequisites: [] }));
  assert.equal(clean.reports[0]!.coercions.total, 0);
});

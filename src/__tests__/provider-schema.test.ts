import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { compileProviderSchema, providerForModel } from '../structured/providerSchema.js';
import { normalizeNullable } from '../structured/normalizeNullable.js';
import { TeachingPlanDraftSchema, ScriptSchema, ConceptGraphSchema, ScopedConceptGraphSchema } from '../plan/schemas.js';
import { SyllabusOutputSchema } from '../plan/hierarchical.js';
import { boardSchema } from '../planner/board.js';
import { BeatPlanDraftSchema } from '../teaching/beat-plan/types.js';
import { JsonPatchResponseSchema } from '../structured/jsonPointerRepair.js';

const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
};

type Node = Record<string, unknown>;
function* objectNodes(node: unknown): Generator<Node> {
  if (Array.isArray(node)) { for (const item of node) yield* objectNodes(item); return; }
  if (!node || typeof node !== 'object') return;
  const record = node as Node;
  if (record.type === 'object' || record.properties) yield record;
  for (const value of Object.values(record)) yield* objectNodes(value);
}

test('provider selection follows the model route prefix', () => {
  assert.equal(providerForModel('openai/gpt-6-luna'), 'openai-strict');
  assert.equal(providerForModel('~openai/anything'), 'openai-strict');
  assert.equal(providerForModel('anthropic/claude-x'), 'anthropic');
  assert.equal(providerForModel('qwen/qwen3.8-flash'), 'generic');
});

test('openai strict: every property is required, optional ones become nullable, extras are forbidden at every depth', () => {
  const schema = z.object({
    a: z.string(),
    b: z.string().optional(),
    nested: z.object({ c: z.number(), d: z.array(z.string()).optional() }).strict().optional(),
    list: z.array(z.object({ e: z.string(), f: z.string().optional() }).strict()),
  }).strict();
  const compiled = compileProviderSchema(jsonSchema(schema), 'openai-strict');
  assert.equal(compiled.strict, true);
  for (const node of objectNodes(compiled.schema)) {
    const keys = Object.keys((node.properties ?? {}) as object).sort();
    assert.deepEqual([...((node.required ?? []) as string[])].sort(), keys, 'all properties required');
    assert.equal(node.additionalProperties, false);
  }
  const props = (compiled.schema as { properties: Record<string, Node> }).properties;
  assert.deepEqual(props.b, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.deepEqual([...compiled.optionalPaths].sort(), ['/b', '/list/*/f', '/nested', '/nested/d']);
});

test('openai strict: string-length keywords are dropped and reported; enum, pattern and array bounds are kept; oneOf becomes anyOf', () => {
  const schema = z.object({
    id: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
    kind: z.enum(['x', 'y']),
    tags: z.array(z.string()).min(1).max(3),
    u: z.union([z.object({ t: z.literal('a') }).strict(), z.object({ t: z.literal('b') }).strict()]),
  }).strict();
  const compiled = compileProviderSchema(jsonSchema(schema), 'openai-strict');
  const props = (compiled.schema as { properties: Record<string, Node> }).properties;
  assert.equal(props.id!.maxLength, undefined);
  assert.equal(props.id!.minLength, undefined);
  assert.equal(props.id!.pattern, '^[a-z0-9_]+$');
  assert.deepEqual(props.kind!.enum, ['x', 'y']);
  assert.equal(props.tags!.minItems, 1);
  assert.equal(props.tags!.maxItems, 3);
  assert.ok(props.u!.anyOf && !props.u!.oneOf);
  assert.deepEqual(compiled.droppedKeywords.map((d) => `${d.path}:${d.keyword}`).sort(), ['/id:maxLength', '/id:minLength']);
});

test('generic and anthropic providers are not rewritten by the openai compiler', () => {
  const schema = z.object({ a: z.string(), b: z.string().optional() }).strict();
  const base = jsonSchema(schema);
  const generic = compileProviderSchema(base, 'generic');
  assert.deepEqual(generic.schema, base);
  assert.equal(generic.strict, true);
  assert.deepEqual(generic.optionalPaths, []);
});

test('normalizeNullable removes null only where the original schema says the field is optional', () => {
  const schema = z.object({ a: z.string(), b: z.string().optional(), list: z.array(z.object({ f: z.string().optional(), g: z.string() }).strict()) }).strict();
  const compiled = compileProviderSchema(jsonSchema(schema), 'openai-strict');
  const input = { a: 'x', b: null, list: [{ f: null, g: 'y' }, { f: 'z', g: 'w' }] };
  const out = normalizeNullable(input, compiled.optionalPaths) as Record<string, unknown>;
  assert.deepEqual(out, { a: 'x', list: [{ g: 'y' }, { f: 'z', g: 'w' }] });
  assert.deepEqual(input, { a: 'x', b: null, list: [{ f: null, g: 'y' }, { f: 'z', g: 'w' }] }, 'input is not mutated');
  assert.equal(schema.safeParse(out).success, true);
  const required = normalizeNullable({ a: null, list: [] }, compiled.optionalPaths) as Record<string, unknown>;
  assert.equal(required.a, null, 'a required field stays null so validation rejects it');
  assert.equal(schema.safeParse(required).success, false);
});

test('the real stage schemas compile to strict form with every object fully required', () => {
  for (const [name, schema] of [['teaching-plan-draft', TeachingPlanDraftSchema], ['script', ScriptSchema], ['concept-graph', ConceptGraphSchema], ['scoped-concept-graph', ScopedConceptGraphSchema], ['syllabus', SyllabusOutputSchema], ['board', boardSchema({ mentionIds: ['m1', 'm2'], conceptIds: ['c1', 'c2'] })], ['beat-plan', BeatPlanDraftSchema], ['json-patch', JsonPatchResponseSchema]] as const) {
    const compiled = compileProviderSchema(jsonSchema(schema as unknown as z.ZodType), 'openai-strict');
    let count = 0;
    for (const node of objectNodes(compiled.schema)) {
      count++;
      const keys = Object.keys((node.properties ?? {}) as object).sort();
      assert.deepEqual([...((node.required ?? []) as string[])].sort(), keys, `${name}: required`);
      assert.equal(node.additionalProperties, false, `${name}: additionalProperties`);
    }
    assert.ok(count > 1, name);
  }
});

test('boolean sub-schemas and unknown keywords pass through the strict compile unchanged', () => {
  const compiled = compileProviderSchema({ type: 'object', properties: { a: { type: 'array', items: false as unknown as Record<string, unknown> }, b: { type: 'string' } }, required: ['a', 'b'] }, 'openai-strict');
  const props = (compiled.schema as { properties: Record<string, Node> }).properties;
  assert.equal((props.a as { items: unknown }).items, false);
  assert.equal(compiled.schema.additionalProperties, false);
});

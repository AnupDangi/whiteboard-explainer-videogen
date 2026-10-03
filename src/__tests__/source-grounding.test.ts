import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { validateBoardOps } from '../visual-v2/board-ops/validate.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { formulaProblem, sourceFormulaProblem, type Grounding } from '../visual-v2/provenance/ground.js';

const spans: Record<string, string> = { s1: 'The attention weights are softmax(QK^T / sqrt(d_k)) V with d_k = 64.', s2: 'Unrelated prose about training data.' };
const grounding: Grounding = { verify: (spanId, quote) => (spans[spanId]?.includes(quote) ? quote : undefined) };
const equation = (latex: string, evidence?: { spanId: string; quote: string }) => BoardOpSchema.parse({ op: 'add', opId: 'o1', beatId: 'b1', id: 'eq', at: { region: 'center' }, element: { type: 'equation', latex, provenance: 'source', ...(evidence ? { evidence } : {}) } });

test('a source equation must cite a quote that exists, and the formula must agree with it', () => {
  const good = { spanId: 's1', quote: 'softmax(QK^T / sqrt(d_k)) V with d_k = 64' };
  assert.deepEqual(validateBoardOps([equation('\\mathrm{softmax}(QK^T/\\sqrt{d_k})V', good)], emptyBoardState(), grounding), []);
  const missing = validateBoardOps([equation('x=1')], emptyBoardState(), grounding) as Array<{ path: string; message: string }>;
  assert.match(missing[0]!.message, /needs evidence/);
  const wrongSpan = validateBoardOps([equation('x=1', { spanId: 's2', quote: 'softmax(QK^T / sqrt(d_k)) V' })], emptyBoardState(), grounding) as Array<{ path: string; message: string }>;
  assert.match(wrongSpan[0]!.message, /does not contain that quote/);
  const noSource = validateBoardOps([equation('x=1', good)], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.match(noSource[0]!.message, /no source is available/);
});

test('an equation that names numbers or words absent from its own citation is rejected', () => {
  const quote = 'softmax(QK^T / sqrt(d_k)) V with d_k = 64';
  assert.equal(formulaProblem('d_k=64', quote), undefined);
  assert.match(formulaProblem('d_k=128', quote) ?? '', /number 128/);
  assert.match(formulaProblem('\\mathrm{relu}(x)', quote) ?? '', /"relu"/);
  assert.match(sourceFormulaProblem('d_k=128', { spanId: 's1', quote }, grounding) ?? '', /does not match its evidence/);
});

test('a derivation line of a source equation needs its own grounded citation', () => {
  const good = { spanId: 's1', quote: 'd_k = 64' };
  const ops = [equation('d_k=64', good), BoardOpSchema.parse({ op: 'equationStep', opId: 'o2', beatId: 'b2', target: 'eq', latex: 'd_k=128', rule: 'invented' })];
  const problems = validateBoardOps(ops, emptyBoardState(), grounding) as Array<{ path: string; message: string }>;
  assert.equal(problems[0]!.path, '/ops/1/evidence');
  const cited = BoardOpSchema.parse({ op: 'equationStep', opId: 'o2', beatId: 'b2', target: 'eq', latex: 'd_k=64', rule: 'restate', evidence: good });
  assert.deepEqual(validateBoardOps([ops[0]!, cited], emptyBoardState(), grounding), []);
});

test('source values and tokens require anchored citations for their displayed content', () => {
  const evidence = { spanId: 'v', quote: 'Pressure is ٦٤ kPa and oxygen enters the chamber.' };
  const spans = { v: evidence.quote };
  const verifier: Grounding = { verify: (spanId, quote) => spans[spanId as 'v']?.includes(quote) ? quote : undefined };
  const value = (n: string, citation?: typeof evidence) => BoardOpSchema.parse({ op: 'add', opId: 'v', beatId: 'b1', id: 'pressure', at: { region: 'left' }, element: { type: 'value', label: 'Pressure', value: n, unit: 'kPa', provenance: 'source', ...(citation ? { evidence: citation } : {}) } });
  const token = (word: string, citation?: typeof evidence) => BoardOpSchema.parse({ op: 'add', opId: 't', beatId: 'b1', id: 'oxygen', at: { region: 'right' }, element: { type: 'token', text: word, provenance: 'source', ...(citation ? { evidence: citation } : {}) } });
  assert.deepEqual(validateBoardOps([value('64', evidence), token('oxygen', evidence)], emptyBoardState(), verifier), []);
  assert.deepEqual((validateBoardOps([value('65', evidence)], emptyBoardState(), verifier) as Array<{ path: string }>).map((p) => p.path), ['/ops/0/element/evidence']);
  assert.deepEqual((validateBoardOps([token('nitrogen', evidence)], emptyBoardState(), verifier) as Array<{ path: string }>).map((p) => p.path), ['/ops/0/element/evidence']);
  assert.deepEqual((validateBoardOps([value('64')], emptyBoardState(), verifier) as Array<{ path: string }>).map((p) => p.path), ['/ops/0/element/evidence']);
  assert.deepEqual((validateBoardOps([token('oxygen', evidence)], emptyBoardState()) as Array<{ path: string }>).map((p) => p.path), ['/ops/0/element/evidence']);
});

test('source kit parameters and their split or merge replacements are checked, not inferred from the kit label', () => {
  const source = 'A comparison has warm on one side and cold on the other.';
  const verifier: Grounding = { verify: (id, quote) => id === 'k' && source.includes(quote) ? quote : undefined };
  const evidence = { spanId: 'k', quote: source };
  const kit = (sides: string[], cite = evidence) => ({ type: 'kit', kit: 'comparison', label: 'comparison', paramsJson: JSON.stringify({ sides }), provenance: 'source', evidence: cite });
  const add = BoardOpSchema.parse({ op: 'add', opId: 'k', beatId: 'b1', id: 'panel', at: { region: 'center' }, element: kit(['warm', 'cold']) });
  assert.deepEqual(validateBoardOps([add], emptyBoardState(), verifier), []);
  const bad = BoardOpSchema.parse({ op: 'add', opId: 'k', beatId: 'b1', id: 'panel', at: { region: 'center' }, element: kit(['warm', 'hot']) });
  assert.deepEqual((validateBoardOps([bad], emptyBoardState(), verifier) as Array<{ path: string }>).map((p) => p.path), ['/ops/0/element/evidence']);
  const split = BoardOpSchema.parse({ op: 'split', opId: 's', beatId: 'b2', target: 'seed', into: [{ id: 'panel', element: kit(['warm', 'hot']), at: { region: 'left' } }, { id: 'other', element: { type: 'token', text: 'x', provenance: 'illustrative' }, at: { region: 'right' } }] });
  const seed = BoardOpSchema.parse({ op: 'add', opId: 'seed', beatId: 'b1', id: 'seed', at: { region: 'center' }, element: { type: 'token', text: 'seed', provenance: 'illustrative' } });
  assert.deepEqual((validateBoardOps([seed, split], emptyBoardState(), verifier) as Array<{ path: string }>).map((p) => p.path), ['/ops/1/into/0/element/evidence']);
});

test('factual edges need an anchored directed relationship; source value mutations need a new quote', () => {
  const source = { a: 'Hot air causes pressure.', b: 'Pressure becomes 8 kPa.' };
  const verifier: Grounding = { verify: (id, quote) => source[id as 'a' | 'b']?.includes(quote) ? quote : undefined };
  const seed = (id: string, text: string) => BoardOpSchema.parse({ op: 'add', opId: id, beatId: 'b1', id, at: { region: id === 'air' ? 'left' : 'right' }, element: { type: 'token', text, provenance: 'illustrative' } });
  const edge = (from: string, to: string, evidence?: { spanId: string; quote: string }) => BoardOpSchema.parse({ op: 'connect', opId: 'e', beatId: 'b2', id: 'e', from, to, relation: 'causes', bindings: { conceptIds: ['c'], claimIds: ['claim'] }, ...(evidence ? { evidence } : {}) });
  const nodes = [seed('air', 'Hot air'), seed('pressure', 'pressure')];
  assert.deepEqual(validateBoardOps([...nodes, edge('air', 'pressure', { spanId: 'a', quote: source.a })], emptyBoardState(), verifier), []);
  const missing = validateBoardOps([...nodes, edge('air', 'pressure')], emptyBoardState(), verifier) as Array<{ path: string }>;
  assert.equal(missing.at(-1)?.path, '/ops/2/evidence');
  const backwards = validateBoardOps([...nodes, edge('pressure', 'air', { spanId: 'a', quote: source.a })], emptyBoardState(), verifier) as Array<{ path: string; message: string }>;
  assert.equal(backwards.at(-1)?.path, '/ops/2/evidence');
  const sourceValue = BoardOpSchema.parse({ op: 'add', opId: 'v', beatId: 'b1', id: 'v', at: { region: 'center' }, element: { type: 'value', label: 'Pressure', value: 8, unit: 'kPa', provenance: 'source', evidence: { spanId: 'b', quote: source.b } } });
  const update = (value: number, evidence?: { spanId: string; quote: string }) => BoardOpSchema.parse({ op: 'updateValue', opId: 'u', beatId: 'b2', target: 'v', value, ...(evidence ? { evidence } : {}) });
  assert.deepEqual(validateBoardOps([sourceValue, update(8, { spanId: 'b', quote: source.b })], emptyBoardState(), verifier), []);
  assert.equal((validateBoardOps([sourceValue, update(9)], emptyBoardState(), verifier) as Array<{ path: string }>).at(-1)?.path, '/ops/1/evidence');
});

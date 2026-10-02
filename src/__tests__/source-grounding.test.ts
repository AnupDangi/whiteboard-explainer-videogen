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

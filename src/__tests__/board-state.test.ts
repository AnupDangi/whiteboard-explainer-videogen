import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardOpSchema, BoardOpsDraftSchema, type BoardOp } from '../visual-v2/board-ops/types.js';
import { derivePrePost, validateBoardOps } from '../visual-v2/board-ops/validate.js';
import { emptyBoardState, applyOp, applyOps, containerContents, startScene } from '../visual-v2/board-state/reducer.js';
import { hashBoardState } from '../visual-v2/board-state/hash.js';
import { BoardOpError } from '../visual-v2/board-state/types.js';

const token = (text: string) => ({ type: 'token', text, provenance: 'illustrative' } as const);
const add = (opId: string, beatId: string, id: string, element: unknown, at: unknown, extra: Record<string, unknown> = {}) => BoardOpSchema.parse({ op: 'add', opId, beatId, id, element, at, ...extra });
const stackKit = { type: 'kit', kit: 'stack', label: 'call stack', paramsJson: '{}', provenance: 'metaphorical' };
const push = (n: number, beat: string) => add(`${beat}.push${n}`, beat, `f${n}`, token(`f(${n})`), { region: 'center', container: 'stack1', slot: 'top' });
const pop = (id: string, beat: string) => BoardOpSchema.parse({ op: 'remove', opId: `${beat}.pop_${id}`, beatId: beat, target: id });

test('the op schema is strict and every op needs an id and a beat', () => {
  assert.equal(BoardOpSchema.safeParse({ op: 'remove', target: 'x' }).success, false);
  assert.equal(BoardOpSchema.safeParse({ op: 'wiggle', opId: 'o', beatId: 'b', target: 'x' }).success, false);
  assert.equal(BoardOpSchema.safeParse({ op: 'remove', opId: 'o', beatId: 'b', target: 'x', extra: 1 }).success, false);
  assert.equal(BoardOpsDraftSchema.safeParse({ ops: [] }).success, false);
  assert.ok(BoardOpSchema.parse({ op: 'highlight', opId: 'o', beatId: 'b', target: 'x' }));
});

test('every op carries derived preconditions and postconditions', () => {
  const a = add('o1', 'b1', 'f4', token('f(4)'), { region: 'center', container: 'stack1', slot: 'top' });
  assert.deepEqual(derivePrePost(a), { pre: [{ kind: 'absentEver', id: 'f4' }, { kind: 'container', id: 'stack1' }], post: [{ kind: 'exists', id: 'f4' }, { kind: 'inContainer', id: 'f4', container: 'stack1' }] });
  const r = pop('f4', 'b2');
  assert.deepEqual(derivePrePost(r), { pre: [{ kind: 'exists', id: 'f4' }], post: [{ kind: 'removed', id: 'f4' }] });
});

test('the recursion stack grows and shrinks with stable ids: [] [f4] [f4,f3] [f4,f3,f2] [f4,f3,f2,f1] back to []', () => {
  let state = emptyBoardState();
  const seen: string[][] = [containerContents(state, 'stack1')];
  const sequence: BoardOp[] = [
    add('b0.kit', 'b0', 'stack1', stackKit, { region: 'center' }),
    push(4, 'b1'), push(3, 'b2'), push(2, 'b3'), push(1, 'b4'),
    pop('f1', 'b5'), pop('f2', 'b6'), pop('f3', 'b7'), pop('f4', 'b8'),
  ];
  for (const op of sequence) {
    state = applyOp(state, op).state;
    seen.push(containerContents(state, 'stack1'));
  }
  assert.deepEqual(seen.map((s) => s.join(',')), ['', '', 'f4', 'f4,f3', 'f4,f3,f2', 'f4,f3,f2,f1', 'f4,f3,f2', 'f4,f3', 'f4', '']);
  assert.equal(state.elements.f4!.lifecycle.createdAtBeat, 'b1');
  assert.equal(state.elements.f4!.lifecycle.removedAtBeat, 'b8');
});

test('a removed id can never be reused, so identity is stable for the whole lesson', () => {
  let state = applyOps(emptyBoardState(), [add('o1', 'b1', 'stack1', stackKit, { region: 'center' }), push(1, 'b2'), pop('f1', 'b3')]).state;
  assert.throws(() => applyOp(state, push(1, 'b4')), (error: unknown) => error instanceof BoardOpError && /already used/.test(error.message));
  state = applyOps(state, []).state;
});

test('preconditions fail loudly: unknown target, non-container slot, missing endpoints', () => {
  const state = applyOps(emptyBoardState(), [add('o1', 'b1', 'stack1', stackKit, { region: 'center' }), push(1, 'b2')]).state;
  assert.throws(() => applyOp(state, pop('ghost', 'b3')), (e: unknown) => e instanceof BoardOpError && e.opId === 'b3.pop_ghost' && /does not exist/.test(e.message));
  assert.throws(() => applyOp(state, add('o9', 'b3', 'x', token('x'), { region: 'center', container: 'f1', slot: 'top' })), (e: unknown) => e instanceof BoardOpError && /not a container/.test(e.message));
  assert.throws(() => applyOp(state, BoardOpSchema.parse({ op: 'connect', opId: 'c1', beatId: 'b3', id: 'e1', from: 'f1', to: 'nowhere', relation: 'flows' })), (e: unknown) => e instanceof BoardOpError && /nowhere/.test(e.message));
});

test('move, highlight, strike, updateValue and transform change state without changing identity; effects describe each change', () => {
  let state = applyOps(emptyBoardState(), [
    add('o1', 'b1', 'k', stackKit, { region: 'left' }), add('o2', 'b1', 'q', { type: 'kit', kit: 'queue', label: 'queue', paramsJson: '{}', provenance: 'metaphorical' }, { region: 'right' }),
    add('o3', 'b1', 'n', { type: 'value', label: 'count', value: 1, provenance: 'illustrative' }, { region: 'center' }),
    add('o4', 'b1', 'x', token('x'), { region: 'left', container: 'k', slot: 'top' }),
  ]).state;
  const moved = applyOp(state, BoardOpSchema.parse({ op: 'move', opId: 'm1', beatId: 'b2', target: 'x', to: { region: 'right', container: 'q', slot: 'end' } }));
  assert.deepEqual(containerContents(moved.state, 'k'), []);
  assert.deepEqual(containerContents(moved.state, 'q'), ['x']);
  assert.deepEqual(moved.effects, [{ kind: 'move', opId: 'm1', targetId: 'x', from: { region: 'left', container: 'k', slot: 'top' }, to: { region: 'right', container: 'q', slot: 'end' } }]);
  state = moved.state;
  state = applyOp(state, BoardOpSchema.parse({ op: 'highlight', opId: 'h', beatId: 'b3', target: 'x' })).state;
  assert.equal(state.elements.x!.emphasis, 'highlight');
  state = applyOp(state, BoardOpSchema.parse({ op: 'strike', opId: 's', beatId: 'b3', target: 'x' })).state;
  assert.equal(state.elements.x!.emphasis, 'struck');
  state = applyOp(state, BoardOpSchema.parse({ op: 'updateValue', opId: 'u', beatId: 'b3', target: 'n', value: 2 })).state;
  assert.equal(state.elements.n!.value, 2);
  assert.throws(() => applyOp(state, BoardOpSchema.parse({ op: 'updateValue', opId: 'u2', beatId: 'b3', target: 'x', value: 2 })), (e: unknown) => e instanceof BoardOpError && /not a value/.test(e.message));
  state = applyOp(state, BoardOpSchema.parse({ op: 'transform', opId: 't', beatId: 'b3', target: 'q', changes: [{ key: 'state', value: 'full' }] })).state;
  assert.equal(state.elements.q!.props.state, 'full');
  assert.deepEqual(state.elements.x!.lifecycle.updatedAtBeat, ['b2', 'b3']);
});

test('split and merge keep every id unique and move children by their own ids', () => {
  const state = applyOps(emptyBoardState(), [add('o1', 'b1', 'whole', { type: 'entity', conceptId: 'water', label: 'water', provenance: 'source' }, { region: 'center' })]).state;
  const split = applyOp(state, BoardOpSchema.parse({ op: 'split', opId: 'sp', beatId: 'b2', target: 'whole', into: [
    { id: 'h2', element: { type: 'entity', conceptId: 'hydrogen', label: 'hydrogen', provenance: 'source' }, at: { region: 'left' } },
    { id: 'o', element: { type: 'entity', conceptId: 'oxygen', label: 'oxygen', provenance: 'source' }, at: { region: 'right' } },
  ] })).state;
  assert.equal(split.elements.whole!.lifecycle.removedAtBeat, 'b2');
  assert.ok(split.elements.h2 && split.elements.o);
  const merged = applyOp(split, BoardOpSchema.parse({ op: 'merge', opId: 'mg', beatId: 'b3', targets: ['h2', 'o'], into: { id: 'water2', element: { type: 'entity', conceptId: 'water', label: 'water', provenance: 'source' }, at: { region: 'center' } } })).state;
  assert.ok(merged.elements.h2!.lifecycle.removedAtBeat && merged.elements.o!.lifecycle.removedAtBeat);
  assert.equal(merged.elements.water2!.lifecycle.removedAtBeat, undefined);
});

test('equation steps keep the same equation element and record each step in order', () => {
  let state = applyOps(emptyBoardState(), [add('o1', 'b1', 'eq', { type: 'equation', latex: '2x+6=14', provenance: 'illustrative' }, { region: 'center' })]).state;
  state = applyOp(state, BoardOpSchema.parse({ op: 'equationStep', opId: 'e1', beatId: 'b2', target: 'eq', latex: '2x=8', rule: 'subtract 6 from both sides' })).state;
  state = applyOp(state, BoardOpSchema.parse({ op: 'equationStep', opId: 'e2', beatId: 'b3', target: 'eq', latex: 'x=4', rule: 'divide both sides by 2' })).state;
  const eq = state.elements.eq!;
  assert.equal(eq.value, 'x=4');
  assert.deepEqual(eq.steps, [{ latex: '2x+6=14', rule: 'given', beatId: 'b1' }, { latex: '2x=8', rule: 'subtract 6 from both sides', beatId: 'b2' }, { latex: 'x=4', rule: 'divide both sides by 2', beatId: 'b3' }]);
});

test('scene transitions retain, partially retain or clear the board without recreating elements', () => {
  const base = applyOps(emptyBoardState(), [
    add('o1', 'b1', 'k', stackKit, { region: 'left' }), add('o2', 'b1', 'n', { type: 'value', label: 'count', value: 1, provenance: 'illustrative' }, { region: 'right' }),
  ]).state;
  const keepAll = startScene(base, { mode: 'retain-all' }, 's2');
  assert.deepEqual(Object.keys(keepAll.elements).sort(), ['k', 'n']);
  const keepLeft = startScene(base, { mode: 'retain-regions', regions: ['left'] }, 's2');
  assert.equal(keepLeft.elements.k!.lifecycle.removedAtBeat, undefined);
  assert.equal(keepLeft.elements.n!.lifecycle.removedAtBeat, 's2:scene-start');
  const clean = startScene(base, { mode: 'clean' }, 's2');
  assert.ok(clean.elements.k!.lifecycle.removedAtBeat && clean.elements.n!.lifecycle.removedAtBeat);
});

test('lesson-persistent elements survive a clean scene transition', () => {
  const base = applyOps(emptyBoardState(), [
    add('o1', 'b1', 'k', stackKit, { region: 'left' }, { persistence: 'lesson' }), add('o2', 'b1', 'n', { type: 'value', label: 'count', value: 1, provenance: 'illustrative' }, { region: 'right' }),
  ]).state;
  const clean = startScene(base, { mode: 'clean' }, 's2');
  assert.equal(clean.elements.k!.lifecycle.removedAtBeat, undefined);
  assert.ok(clean.elements.n!.lifecycle.removedAtBeat);
});

test('the board hash ignores beat bookkeeping, changes with anything visible, and is order independent', () => {
  const a = applyOps(emptyBoardState(), [add('o1', 'b1', 'stack1', stackKit, { region: 'center' }), push(1, 'b2')]).state;
  const b = applyOps(emptyBoardState(), [add('o1', 'bx', 'stack1', stackKit, { region: 'center' }), push(1, 'by')]).state;
  assert.equal(hashBoardState(a), hashBoardState(b));
  const c = applyOp(a, BoardOpSchema.parse({ op: 'highlight', opId: 'h', beatId: 'b3', target: 'f1' })).state;
  assert.notEqual(hashBoardState(a), hashBoardState(c));
  assert.match(hashBoardState(a), /^[0-9a-f]{64}$/);
});

test('validateBoardOps simulates the ops and reports pointer problems for failed preconditions and expectations', () => {
  const ops = [
    add('o1', 'b1', 'stack1', stackKit, { region: 'center' }),
    push(4, 'b2'),
    BoardOpSchema.parse({ op: 'remove', opId: 'o3', beatId: 'b3', target: 'f9' }),
    BoardOpSchema.parse({ op: 'highlight', opId: 'o4', beatId: 'b3', target: 'f4', expects: [{ kind: 'contents', container: 'stack1', ids: ['f4', 'f3'] }] }),
  ];
  const problems = validateBoardOps(ops, emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.deepEqual(problems.map((p) => p.path), ['/ops/2', '/ops/3/expects/0']);
  assert.match(problems[0]!.message, /f9 does not exist/);
  assert.match(problems[1]!.message, /stack1 holds f4/);
  assert.deepEqual(validateBoardOps(ops.slice(0, 2), emptyBoardState()), []);
});

test('placement may name a zone inside a container, ops may carry a sentence cue, links may carry a weight, and elements keep a creation sequence', () => {
  const kit = { type: 'kit', kit: 'compartment', label: 'cell', paramsJson: '{"zones":["outside","inside"]}', provenance: 'metaphorical' };
  let state = applyOps(emptyBoardState(), [
    add('o1', 'b1', 'cell', kit, { region: 'center' }),
    add('o2', 'b1', 'p1', token('o'), { region: 'center', container: 'cell', zone: 'outside' }, { cue: 1 }),
    add('o3', 'b1', 'p2', token('o'), { region: 'center', container: 'cell', zone: 'outside' }),
  ]).state;
  assert.equal(state.elements.p1!.placement.zone, 'outside');
  assert.equal(state.elements.p1!.seq < state.elements.p2!.seq, true);
  const moved = applyOp(state, BoardOpSchema.parse({ op: 'move', opId: 'm', beatId: 'b2', target: 'p1', to: { region: 'center', container: 'cell', zone: 'inside' }, cue: 0 }));
  assert.equal(moved.state.elements.p1!.placement.zone, 'inside');
  assert.equal(BoardOpSchema.parse({ op: 'highlight', opId: 'h', beatId: 'b2', target: 'p1', cue: 2 }).cue, 2);
  const linked = applyOp(moved.state, BoardOpSchema.parse({ op: 'connect', opId: 'c', beatId: 'b3', id: 'e1', from: 'p1', to: 'p2', relation: 'feeds', weight: 0.7 })).state;
  assert.equal(linked.edges.e1!.weight, 0.7);
  assert.notEqual(hashBoardState(state), hashBoardState(moved.state), 'a zone change is a visible change');
  state = moved.state;
});

test('validateBoardOps checks kit parameters and zones against the kit registry', () => {
  const badKit = add('o1', 'b1', 'k1', { type: 'kit', kit: 'stack', paramsJson: '{"capacity":1}', provenance: 'metaphorical' }, { region: 'center' });
  assert.match(((validateBoardOps([badKit], emptyBoardState())[0]) as { message: string }).message, /stack params: capacity/);
  assert.equal(((validateBoardOps([badKit], emptyBoardState())[0]) as { path: string }).path, '/ops/0/element/paramsJson');
  const cell = add('o1', 'b1', 'cell', { type: 'kit', kit: 'compartment', paramsJson: '{"zones":["outside","inside"]}', provenance: 'metaphorical' }, { region: 'center' });
  const noZone = add('o2', 'b1', 'p1', token('o'), { region: 'center', container: 'cell' });
  const wrongZone = add('o3', 'b1', 'p2', token('o'), { region: 'center', container: 'cell', zone: 'sideways' });
  const ok = add('o4', 'b1', 'p3', token('o'), { region: 'center', container: 'cell', zone: 'inside' });
  const problems = validateBoardOps([cell, noZone, wrongZone, ok], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.deepEqual(problems.map((p) => p.path), ['/ops/1/at/zone', '/ops/2/at/zone']);
  assert.match(problems[0]!.message, /needs a zone: outside, inside/);
  assert.match(problems[1]!.message, /sideways is not a zone of cell/);
  const stack = add('o5', 'b1', 'stk', { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' }, { region: 'left' });
  const zoned = add('o6', 'b1', 'x', token('x'), { region: 'left', container: 'stk', zone: 'a' });
  assert.match(((validateBoardOps([stack, zoned], emptyBoardState())[0]) as { message: string }).message, /has no zones/);
});

test('ids are never reused across elements and edges, and split parts need distinct ids', () => {
  const el = (id: string) => add(`o.${id}`, 'b1', id, token(id), { region: 'center' });
  let state = applyOp(applyOp(emptyBoardState(), el('a')).state, el('b')).state;
  const connect = (opId: string, id: string) => BoardOpSchema.parse({ op: 'connect', opId, beatId: 'b2', id, from: 'a', to: 'b', relation: 'causes' });
  state = applyOp(state, connect('c1', 'link')).state;
  assert.throws(() => applyOp(state, connect('c2', 'link')), /already used/);
  assert.throws(() => applyOp(state, el('link')), /already used/);
  const split = BoardOpSchema.parse({ op: 'split', opId: 'sp', beatId: 'b3', target: 'a', into: [{ id: 'p', element: token('p1'), at: { region: 'center' } }, { id: 'p', element: token('p2'), at: { region: 'center' } }] });
  assert.throws(() => applyOp(state, split), /distinct ids; p is repeated/);
  assert.ok(validateBoardOps([split], state).some((problem) => typeof problem !== 'string' && problem.path === '/ops/0/into'));
});

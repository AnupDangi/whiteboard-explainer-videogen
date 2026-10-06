import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneBoardDraftSchema, type SceneBoardDraft } from '../visual-v2/ops-plan/types.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { salvageSceneBoard } from '../visual-v2/ops-plan/salvage.js';
import { planSceneBoard } from '../visual-v2/ops-plan/plan.js';
import { applyOpAfter, emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import type { ModelClient } from '../llm/modelClient.js';
import { semanticEntityId, type TeachingBeat } from '../teaching/beat-plan/types.js';

const SPANS: Record<string, string> = {
  s1: 'Each call pushes a frame onto the stack.',
  s2: 'A return pops the top frame from the stack.',
};
const beat = (n: number, over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: `sc.b${n}`, sceneId: 'sc', order: n, claimIds: ['c1'], learnerDelta: 'delta', learningQuestion: 'What changes?', learnerBefore: 'The learner has not traced this step.', learnerAfter: 'The learner can trace this step.', dependsOnOrders: [], dependsOnBeatIds: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ identityKey: 'frame_main', entityId: semanticEntityId('frame_main', 'sc'), conceptId: 'frame' }], semanticRevealOrder: [semanticEntityId('frame_main', 'sc')],
  requiredSemanticChanges: [{ identityKey: 'frame_main', entityId: semanticEntityId('frame_main', 'sc'), kind: 'introduce', toState: 'A frame is on the pile.' }], persistentEntityIds: [semanticEntityId('frame_main', 'sc')],
  relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'a frame is on the pile', mutedMeaning: 'a pile grows',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', evidenceSpanIds: ['s1'], ...over,
});
const ctx: BoardContext = {
  sceneId: 'sc', title: 'Stack scene',
  beats: [beat(1), beat(2, { entities: [{ identityKey: 'stack_main', entityId: semanticEntityId('stack_main', 'sc'), conceptId: 'stack' }], semanticRevealOrder: [semanticEntityId('stack_main', 'sc')], requiredSemanticChanges: [{ identityKey: 'stack_main', entityId: semanticEntityId('stack_main', 'sc'), kind: 'introduce', toState: 'The stack is shown.' }], persistentEntityIds: [semanticEntityId('stack_main', 'sc')], claimIds: ['c2'] })],
  narration: [
    { beatId: 'sc.b1', sentences: ['Each call pushes a frame.', 'The frame holds the call.'] },
    { beatId: 'sc.b2', sentences: ['A return pops the top frame.'] },
  ],
  concepts: [
    { id: 'frame', label: 'Frame', evidence: [{ spanId: 's1', quote: SPANS.s1! }, { spanId: 's2', quote: SPANS.s2! }] },
    { id: 'stack', label: 'Stack', evidence: [{ spanId: 's2', quote: SPANS.s2! }] },
  ],
  initial: emptyBoardState(),
  grounding: { verify: (spanId, quote) => (SPANS[spanId]?.includes(quote) ? quote : undefined) },
};
const bindings = { conceptIds: ['frame', 'stack'], claimIds: ['c1'] };
const pile = { type: 'kit', kit: 'stack', label: 'stack', paramsJson: '{}', provenance: 'metaphorical', bindings };
const frame = (over: Record<string, unknown> = {}) => ({ type: 'entity', conceptId: 'frame', label: 'frame', provenance: 'source', evidence: { spanId: 's1', quote: SPANS.s1 }, bindings, ...over });
const ops = (extra: Array<Record<string, unknown>> = [], frameOver: Record<string, unknown> = {}): SceneBoardDraft => SceneBoardDraftSchema.parse({
  transition: { mode: 'clean' },
  ops: [
    { op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'pile', element: pile, at: { region: 'right' }, cue: 0 },
    { op: 'add', opId: 'o2', beatId: 'sc.b1', id: 'f1', element: frame(frameOver), at: { region: 'left' }, cue: 0 },
    ...extra,
    { op: 'remove', opId: 'o9', beatId: 'sc.b2', target: 'f1', cue: 0 },
  ],
});
const connect = (relation: string, spanId: string): Record<string, unknown> => ({
  op: 'connect', opId: 'o3', beatId: 'sc.b1', id: 'e1', from: 'f1', to: 'pile', relation, evidence: { spanId, quote: SPANS[spanId] }, bindings, cue: 1,
});

test('the fixture is valid before any defect is introduced', () => {
  assert.deepEqual(validateSceneBoard(ops([connect('onto', 's1')]), ctx), []);
});

test('a long semantic label remains unchanged for repair; salvage never removes a polarity qualifier', () => {
  const quote = 'Not safe during early pregnancy';
  const grounded = { ...ctx, concepts: [{ ...ctx.concepts[0]!, evidence: [{ spanId: 's3', quote }] }, ctx.concepts[1]!], grounding: { verify: (spanId: string, text: string) => spanId === 's3' && text === quote ? quote : undefined } } as BoardContext;
  const long = ops([], { label: quote, evidence: { spanId: 's3', quote } });
  assert.ok(validateSceneBoard(long, ctx).length > 0);
  assert.ok(validateSceneBoard(long, grounded).some((problem) => typeof problem !== 'string' && /at most 4 words/.test(problem.message)));
  assert.equal(salvageSceneBoard(long, grounded), undefined, 'an invalid label is left for scoped repair');
  assert.equal((long.ops[1] as { element: { label: string } }).element.label, quote, 'even a failed salvage attempt does not rewrite the candidate');
});

test('a source edge whose quote does not state it is re-cited from another quote that does', () => {
  const miscited = ops([connect('onto', 's2')]);
  assert.ok(validateSceneBoard(miscited, ctx).length > 0);
  const fixed = salvageSceneBoard(miscited, ctx);
  assert.ok(fixed);
  const edge = fixed.value.ops.find((o) => o.op === 'connect') as { evidence?: { spanId: string } };
  assert.equal(edge.evidence?.spanId, 's1');
  assert.deepEqual(validateSceneBoard(fixed.value, ctx), []);
});

test('a source edge that no quote supports is dropped, never kept as an unsupported fact', () => {
  const invented = ops([connect('creates', 's1')]);
  const fixed = salvageSceneBoard(invented, ctx);
  assert.ok(fixed);
  assert.equal(fixed.value.ops.some((o) => o.op === 'connect'), false);
  assert.deepEqual(validateSceneBoard(fixed.value, ctx), []);
  assert.ok(fixed.entries.some((entry) => entry.path === '/ops/2' && /dropped/.test(entry.reason)));
});

test('a source label the quotes do not support remains for repair or failure', () => {
  const unsupported = ops([], { label: 'call record', evidence: { spanId: 's1', quote: SPANS.s1 } });
  assert.ok(validateSceneBoard(unsupported, ctx).length > 0);
  assert.equal(salvageSceneBoard(unsupported, ctx), undefined, 'salvage cannot erase the failed source grounding by changing provenance');
  assert.equal((unsupported.ops[1] as { element: { provenance: string } }).element.provenance, 'source');
});

test('claim-bound illustrative wording cannot reverse a source polarity cue', () => {
  const context: BoardContext = { ...ctx, claims: [{ id: 'c1', statement: 'Not safe during pregnancy.' }] };
  const reversed = ops([], { label: 'Safe during pregnancy', provenance: 'illustrative', evidence: undefined });
  const problems = validateSceneBoard(reversed, context);
  assert.ok(problems.some((problem) => typeof problem !== 'string' && /visual text bound to claim c1 contradicts its canonical wording/.test(problem.message)));
  assert.equal(salvageSceneBoard(reversed, context), undefined);
});

test('missing or unknown bindings are rebuilt from the element concept and its beat claims', () => {
  const unbound = ops([], { bindings: { conceptIds: [], claimIds: ['made_up'] } });
  assert.ok(validateSceneBoard(unbound, ctx).length > 0);
  const fixed = salvageSceneBoard(unbound, ctx);
  assert.ok(fixed);
  const element = (fixed.value.ops[1] as { element: { bindings: { conceptIds: string[]; claimIds: string[] } } }).element;
  assert.deepEqual(element.bindings, { conceptIds: ['frame'], claimIds: ['c1'] });
  assert.deepEqual(validateSceneBoard(fixed.value, ctx), []);
});

test('salvage never fixes what it cannot prove: a board still invalid afterwards is left to repair', () => {
  const draft = ops([{ op: 'remove', opId: 'o4', beatId: 'sc.b1', target: 'ghost' }]);
  assert.equal(salvageSceneBoard(draft, ctx), undefined);
});

test('a valid board is returned unchanged: there is nothing to salvage', () => {
  assert.equal(salvageSceneBoard(ops([connect('onto', 's1')]), ctx), undefined);
});

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
const scripted = (replies: string[]): { client: ModelClient; calls: () => number } => {
  let n = 0;
  return { calls: () => n, client: { provider: 'fake', chat: async () => { n += 1; return { content: replies[n - 1] ?? '{}', finishReason: 'stop', temperatureApplied: true, usage } as never; } } as ModelClient };
};

test('planSceneBoard salvages a mechanical defect without a repair call and still reports first-try invalid', async () => {
  const { client, calls } = scripted([JSON.stringify(ops([connect('creates', 's1')]))]);
  const result = await planSceneBoard({ ctx }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(calls(), 1, 'no repair call was spent');
  assert.ok(result.value);
  assert.equal(result.value.ops.some((o) => o.op === 'connect'), false);
  assert.equal(result.reports[0]!.firstTryValid, false, 'salvage is not a first-try pass');
  assert.equal(result.reports[0]!.succeeded, true);
  assert.equal(result.reports[0]!.silentSemanticCoercions, 0, 'every salvage change is in the coercion ledger');
  assert.ok(result.trace.coercions.some((entry) => entry.semanticRisk === 'semantic'));
  assert.ok(result.failures.some((failure) => failure.code === 'board-ops-salvaged' && failure.hard === false));
});

test('a token over 24 characters is rejected unchanged instead of semantically truncated', () => {
  const raw = JSON.parse(JSON.stringify(ops())) as { ops: Array<{ element?: Record<string, unknown> }> };
  raw.ops[1]!.element = { type: 'token', text: 'molecules moving across the membrane', provenance: 'illustrative', bindings };
  assert.equal(SceneBoardDraftSchema.safeParse(raw).success, false);
  assert.equal((raw.ops[1]!.element as { text: string }).text, 'molecules moving across the membrane');
});

test('a label that does not fit its slot remains unchanged for repair', () => {
  const crowded = ops([], { label: 'call pushes frame', evidence: { spanId: 's1', quote: SPANS.s1 } });
  const fits = (states: Array<{ elements: Record<string, { spec: { type: string; label?: string } }> }>) => {
    const label = states[states.length - 1]!.elements.f1?.spec.label ?? '';
    return label.split(' ').length > 2 ? [{ code: 'text_overflow' as const, stateIndex: 2, message: 'does not fit', elementIds: ['f1'], fields: [] }] : [];
  };
  const withLayout = { ...ctx, geometryCheck: fits as unknown as BoardContext['geometryCheck'] };
  assert.ok(validateSceneBoard(crowded, withLayout).length > 0, 'the fixture really overflows');
  assert.equal(salvageSceneBoard(crowded, withLayout), undefined);
  assert.equal((crowded.ops[1] as { element: { label: string } }).element.label, 'call pushes frame');
});

test('a one-word label that still collides is left for repair, never emptied', () => {
  const stubborn = { ...ctx, geometryCheck: (() => [{ code: 'text_overflow', stateIndex: 2, message: 'no room', elementIds: ['f1'], fields: [] }]) as unknown as BoardContext['geometryCheck'] };
  assert.equal(salvageSceneBoard(ops(), stubborn), undefined);
});

test('an equation nothing can verify or cite is dropped with its dependents; a cited one is re-cited', () => {
  const unproven = ops([
    { op: 'add', opId: 'q1', beatId: 'sc.b1', id: 'eq', element: { type: 'equation', latex: 'x^{2}+y=z', provenance: 'derived', bindings }, at: { region: 'bottom' }, cue: 1 },
    { op: 'highlight', opId: 'q2', beatId: 'sc.b1', target: 'eq', cue: 1 },
  ]);
  assert.ok(validateSceneBoard(unproven, ctx).length > 0);
  const fixed = salvageSceneBoard(unproven, ctx);
  assert.ok(fixed);
  assert.equal(fixed.value.ops.some((o) => o.opId === 'q1' || o.opId === 'q2'), false);
  assert.deepEqual(validateSceneBoard(fixed.value, ctx), []);
});

test('a crowded scene that never touches the inherited board starts clean; one that uses it keeps it', () => {
  const inheritedState = applyOpAfter(startScene(emptyBoardState(), { mode: 'clean' }, 'earlier'), { op: 'add', opId: 'x1', beatId: 'earlier.b1', id: 'old', element: { type: 'token', text: 'old', provenance: 'illustrative', bindings }, at: { region: 'left' } } as never, undefined, ['earlier.b1']).state;
  const crowded = { ...ctx, initial: inheritedState, geometryCheck: ((states: Array<{ elements: Record<string, { lifecycle: { removedAtBeat?: string } }> }>) => (states[0]!.elements.old && states[0]!.elements.old.lifecycle.removedAtBeat === undefined ? [{ code: 'top_level_overlap' as const, stateIndex: 0, message: 'no room', elementIds: ['old'], fields: [] }] : [])) as unknown as BoardContext['geometryCheck'] };
  const own = SceneBoardDraftSchema.parse({ transition: { mode: 'retain-all' }, ops: ops().ops });
  const fixed = salvageSceneBoard(own, crowded);
  assert.ok(fixed);
  assert.equal(fixed.value.transition.mode, 'clean');
  const uses = SceneBoardDraftSchema.parse({ transition: { mode: 'retain-all' }, ops: [...ops().ops, { op: 'highlight', opId: 'h1', beatId: 'sc.b2', target: 'old' }] });
  assert.equal(salvageSceneBoard(uses, crowded), undefined);
});

test('an unverified equation is re-cited from the sentence of its span that states the formula', () => {
  const spans: Record<string, string> = { s1: 'Each call pushes a frame onto the stack. The depth is D = F + 1.' };
  const withSpan = { ...ctx, grounding: { verify: (spanId: string, quote: string) => (spans[spanId]?.includes(quote) ? quote : undefined), spanText: (spanId: string) => spans[spanId] }, concepts: [{ id: 'frame', label: 'Frame', evidence: [{ spanId: 's1', quote: 'Each call pushes a frame onto the stack.' }] }, ctx.concepts[1]!] } as BoardContext;
  const draft = ops([
    { op: 'add', opId: 'q1', beatId: 'sc.b1', id: 'eq', element: { type: 'equation', latex: 'D=F+1', provenance: 'derived', bindings }, at: { region: 'bottom' }, cue: 1 },
  ]);
  const problems = validateSceneBoard(draft, withSpan);
  assert.ok(problems.length > 0);
  const fixed = salvageSceneBoard(draft, withSpan);
  assert.ok(fixed);
  const eq = fixed.value.ops.find((o) => o.op === 'add' && o.id === 'eq') as { element: { provenance: string; evidence?: { quote: string } } };
  assert.equal(eq.element.provenance, 'source');
  assert.equal(eq.element.evidence?.quote, 'The depth is D = F + 1.');
});

test('starting clean re-shows a concept only the dropped board was showing, with an illustrative entity, never with a fabricated source claim', () => {
  const stackBinding = { conceptIds: ['stack'], claimIds: ['c2'] };
  const inheritedState = applyOpAfter(startScene(emptyBoardState(), { mode: 'clean' }, 'earlier'), { op: 'add', opId: 'x1', beatId: 'earlier.b1', id: 'old', element: { type: 'token', text: 'old', provenance: 'illustrative', bindings: stackBinding }, at: { region: 'left' } } as never, undefined, ['earlier.b1']).state;
  const crowded = { ...ctx, initial: inheritedState, geometryCheck: ((states: Array<{ elements: Record<string, { lifecycle: { removedAtBeat?: string } }> }>) => (states[0]!.elements.old && states[0]!.elements.old.lifecycle.removedAtBeat === undefined ? [{ code: 'top_level_overlap' as const, stateIndex: 0, message: 'no room', elementIds: ['old'], fields: [] }] : [])) as unknown as BoardContext['geometryCheck'] };
  const own = ops([], { bindings: { conceptIds: ['frame'], claimIds: ['c1'] } });
  const retained = SceneBoardDraftSchema.parse({ transition: { mode: 'retain-all' }, ops: own.ops.filter((o) => o.op !== 'add' || o.id !== 'pile') .map((o) => (o.op === 'remove' ? { ...o, beatId: 'sc.b2' } : o)) });
  const problems = validateSceneBoard(retained, crowded);
  assert.ok(problems.length > 0);
  const fixed = salvageSceneBoard(retained, crowded);
  assert.ok(fixed, JSON.stringify(validateSceneBoard(retained, crowded)));
  assert.equal(fixed.value.transition.mode, 'clean');
  const cover = fixed.value.ops.find((o) => o.op === 'add' && o.id.startsWith('cover_')) as { element: { provenance: string; conceptId: string; evidence?: unknown } } | undefined;
  assert.ok(cover);
  assert.equal(cover.element.provenance, 'illustrative');
  assert.equal(cover.element.conceptId, 'stack');
  assert.equal(cover.element.evidence, undefined);
  assert.deepEqual(validateSceneBoard(fixed.value, crowded), []);
});

test('a label is never cut down to a meaningless fragment: a short one-word result stops the shortening', () => {
  const two = ops([], { label: 'frame pops', evidence: { spanId: 's1', quote: SPANS.s1 } });
  const alwaysTight = { ...ctx, geometryCheck: (() => [{ code: 'text_overflow', stateIndex: 2, message: 'tight', elementIds: ['f1'], fields: [] }]) as unknown as BoardContext['geometryCheck'] };
  assert.equal(salvageSceneBoard(two, alwaysTight), undefined, 'cutting "frame pops" to "frame" or "pops" would leave a fragment, so it is left to repair');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneBoardDraftSchema, type SceneBoardDraft } from '../visual-v2/ops-plan/types.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { buildBoardPrompt } from '../visual-v2/ops-plan/prompt.js';
import { planSceneBoard } from '../visual-v2/ops-plan/plan.js';
import { salvageSceneBoard } from '../visual-v2/ops-plan/salvage.js';
import { fallbackSceneBoard } from '../visual-v2/ops-plan/fallback.js';
import { KIT_CATALOGUE } from '../visual-v2/kits/catalogue.js';
import { KIT_NAMES } from '../visual-v2/board-ops/types.js';
import { parseKitParams } from '../visual-v2/kits/registry.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { ModelClient } from '../llm/modelClient.js';
import { semanticEntityId, type TeachingBeat } from '../teaching/beat-plan/types.js';
import type { GeometryDiagnostic } from '../visual-v2/layout/sceneLayout.js';

const beat = (n: number, over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: `sc.b${n}`, sceneId: 'sc', order: n, claimIds: ['c1'], learnerDelta: 'delta', learningQuestion: 'What changes?', learnerBefore: 'The learner has not traced this step.', learnerAfter: 'The learner can trace this step.', dependsOnOrders: [], dependsOnBeatIds: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ identityKey: 'frame_main', entityId: semanticEntityId('frame_main', 'sc'), conceptId: 'frame' }], semanticRevealOrder: [semanticEntityId('frame_main', 'sc')],
  requiredSemanticChanges: [{ identityKey: 'frame_main', entityId: semanticEntityId('frame_main', 'sc'), kind: 'introduce', toState: 'A frame is on the pile.' }], persistentEntityIds: [semanticEntityId('frame_main', 'sc')],
  relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'a frame is on the pile', mutedMeaning: 'a pile grows',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', evidenceSpanIds: ['s1'], ...over,
});
const ctx: BoardContext = {
  sceneId: 'sc', title: 'Stack scene',
  beats: [beat(1), beat(2, { entities: [{ identityKey: 'stack_main', entityId: semanticEntityId('stack_main', 'sc'), conceptId: 'stack' }], semanticRevealOrder: [semanticEntityId('stack_main', 'sc')], requiredSemanticChanges: [{ identityKey: 'stack_main', entityId: semanticEntityId('stack_main', 'sc'), kind: 'introduce', toState: 'The stack is shown.' }], persistentEntityIds: [semanticEntityId('stack_main', 'sc')] })],
  narration: [
    { beatId: 'sc.b1', sentences: ['Each call pushes a frame.', 'The frame holds the call.'] },
    { beatId: 'sc.b2', sentences: ['A return pops the top frame.'] },
  ],
  concepts: [{ id: 'frame', label: 'Frame', kind: 'entity' }, { id: 'stack', label: 'Stack', kind: 'entity' }],
  initial: emptyBoardState(),
};
const bindings = { conceptIds: ['frame', 'stack'], claimIds: ['c1'] };
const kit = { type: 'kit', kit: 'stack', label: 'stack', paramsJson: '{}', provenance: 'metaphorical', bindings };
const op = (o: Record<string, unknown>) => o;
const good = (): unknown => ({
  transition: { mode: 'clean' },
  ops: [
    op({ op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'pile', element: kit, at: { region: 'center' }, cue: 0 }),
    op({ op: 'add', opId: 'o2', beatId: 'sc.b1', id: 'f1', element: { type: 'entity', conceptId: 'frame', label: 'frame', provenance: 'source', bindings }, at: { region: 'center', container: 'pile', slot: 'top' }, cue: 0 }),
    op({ op: 'remove', opId: 'o3', beatId: 'sc.b2', target: 'f1', cue: 0 }),
  ],
});
const draft = (value: unknown = good()): SceneBoardDraft => SceneBoardDraftSchema.parse(value);

test('every kit in the registry has a catalogue entry whose example parameters parse', () => {
  for (const name of KIT_NAMES) {
    const entry = KIT_CATALOGUE[name];
    assert.ok(entry, name);
    assert.ok(entry.purpose.length > 20, `${name} purpose`);
    assert.equal(parseKitParams(name, entry.exampleParamsJson).ok, true, `${name} example params`);
  }
});

test('the board draft is strict', () => {
  assert.ok(draft());
  assert.deepEqual(draft({ transition: { mode: 'clean' }, ops: [] }).ops, []);
  assert.equal(SceneBoardDraftSchema.safeParse({ transition: { mode: 'clean' }, ops: [], extra: true }).success, false);
  assert.equal(SceneBoardDraftSchema.safeParse({ ops: good() }).success, false);
  assert.equal(SceneBoardDraftSchema.safeParse({ transition: { mode: 'wipe' }, ops: (good() as { ops: unknown[] }).ops }).success, false);
});

test('a board that builds every beat and represents its concepts is valid', () => {
  assert.deepEqual(validateSceneBoard(draft(), ctx), []);
});

test('concept coverage uses exact bindings and never infers meaning from an English label', () => {
  const falseLabel = good() as { ops: Array<Record<string, unknown>> };
  const first = falseLabel.ops[0]!;
  first.element = { ...(first.element as Record<string, unknown>), bindings: { conceptIds: ['frame'], claimIds: ['c1'] } };
  const failures = validateSceneBoard(draft(falseLabel), ctx) as Array<{ path: string; message: string }>;
  assert.ok(failures.some((failure) => failure.message.includes('concept stack') && failure.message.includes('not bound to a live visual')));
  assert.ok(!failures.some((failure) => /contains the words|substring/.test(failure.message)));
});

test('problems carry pointers: unknown beat, beats out of order, a beat with no change, a missing concept, long labels, a retain without regions', () => {
  const bad = draft({
    transition: { mode: 'retain-regions' },
    ops: [
      op({ op: 'add', opId: 'o1', beatId: 'sc.b9', id: 'pile', element: { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' }, at: { region: 'center' } }),
      op({ op: 'add', opId: 'o2', beatId: 'sc.b2', id: 'x', element: { type: 'token', text: 'x', provenance: 'illustrative' }, at: { region: 'left' } }),
      op({ op: 'add', opId: 'o3', beatId: 'sc.b1', id: 'y', element: { type: 'text', text: 'a very long label with many words in it', role: 'label', provenance: 'derived' }, at: { region: 'right' } }),
    ],
  });
  const all = validateSceneBoard(bad, ctx) as Array<{ path: string; message: string }>;
  const byPath = new Map(all.filter((p) => typeof p !== 'string').map((p) => [p.path, p.message]));
  assert.match(byPath.get('/transition/regions')!, /needs the regions/);
  assert.match(byPath.get('/ops/0/beatId')!, /unknown beat sc\.b9/);
  assert.match(byPath.get('/ops/2/beatId')!, /out of order/);
  assert.match(byPath.get('/ops/2/element/text')!, /at most 4 words/);
  assert.ok(all.some((p) => typeof p !== 'string' && p.path.startsWith('/ops/') && /concept stack .* not bound to a live visual/.test(p.message)));
});

test('a visual beat without any op is a problem, a narration-only beat is not', () => {
  const only1 = draft({ transition: { mode: 'clean' }, ops: (good() as { ops: unknown[] }).ops.slice(0, 2) });
  assert.ok((validateSceneBoard(only1, ctx) as Array<{ message: string }>).some((p) => /beat sc\.b2 .* at least one op/.test(p.message)));
  const quiet = { ...ctx, beats: [ctx.beats[0]!, beat(2, { narrationOnly: true, mutedMeaning: '' })] };
  assert.deepEqual((validateSceneBoard(only1, quiet) as Array<{ message: string }>).filter((p) => /beat sc\.b2/.test(p.message)), []);
});

test('unverified explanations stay narration-only and cannot be visualized or bound to BoardOps', () => {
  const openClaim = { id: 'open', statement: 'One possible explanation is not verified by the supplied source.', conceptIds: ['frame', 'stack'], relations: [], epistemicType: 'unverified_explanation' as const, verificationStatus: 'unverified' as const };
  const openBeat = beat(2, { claimIds: ['open'], entities: [], semanticRevealOrder: [], requiredSemanticChanges: [], persistentEntityIds: [], relationships: [], narrationOnly: true, mutedMeaning: '' });
  const openCtx: BoardContext = { ...ctx, claims: [{ id: 'c1', statement: 'Each call pushes a frame onto the stack.', conceptIds: ['frame', 'stack'], relations: [] }, openClaim], beats: [ctx.beats[0]!, openBeat] };
  const prompt = buildBoardPrompt(openCtx);
  assert.match(prompt.system, /unverified_explanation claim is narration-only/i);
  assert.match(prompt.user, /"verificationStatus":"unverified"/);
  const safeBoard = draft({ transition: { mode: 'clean' }, ops: (good() as { ops: unknown[] }).ops.slice(0, 2) });
  assert.deepEqual(validateSceneBoard(safeBoard, openCtx), []);

  const openOperation = draft({ transition: { mode: 'clean' }, ops: [
    ...(good() as { ops: unknown[] }).ops.slice(0, 2),
    op({ op: 'remove', opId: 'o4', beatId: 'sc.b2', target: 'f1', cue: 0 }),
  ] });
  assert.ok((validateSceneBoard(openOperation, openCtx) as Array<{ message: string }>).some((problem) => /unverified explanation beat .* cannot contain BoardOps/.test(problem.message)));

  const boundVisual = good() as { ops: Array<Record<string, unknown>> };
  const first = boundVisual.ops[0]!;
  first.element = { ...(first.element as Record<string, unknown>), bindings: { conceptIds: ['frame', 'stack'], claimIds: ['open'] } };
  assert.ok((validateSceneBoard(draft(boundVisual), openCtx) as Array<{ message: string }>).some((problem) => /visuals cannot be bound to unverified explanation claim open/.test(problem.message)));

  const equationVisual = draft({ transition: { mode: 'clean' }, ops: [
    op({ op: 'add', opId: 'e1', beatId: 'sc.b1', id: 'eq', element: { type: 'equation', latex: 'x=y', provenance: 'derived', bindings: { conceptIds: ['frame', 'stack'], claimIds: ['open'] } }, at: { region: 'bottom' } }),
  ] });
  assert.ok((validateSceneBoard(equationVisual, openCtx) as Array<{ message: string }>).some((problem) => /visuals cannot be bound to unverified explanation claim open/.test(problem.message)), 'equation elements without label text must still reject unverified bindings');

  const openOnly = { ...openCtx, beats: [openBeat] };
  assert.deepEqual(fallbackSceneBoard(openOnly), { transition: { mode: 'clean' }, ops: [] }, 'a broken visual planner still has a deterministic no-drawing fallback');
});

test('a retained board lets the scene build on what is already drawn', () => {
  const first = draft({ transition: { mode: 'clean' }, ops: (good() as { ops: unknown[] }).ops.slice(0, 2) });
  assert.deepEqual(validateSceneBoard(first, { ...ctx, beats: [ctx.beats[0]!], narration: [ctx.narration[0]!] }), []);
});

test('the prompt names every beat with its sentences, the op vocabulary, the kits and the regions, and carries no topic', () => {
  const { system, user } = buildBoardPrompt(ctx);
  for (const name of KIT_NAMES) assert.match(system, new RegExp(`\\b${name}\\b`));
  for (const word of ['add', 'connect', 'move', 'transform', 'replace', 'remove', 'highlight', 'deemphasize', 'strike', 'updateValue', 'split', 'merge', 'equationStep', 'revealRegion', 'clearRegion']) assert.match(system, new RegExp(word));
  assert.match(system, /never write coordinates/i);
  assert.match(user, /sc\.b1/);
  assert.match(user, /0: Each call pushes a frame\./);
  assert.match(user, /1: The frame holds the call\./);
  assert.match(user, /frame/);
});

test('S3b icon choices reach S6 and require a live picture for the selected entity', () => {
  const visualVocabulary = { sceneId: 'sc', concepts: [
    { conceptId: 'frame', label: 'Frame', conceptKind: 'entity', depiction: { kind: 'icon' as const, entryId: 'private-icon-entry', rung: 'R3' } },
  ] };
  const iconContext: BoardContext = { ...ctx, visualVocabulary };
  const prompt = buildBoardPrompt(iconContext);
  assert.match(prompt.user, /Frame \(entity\): a real picture exists/);
  assert.match(prompt.system, /add a bound entity element for that exact concept/i);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`, /private-icon-entry/);
  assert.deepEqual(validateSceneBoard(draft(), iconContext), []);

  const withoutFrameEntity = draft({
    ...(good() as object),
    ops: (good() as { ops: Array<Record<string, unknown>> }).ops.map((candidate) => candidate.opId === 'o2'
      ? { ...candidate, element: { type: 'token', text: 'frame', provenance: 'illustrative', bindings } }
      : candidate),
  });
  assert.ok(validateSceneBoard(withoutFrameEntity, iconContext).some((problem) =>
    typeof problem !== 'string' && /S3b selected a library icon for frame .* live entity element/.test(problem.message)));

  const mislabeled = { ...iconContext, concepts: iconContext.concepts.map((concept) => concept.id === 'frame' ? { ...concept, kind: 'process' } : concept) };
  assert.ok(validateSceneBoard(draft(), mislabeled).some((problem) =>
    typeof problem !== 'string' && /only a canonical entity concept can use a noun icon/.test(problem.message)));
});

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
const scripted = (replies: string[]): { client: ModelClient; requests: Array<{ schemaName: string }> } => {
  const requests: Array<{ schemaName: string }> = [];
  return { requests, client: { provider: 'fake', chat: async (r) => { requests.push({ schemaName: r.schemaName }); return { content: replies[requests.length - 1] ?? '{}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }; } } };
};

test('planSceneBoard returns validated ops and the board state after the scene', async () => {
  const { client } = scripted([JSON.stringify(good())]);
  const result = await planSceneBoard({ ctx }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.value?.ops.length, 3);
  assert.equal(result.value?.transition.mode, 'clean');
  assert.equal(result.reports[0]!.stage, 'board-ops');
  assert.equal(result.reports[0]!.firstTryValid, true);
});

test('a bad op is repaired by patching that op', async () => {
  const bad = good() as { ops: Array<Record<string, unknown>> };
  bad.ops[2] = op({ op: 'remove', opId: 'o3', beatId: 'sc.b2', target: 'ghost', cue: 0 });
  const patch = { patches: [{ op: 'replace', path: '/ops/2/target', valueJson: '"f1"' }] };
  const { client, requests } = scripted([JSON.stringify(bad), JSON.stringify(patch)]);
  const result = await planSceneBoard({ ctx }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal((result.value?.ops[2] as { target: string }).target, 'f1');
  assert.equal(requests[1]!.schemaName, 'json_patch');
});

test('geometry problems found by the layout solver become board problems, so overflow and overlap cannot reach the renderer', () => {
  const problems = validateSceneBoard(draft(), { ...ctx, geometryCheck: () => [{ code: 'top_level_overlap', stateIndex: 2, message: 'state 2: pile overlaps f9', elementIds: ['pile', 'f9'], fields: ['/elements/pile/placement', '/elements/f9/placement'] }] });
  const first = problems[0] as { path: string; message: string };
  assert.equal(first.path, '/ops/0', 'the layout problem names the op that drew the element, so the repair patches that op');
  assert.match(first.message, /^layout\[top_level_overlap\]: state 2: pile overlaps f9 \(keep text readable/);
  assert.equal(problems.length, 1, 'the hint rides on the first problem and does not force a whole-document repair');
  assert.deepEqual(validateSceneBoard(draft(), ctx), [], 'the real solver accepts a sane board');
});

test('a kit cannot be placed inside another kit: its slots are too small to draw a mechanism in', () => {
  const nested = draft({
    transition: { mode: 'clean' },
    ops: [
      op({ op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'pile', element: kit, at: { region: 'center' } }),
      op({ op: 'add', opId: 'o2', beatId: 'sc.b1', id: 'inner', element: { type: 'kit', kit: 'compartment', paramsJson: '{"zones":["a","b"]}', provenance: 'metaphorical' }, at: { region: 'center', container: 'pile', slot: 'top' } }),
      op({ op: 'add', opId: 'o3', beatId: 'sc.b1', id: 'f', element: { type: 'entity', conceptId: 'frame', label: 'frame', provenance: 'source' }, at: { region: 'center', container: 'pile', slot: 'top' } }),
      op({ op: 'remove', opId: 'o4', beatId: 'sc.b2', target: 'f' }),
    ],
  });
  const problems = validateSceneBoard(nested, ctx) as Array<{ path: string; message: string }>;
  const nestedProblem = problems.find((p) => p.path === '/ops/1/at/container');
  assert.ok(nestedProblem, JSON.stringify(problems));
  assert.match(nestedProblem!.message, /cannot be placed inside another kit/);
});

const nestingContext: BoardContext = { ...ctx, beats: [beat(1, { entities: [] })], geometryCheck: () => [] };
const boardAdd = (id: string, element: unknown, at: unknown) => ({ op: 'add', opId: `add-${id}`, beatId: 'sc.b1', id, element: element && typeof element === 'object' ? { ...element as Record<string, unknown>, bindings } : element, at });
const token = { type: 'token', text: 'x', provenance: 'illustrative', bindings };

test('only compound graph kits may nest inside a compound graph kit', () => {
  const graph = { type: 'kit', kit: 'graph', paramsJson: '{"nodes":2,"layout":"compound"}', provenance: 'metaphorical', bindings };
  const nested = draft({ transition: { mode: 'clean' }, ops: [
    boardAdd('outer', graph, { region: 'center' }),
    boardAdd('inner', graph, { region: 'center', container: 'outer', slot: 'end' }),
    boardAdd('child', token, { region: 'center', container: 'inner', slot: 'end' }),
  ] });
  assert.deepEqual(validateSceneBoard(nested, nestingContext), []);
  const invalid = draft({ ...nested, ops: [nested.ops[0]!, boardAdd('inner', { ...graph, paramsJson: '{"nodes":2,"layout":"ring"}' }, { region: 'center', container: 'outer', slot: 'end' })] });
  assert.ok(validateSceneBoard(invalid, nestingContext).some((problem) => typeof problem !== 'string' && problem.path === '/ops/1/at/container'));
});

for (const scenario of [
  {
    name: 'a kit added earlier in the scene is moved into a kit, even if moved out again later',
    ops: [
      boardAdd('inner', kit, { region: 'right' }),
      { op: 'move', opId: 'nest', beatId: 'sc.b1', target: 'inner', to: { region: 'center', container: 'pile' } },
      { op: 'highlight', opId: 'emphasize', beatId: 'sc.b1', target: 'inner' },
      { op: 'move', opId: 'escape', beatId: 'sc.b1', target: 'inner', to: { region: 'right' } },
    ],
    paths: ['/ops/2/to/container'],
  },
  {
    name: 'a child is replaced with a kit that inherits its container',
    ops: [
      boardAdd('child', token, { region: 'center', container: 'pile' }),
      { op: 'replace', opId: 'nest', beatId: 'sc.b1', target: 'child', id: 'inner', element: kit },
      { op: 'highlight', opId: 'emphasize', beatId: 'sc.b1', target: 'inner' },
    ],
    paths: ['/ops/2/element/type'],
  },
  {
    name: 'a split creates kits in container slots',
    ops: [
      boardAdd('child', token, { region: 'right' }),
      { op: 'split', opId: 'nest', beatId: 'sc.b1', target: 'child', into: [
        { id: 'inner-a', element: kit, at: { region: 'center', container: 'pile' } },
        { id: 'inner-b', element: kit, at: { region: 'center', container: 'pile' } },
      ] },
      { op: 'highlight', opId: 'emphasize', beatId: 'sc.b1', target: 'inner-a' },
    ],
    paths: ['/ops/2/into/0/at/container', '/ops/2/into/1/at/container'],
  },
  {
    name: 'a merge creates a kit in a container slot',
    ops: [
      boardAdd('child-a', token, { region: 'right' }),
      boardAdd('child-b', token, { region: 'bottom' }),
      { op: 'merge', opId: 'nest', beatId: 'sc.b1', targets: ['child-a', 'child-b'], into: { id: 'inner', element: kit, at: { region: 'center', container: 'pile' } } },
      { op: 'highlight', opId: 'emphasize', beatId: 'sc.b1', target: 'inner' },
    ],
    paths: ['/ops/3/into/at/container'],
  },
]) {
  test(`nesting carries repair pointers when ${scenario.name}`, () => {
    let geometryCalled = false;
    const problems = validateSceneBoard(draft({ transition: { mode: 'clean' }, ops: [boardAdd('pile', kit, { region: 'center' }), ...scenario.ops] }), {
      ...nestingContext,
      geometryCheck: () => { geometryCalled = true; return []; },
    });
    assert.deepEqual(problems.map((p) => typeof p === 'string' ? p : p.path), scenario.paths, JSON.stringify(problems));
    for (const problem of problems) assert.match(typeof problem === 'string' ? problem : problem.message, /kit.*cannot.*inside another kit/);
    assert.equal(geometryCalled, false, 'nesting fails before geometry and is not repeated for later emphasis ops');
  });
}

test('non-kit children support move, replace, split and merge inside kit slots', () => {
  const ordinary = draft({ transition: { mode: 'clean' }, ops: [
    boardAdd('pile', kit, { region: 'center' }),
    boardAdd('child', token, { region: 'right' }),
    { op: 'move', opId: 'move', beatId: 'sc.b1', target: 'child', to: { region: 'center', container: 'pile' } },
    { op: 'replace', opId: 'replace', beatId: 'sc.b1', target: 'child', id: 'replacement', element: token },
    { op: 'split', opId: 'split', beatId: 'sc.b1', target: 'replacement', into: [
      { id: 'part-a', element: token, at: { region: 'center', container: 'pile' } },
      { id: 'part-b', element: token, at: { region: 'center', container: 'pile' } },
    ] },
    { op: 'merge', opId: 'merge', beatId: 'sc.b1', targets: ['part-a', 'part-b'], into: { id: 'merged', element: token, at: { region: 'center', container: 'pile' } } },
  ] });
  assert.deepEqual(validateSceneBoard(ordinary, nestingContext), []);
});

test('geometry problems are condensed to a few per element with one actionable hint, not a cascade', () => {
  const many: GeometryDiagnostic[] = Array.from({ length: 12 }, (_, i): GeometryDiagnostic => ({ code: 'element_too_small', stateIndex: i, message: `state ${i + 1}: frame-three is too small to read (88x21)`, elementIds: ['frame-three'], fields: ['/elements/frame-three/placement'] })).concat([
    { code: 'child_outside_container' as const, stateIndex: 3, message: 'state 3: frame-three-input is outside frame-three', elementIds: ['frame-three-input', 'frame-three'], fields: ['/elements/frame-three-input/placement'] },
    { code: 'top_level_overlap' as const, stateIndex: 4, message: 'state 4: other overlaps third', elementIds: ['other', 'third'], fields: ['/elements/other/placement', '/elements/third/placement'] },
  ]);
  const problems = validateSceneBoard(draft(), { ...ctx, geometryCheck: () => many });
  const text = problems.map((p) => (typeof p === 'string' ? p : p.message));
  assert.equal(problems.length, 3, `${problems.length} distinct geometry problems`);
  assert.ok(text.some((p) => /keep text readable/.test(p)));
  assert.ok(text.filter((p) => /frame-three is too small/.test(p)).length === 1, 'repeats of the same element collapse');
});

test('the prompt lists each kit\'s exact parameter fields and enumerations from its own schema', async () => {
  const { describeKitParams } = await import('../visual-v2/ops-plan/prompt.js');
  assert.match(describeKitParams('axes-plot'), /fn: one of linear\|quadratic\|cubic\|sine\|exp\|log\|normal/);
  assert.match(describeKitParams('graph'), /layout\?: one of ring\|grid\|compound/);
});

test('unsupported source text cannot be salvaged as illustrative or reverse a claim after an explicit downgrade', () => {
  const bad = good() as { ops: Array<{ element: Record<string, unknown> }> };
  bad.ops[1]!.element = { ...bad.ops[1]!.element, label: 'Safe during pregnancy', provenance: 'source', evidence: { spanId: 's1', quote: 'a stack pushes' } };
  const grounded: BoardContext = {
    ...ctx,
    claims: [{ id: 'c1', statement: 'Not safe during pregnancy.' }],
    grounding: { verify: (spanId, quote) => (spanId === 's1' && quote === 'a stack pushes' ? quote : undefined) },
  };
  assert.ok(validateSceneBoard(draft(bad), grounded).length > 0, 'the unsupported source assertion remains a validation failure');
  assert.equal(salvageSceneBoard(draft(bad), grounded), undefined, 'unsupported source text stays a repair/failure, never an illustrative salvage');

  const downgraded = good() as { ops: Array<{ element: Record<string, unknown> }> };
  downgraded.ops[1]!.element = { ...downgraded.ops[1]!.element, label: 'Safe during pregnancy', provenance: 'illustrative' };
  assert.ok(validateSceneBoard(draft(downgraded), grounded).some((p) =>
    /visual text bound to claim c1 contradicts its canonical wording/.test((p as { message: string }).message),
  ), 'changing provenance does not bypass the canonical claim check');
});

test('claim-linked visuals preserve direction, scope, spatial, extreme, and condition cues', () => {
  const cases = [
    ['Resistance increases.', 'Resistance decreases.'],
    ['All cells divide.', 'Some cells divide.'],
    ['Molecules remain inside the membrane.', 'Molecules remain outside the membrane.'],
    ['The minimum voltage is 5 V.', 'The maximum voltage is 5 V.'],
    ['If heated, resistance rises.', 'Unless heated, resistance rises.'],
  ] as const;
  for (const [statement, label] of cases) {
    const changed = good() as { ops: Array<{ element: Record<string, unknown> }> };
    changed.ops[1]!.element = { ...changed.ops[1]!.element, label, provenance: 'illustrative' };
    const claimContext: BoardContext = { ...ctx, claims: [{ id: 'c1', statement }] };
    const failures = validateSceneBoard(draft(changed), claimContext) as Array<{ message: string }>;
    assert.ok(failures.some((failure) => /visual text bound to claim c1 contradicts its canonical wording/.test(failure.message)), `${statement} -> ${label}`);
  }

  const paraphrased = good() as { ops: Array<{ element: Record<string, unknown> }> };
  paraphrased.ops[1]!.element = { ...paraphrased.ops[1]!.element, label: 'Every cell divides.', provenance: 'illustrative' };
  assert.deepEqual(validateSceneBoard(draft(paraphrased), { ...ctx, claims: [{ id: 'c1', statement: 'All cells divide.' }] }), []);
});

test('visual concept bindings must be covered by their linked canonical claims', () => {
  const bound = good() as { ops: Array<Record<string, unknown>> };
  const claimContext: BoardContext = {
    ...ctx,
    claims: [{ id: 'c1', statement: 'Each call pushes a frame.', conceptIds: ['frame'], relations: [] }],
  };
  const failures = validateSceneBoard(draft(bound), claimContext) as Array<{ path: string; message: string }>;
  assert.ok(failures.some((failure) => failure.path === '/ops/0/element/bindings/conceptIds' && /concept stack is not linked to any canonical claim bound here/.test(failure.message)));
  assert.ok(failures.some((failure) => failure.path === '/ops/1/element/bindings/conceptIds' && /concept stack is not linked to any canonical claim bound here/.test(failure.message)));
});

test('an entity cannot display another graph concept label while keeping its own concept ID', () => {
  const swapped = good() as { ops: Array<{ element?: Record<string, unknown> }> };
  swapped.ops[1]!.element = { ...swapped.ops[1]!.element!, label: 'Stack' };
  const problems = validateSceneBoard(draft(swapped), ctx) as Array<{ path: string; message: string }>;
  assert.ok(problems.some((problem) => problem.path === '/ops/1/element/label' && /names concept stack, but this entity is bound to frame/.test(problem.message)));
});

test('factual edges preserve claim relation direction and predicate when endpoint identities resolve', () => {
  const claimContext: BoardContext = {
    ...ctx,
    claims: [{
      id: 'c1', statement: 'A frame contains a stack.', conceptIds: ['frame', 'stack'],
      relations: [{ from: 'frame', to: 'stack', type: 'contains' }],
    }],
    geometryCheck: () => [],
  };
  const withEdge = (from = 'f1', to = 's1', relation = 'contains'): SceneBoardDraft => {
    const value = good() as { ops: Array<Record<string, unknown>> };
    value.ops.splice(2, 0,
      op({ op: 'add', opId: 'o-stack', beatId: 'sc.b1', id: 's1', element: { type: 'entity', conceptId: 'stack', label: 'stack', provenance: 'source', bindings: { conceptIds: ['stack'], claimIds: ['c1'] } }, at: { region: 'right' }, cue: 0 }),
      op({ op: 'connect', opId: 'o-edge', beatId: 'sc.b1', id: 'edge', from, to, relation, bindings: { conceptIds: ['frame', 'stack'], claimIds: ['c1'] }, cue: 0 }),
    );
    return draft(value);
  };

  assert.deepEqual(validateSceneBoard(withEdge(), claimContext), [], 'the aligned source → predicate → destination edge remains valid');
  const reversed = validateSceneBoard(withEdge('s1', 'f1'), claimContext) as Array<{ path: string; message: string }>;
  assert.ok(reversed.some((failure) => failure.path === '/ops/3/from' && /reverses claim relation frame -contains-> stack/.test(failure.message)));
  const wrongPredicate = validateSceneBoard(withEdge('f1', 's1', 'produces'), claimContext) as Array<{ path: string; message: string }>;
  assert.ok(wrongPredicate.some((failure) => failure.path === '/ops/3/relation' && /does not match the claim relation for these endpoints; expected contains/.test(failure.message)));
});

test('claim relation checking skips ambiguous endpoints and legacy claims without relation data', () => {
  const ambiguous = {
    ...ctx,
    claims: [{ id: 'c1', statement: 'A frame contains a stack.', conceptIds: ['frame', 'stack'], relations: [{ from: 'frame', to: 'stack', type: 'contains' }] }],
    geometryCheck: () => [],
  } as BoardContext;
  const broad = good() as { ops: Array<Record<string, unknown>> };
  broad.ops.splice(2, 0,
    op({ op: 'add', opId: 'o-stack', beatId: 'sc.b1', id: 's1', element: { type: 'entity', conceptId: 'stack', label: 'stack', provenance: 'source', bindings: { conceptIds: ['stack'], claimIds: ['c1'] } }, at: { region: 'right' }, cue: 0 }),
    op({ op: 'connect', opId: 'o-edge', beatId: 'sc.b1', id: 'edge', from: 'pile', to: 's1', relation: 'produces', bindings: { conceptIds: ['frame', 'stack'], claimIds: ['c1'] }, cue: 0 }),
  );
  assert.ok(!validateSceneBoard(draft(broad), ambiguous).some((failure) => typeof failure !== 'string' && /claim relation|reverses claim/.test(failure.message)), 'a multi-concept kit endpoint does not claim a resolvable identity');

  const legacy = { ...ctx, claims: [{ id: 'c1', statement: 'A frame contains a stack.' }], geometryCheck: () => [] } as BoardContext;
  assert.deepEqual(validateSceneBoard(draft(broad), legacy), [], 'legacy claim data without linked relation tuples is treated as unresolved');
});

test('a factual edge cannot be justified by a claim with no canonical relation tuples', () => {
  const value = good() as { ops: Array<Record<string, unknown>> };
  value.ops.splice(2, 0,
    op({ op: 'add', opId: 'o-stack', beatId: 'sc.b1', id: 's1', element: { type: 'entity', conceptId: 'stack', label: 'stack', provenance: 'source', bindings: { conceptIds: ['stack'], claimIds: ['c1'] } }, at: { region: 'right' }, cue: 0 }),
    op({ op: 'connect', opId: 'o-edge', beatId: 'sc.b1', id: 'edge', from: 'f1', to: 's1', relation: 'causes', bindings: { conceptIds: ['frame', 'stack'], claimIds: ['c1'] }, cue: 0 }),
  );
  const context: BoardContext = { ...ctx, claims: [{ id: 'c1', statement: 'A frame and stack are present.', conceptIds: ['frame', 'stack'], relations: [] }], geometryCheck: () => [] };
  const problems = validateSceneBoard(draft(value), context) as Array<{ path: string; message: string }>;
  assert.ok(problems.some((problem) => problem.path === '/ops/3/bindings/claimIds' && /must cite a claim with a canonical directed relation/.test(problem.message)));
});

test('citation problems on split parts and merge targets also put the whole element in repair scope', async () => {
  const { boardRepairScope } = await import('../visual-v2/ops-plan/plan.js');
  assert.equal(boardRepairScope('/ops/3/element/evidence'), '/ops/3/element');
  assert.equal(boardRepairScope('/ops/3/into/1/element/evidence'), '/ops/3/into/1/element');
  assert.equal(boardRepairScope('/ops/3/into/element/evidence'), '/ops/3/into/element');
  assert.equal(boardRepairScope('/ops/3/target'), '/ops/3/target', 'other pointers keep their exact scope');
});

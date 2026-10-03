import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneBoardDraftSchema, type SceneBoardDraft } from '../visual-v2/ops-plan/types.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { buildBoardPrompt } from '../visual-v2/ops-plan/prompt.js';
import { planSceneBoard } from '../visual-v2/ops-plan/plan.js';
import { KIT_CATALOGUE } from '../visual-v2/kits/catalogue.js';
import { KIT_NAMES } from '../visual-v2/board-ops/types.js';
import { parseKitParams } from '../visual-v2/kits/registry.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { ModelClient } from '../llm/modelClient.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { GeometryDiagnostic } from '../visual-v2/layout/sceneLayout.js';

const beat = (n: number, over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: `sc.b${n}`, sceneId: 'sc', order: n, claimIds: ['c1'], learnerDelta: 'delta', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ conceptId: 'frame' }], relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'a frame is on the pile', mutedMeaning: 'a pile grows',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', evidenceSpanIds: ['s1'], ...over,
});
const ctx: BoardContext = {
  sceneId: 'sc', title: 'Stack scene',
  beats: [beat(1), beat(2, { entities: [{ conceptId: 'stack' }] })],
  narration: [
    { beatId: 'sc.b1', sentences: ['Each call pushes a frame.', 'The frame holds the call.'] },
    { beatId: 'sc.b2', sentences: ['A return pops the top frame.'] },
  ],
  concepts: [{ id: 'frame', label: 'Frame' }, { id: 'stack', label: 'Stack' }],
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
  assert.equal(SceneBoardDraftSchema.safeParse({ transition: { mode: 'clean' }, ops: [] }).success, false);
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

test('the repair the validator asks for is allowed: switching an unquoted source label to illustrative may touch its provenance and citation together', async () => {
  const bad = good() as { ops: Array<{ element: Record<string, unknown> }> };
  bad.ops[1]!.element = { ...bad.ops[1]!.element, provenance: 'source', evidence: { spanId: 's1', quote: 'a stack pushes' } };
  const grounded = { ...ctx, grounding: { verify: (spanId: string, quote: string) => (spanId === 's1' && quote === 'a stack pushes' ? quote : undefined) } } as BoardContext;
  assert.ok(validateSceneBoard(draft(bad), grounded).some((p) => /absent from its cited quote/.test((p as { message: string }).message) && /derived|illustrative/.test((p as { message: string }).message)));
  // This is the patch a model returns when it follows the hint. It changes provenance and removes the citation of the SAME element.
  const patch = { patches: [{ op: 'replace', path: '/ops/1/element/provenance', valueJson: '"illustrative"' }, { op: 'remove', path: '/ops/1/element/evidence' }] };
  const { client, requests } = scripted([JSON.stringify(bad), JSON.stringify(patch)]);
  const result = await planSceneBoard({ ctx: grounded }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
  assert.equal(requests.length, 2, 'one repair was enough');
  const element = (result.value?.ops[1] as { element: { provenance: string; evidence?: unknown } }).element;
  assert.equal(element.provenance, 'illustrative');
  assert.equal(element.evidence, undefined);
});

test('citation problems on split parts and merge targets also put the whole element in repair scope', async () => {
  const { boardRepairScope } = await import('../visual-v2/ops-plan/plan.js');
  assert.equal(boardRepairScope('/ops/3/element/evidence'), '/ops/3/element');
  assert.equal(boardRepairScope('/ops/3/into/1/element/evidence'), '/ops/3/into/1/element');
  assert.equal(boardRepairScope('/ops/3/into/element/evidence'), '/ops/3/into/element');
  assert.equal(boardRepairScope('/ops/3/target'), '/ops/3/target', 'other pointers keep their exact scope');
});

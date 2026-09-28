import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { ScenePlanningContext } from '../planner/context.js';
import { BOARD_SCHEMA_VERSION, boardEnums, boardProblems, compileBoard, fallbackBoard, validateBoard, type Board, type BoardNode } from '../planner/board.js';
import { typedBoardAdequacyFailures } from '../validation/gates.js';
import { safeParseSceneSpec } from '../schema.js';

/**
 * S6 gate coherence (domain-general, no topic keywords in runtime): the board
 * cap gates (compare size, per-concept instances, mention-once) must agree
 * with the coverage gates (all relations + required concepts drawn) and the
 * adequacy gate, so a board satisfying one is never failed by another.
 * Fixtures use generic ids/labels only.
 */

const ref = (id: string, quote: string, start: number) => ({ sourceId: 't_doc', spanId: `t_${id}`, startChar: start, endChar: start + quote.length, startLine: 1, endLine: 1, quote });

function chainScene(): PlannerSceneInput {
  // Four required concepts bound by a chain: no compare board can cover this.
  const words = { c1: 'Alpha', c2: 'Beta', c3: 'Gamma', c4: 'Delta' };
  const quotes = { c1: 'Alpha enters', c2: 'Beta enters', c3: 'Gamma enters', c4: 'Delta results', r1: 'Alpha feeds Beta', r2: 'Beta feeds Gamma', r3: 'Gamma yields Delta' };
  const refs = { c1: ref('c1', quotes.c1, 0), c2: ref('c2', quotes.c2, 20), c3: ref('c3', quotes.c3, 40), c4: ref('c4', quotes.c4, 60), r1: ref('r1', quotes.r1, 90), r2: ref('r2', quotes.r2, 120), r3: ref('r3', quotes.r3, 150) };
  const input: PlannerSceneInput = {
    sceneId: 't_chain',
    raw: '',
    plainText: 'Alpha and Beta go into Gamma, which makes Delta.',
    mentions: [{ id: 'm1', phrase: 'Alpha' }, { id: 'm2', phrase: 'Beta' }, { id: 'm3', phrase: 'Gamma' }, { id: 'm4', phrase: 'Delta' }],
    teachingContext: {
      requireEvidence: true,
      sourceId: 't_doc',
      displayText: 'Alpha Makes Delta',
      sourceEvidenceRefs: Object.values(refs),
      concepts: (['c1', 'c2', 'c3', 'c4'] as const).map((id) => ({ id, label: words[id], kind: 'entity', definition: `${words[id]} definition`, evidenceRefs: [refs[id]] })),
      relations: [
        { from: 'c1', to: 'c2', type: 'feeds', evidenceRefs: [refs.r1] },
        { from: 'c2', to: 'c3', type: 'feeds', evidenceRefs: [refs.r2] },
        { from: 'c3', to: 'c4', type: 'produces', evidenceRefs: [refs.r3] },
      ],
    },
    candidates: {},
  };
  input.planningContext = {
    lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
    sceneContract: { learningDelta: 'x', targetDurationSec: 20, requiredConceptIds: ['c1', 'c2', 'c3', 'c4'], requiredRelations: [], evidenceSpanIds: ['x'], teachingSkill: 'mechanism', candidateMechanisms: ['chain'] },
    examples: [],
  } as unknown as ScenePlanningContext;
  return input;
}

const fullListBoard = (): Board => ({
  schemaVersion: BOARD_SCHEMA_VERSION,
  title: 'Alpha Makes Delta',
  layout: 'list',
  visual: { kind: 'process' },
  nodes: [
    { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Alpha', role: 'process' },
    { id: 'n2', mention: 'm2', concept: 'c2', icon: 'label', label: 'Beta', role: 'item' },
    { id: 'n3', mention: 'm3', concept: 'c3', icon: 'label', label: 'Gamma', role: 'item' },
    { id: 'n4', mention: 'm4', concept: 'c4', icon: 'label', label: 'Delta', role: 'item' },
  ],
});

// Fight 1: compare cap vs coverage. A 4-concept scene cannot fit compare;
// the gate must name the layout (re-lay, keep coverage), not fight coverage.
test('compare overflow names the layout defect with a re-lay direction', () => {
  const input = chainScene();
  const board: Board = { ...fullListBoard(), layout: 'compare', visual: { kind: 'comparison' }, nodes: fullListBoard().nodes.slice(0, 2) };
  const problems = validateBoard(board, input).problems.join(' | ');
  assert.match(problems, /fits at most 3 nodes but the scene requires 4 concepts \[c1, c2, c3, c4\]/);
  assert.match(problems, /use a non-compare layout/);
});

test('a full-coverage non-compare board passes every gate (gates agree)', () => {
  const input = chainScene();
  assert.deepEqual(validateBoard(fullListBoard(), input).problems, []);
});

test('compare cap stays strict for oversized compare boards', () => {
  const input = chainScene();
  const board: Board = { ...fullListBoard(), layout: 'compare', visual: { kind: 'comparison' } };
  assert.match(validateBoard(board, input).problems.join(' | '), /needs 2 or 3 nodes/);
});

test('compare stays viable when every required concept fits', () => {
  const input = chainScene();
  input.teachingContext = { ...input.teachingContext!, relations: input.teachingContext!.relations!.slice(0, 1) };
  input.planningContext = { ...input.planningContext!, sceneContract: { ...input.planningContext!.sceneContract, requiredConceptIds: ['c1', 'c2'] } } as ScenePlanningContext;
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION, title: 'Alpha Makes Delta', layout: 'compare', visual: { kind: 'comparison' },
    nodes: [
      { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Alpha', role: 'item' },
      { id: 'n2', mention: 'm2', concept: 'c2', icon: 'label', label: 'Beta', role: 'item' },
    ],
  };
  assert.deepEqual(validateBoard(board, input).problems, []);
});

// Fight 2: per-concept instance cap vs coverage. Dropping an excess instance
// never removes the concept or a drawn edge, so the cap message names the
// excess nodes and the keep-coverage fix.
function instanceScene(): PlannerSceneInput {
  const quotes = { c: 'Alpha item', r: 'nothing links' };
  const refs = { c: ref('c', quotes.c, 0) };
  const input: PlannerSceneInput = {
    sceneId: 't_instances',
    raw: '',
    plainText: 'Alpha, red Alpha, tall Alpha, wide Alpha.',
    mentions: [{ id: 'm1', phrase: 'Alpha' }, { id: 'm2', phrase: 'red Alpha' }, { id: 'm3', phrase: 'tall Alpha' }, { id: 'm4', phrase: 'wide Alpha' }],
    teachingContext: {
      requireEvidence: true, sourceId: 't_doc', displayText: 'Alpha Items', sourceEvidenceRefs: Object.values(refs),
      concepts: [{ id: 'c1', label: 'Alpha', kind: 'entity', definition: 'Alpha definition', evidenceRefs: [refs.c] }],
      relations: [],
    },
    candidates: {},
  };
  input.planningContext = {
    lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
    sceneContract: { learningDelta: 'x', targetDurationSec: 20, requiredConceptIds: ['c1'], requiredRelations: [], evidenceSpanIds: ['x'], teachingSkill: 'definition', candidateMechanisms: ['list'] },
    examples: [],
  } as unknown as ScenePlanningContext;
  return input;
}

const instanceBoard = (count: number): Board => ({
  schemaVersion: BOARD_SCHEMA_VERSION,
  title: 'Alpha Items',
  layout: 'list',
  visual: { kind: 'plain' },
  nodes: ([
    { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Alpha', role: 'item' },
    { id: 'n2', mention: 'm2', concept: 'c1', icon: 'label', label: 'red Alpha', role: 'item' },
    { id: 'n3', mention: 'm3', concept: 'c1', icon: 'label', label: 'tall Alpha', role: 'item' },
    { id: 'n4', mention: 'm4', concept: 'c1', icon: 'label', label: 'wide Alpha', role: 'item' },
  ] as BoardNode[]).slice(0, count),
});

test('instance overflow names the excess nodes with a keep-coverage fix', () => {
  const problems = validateBoard(instanceBoard(4), instanceScene()).problems.join(' | ');
  assert.match(problems, /concept c1 has 4 nodes \[n1, n2, n3, n4\]/);
  assert.match(problems, /at most 3 instances — drop excess instance node\(s\) n4/);
  assert.match(problems, /keep one node for the concept with every required relation drawn/);
});

test('dropping the excess instance passes with coverage intact', () => {
  const input = instanceScene();
  assert.deepEqual(validateBoard(instanceBoard(3), input).problems, []);
});

// Fight 3: mention-once vs recap fan-in coverage. One mention may reveal a
// second node only when that node alone shows an otherwise-omitted required
// concept; every other reuse stays rejected.
function scarceScene(extraConcept: string | null): PlannerSceneInput {
  const quotes = { c1: 'Idea One stated', c2: 'Idea Two stated', c3: 'Idea Three stated', r1: 'Idea One leads to Idea Two', r2: 'Idea Two leads to Idea Three' };
  const refs = { c1: ref('c1', quotes.c1, 0), c2: ref('c2', quotes.c2, 30), c3: ref('c3', quotes.c3, 60), r1: ref('r1', quotes.r1, 90), r2: ref('r2', quotes.r2, 130) };
  const concepts: NonNullable<NonNullable<PlannerSceneInput['teachingContext']>['concepts']> = [
    { id: 'c1', label: 'Idea One', kind: 'entity', definition: 'Idea One definition', evidenceRefs: [refs.c1] },
    { id: 'c2', label: 'Idea Two', kind: 'entity', definition: 'Idea Two definition', evidenceRefs: [refs.c2] },
    { id: 'c3', label: 'Idea Three', kind: 'entity', definition: 'Idea Three definition', evidenceRefs: [refs.c3] },
  ];
  if (extraConcept) concepts.push({ id: 'cx', label: extraConcept, kind: 'entity', definition: `${extraConcept} definition`, evidenceRefs: [refs.c1] });
  const input: PlannerSceneInput = {
    sceneId: 't_scarce',
    raw: '',
    plainText: 'Idea One and Idea Three.',
    // Genuine scarcity: 2 mentions for 3 required concepts, the recap fan-in shape.
    mentions: [{ id: 'm1', phrase: 'Idea One' }, { id: 'm2', phrase: 'Idea Three' }],
    teachingContext: {
      requireEvidence: true, sourceId: 't_doc', displayText: 'Ideas Connect', sourceEvidenceRefs: Object.values(refs),
      concepts, relations: [
        { from: 'c1', to: 'c2', type: 'feeds', evidenceRefs: [refs.r1] },
        { from: 'c2', to: 'c3', type: 'produces', evidenceRefs: [refs.r2] },
      ],
    },
    candidates: {},
  };
  input.planningContext = {
    lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
    sceneContract: { learningDelta: 'x', targetDurationSec: 20, requiredConceptIds: ['c1', 'c2', 'c3'], requiredRelations: [], evidenceSpanIds: ['x'], teachingSkill: 'recap', candidateMechanisms: ['chain'] },
    examples: [],
  } as unknown as ScenePlanningContext;
  return input;
}

test('mention reuse covering an otherwise-omitted required concept passes', () => {
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION, title: 'Ideas Connect', layout: 'list', visual: { kind: 'plain' },
    nodes: [
      { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Idea One', role: 'item' },
      { id: 'n2', mention: 'm1', concept: 'c2', icon: 'label', label: 'Idea Two', role: 'item' },
      { id: 'n3', mention: 'm2', concept: 'c3', icon: 'label', label: 'Idea Three', role: 'item' },
    ],
  };
  assert.deepEqual(validateBoard(board, scarceScene(null)).problems, []);
});

test('mention reuse stays rejected when a free mention could carry the node', () => {
  const input = scarceScene(null);
  input.mentions = [...input.mentions, { id: 'm3', phrase: 'Idea Two spoken' }];
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION, title: 'Ideas Connect', layout: 'list', visual: { kind: 'plain' },
    nodes: [
      { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Idea One', role: 'item' },
      { id: 'n2', mention: 'm1', concept: 'c2', icon: 'label', label: 'Idea Two', role: 'item' },
      { id: 'n3', mention: 'm2', concept: 'c3', icon: 'label', label: 'Idea Three', role: 'item' },
    ],
  };
  // Three mentions for three required concepts: no scarcity, so the reuse is
  // unjustified even though n2 alone shows required c2.
  assert.match(validateBoard(board, input).problems.join(' | '), /mention m1 is used twice/);
});

test('mention reuse for a non-required concept stays rejected', () => {
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION, title: 'Ideas Connect', layout: 'list', visual: { kind: 'plain' },
    nodes: [
      { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Idea One', role: 'item' },
      { id: 'n2', mention: 'm1', concept: 'cx', icon: 'label', label: 'Side Note', role: 'item' },
      { id: 'n3', mention: 'm2', concept: 'c3', icon: 'label', label: 'Idea Three', role: 'item' },
    ],
  };
  assert.match(validateBoard(board, scarceScene('Side Note')).problems.join(' | '), /mention m1 is used twice/);
});

test('mention reuse for an already-shown required concept stays rejected', () => {
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION, title: 'Ideas Connect', layout: 'list', visual: { kind: 'plain' },
    nodes: [
      { id: 'n1', mention: 'm1', concept: 'c1', icon: 'label', label: 'Idea One', role: 'item' },
      { id: 'n2', mention: 'm1', concept: 'c2', icon: 'label', label: 'Idea Two', role: 'item' },
      { id: 'n3', mention: 'm2', concept: 'c3', icon: 'label', label: 'Idea Three', role: 'item' },
      { id: 'n4', mention: 'm1', concept: 'c2', icon: 'label', label: 'Idea Two', role: 'item' },
    ],
  };
  // n4 duplicates n2's mention AND label for the same concept: the twin rule
  // still demands distinct mentions/labels per instance.
  assert.match(validateBoard(board, scarceScene(null)).problems.join(' | '), /distinct mention/);
});

// Fight 4: fallback item-roles vs process visual. A role-less fallback must
// downgrade to the plain visual, not claim a process it cannot satisfy.
function looseScene(): PlannerSceneInput {
  const quotes = { c1: 'Alpha noted', c2: 'Beta noted', c3: 'Gamma noted' };
  const refs = { c1: ref('c1', quotes.c1, 0), c2: ref('c2', quotes.c2, 20), c3: ref('c3', quotes.c3, 40) };
  const input: PlannerSceneInput = {
    sceneId: 't_loose',
    raw: '',
    plainText: 'Alpha, Beta, Gamma.',
    mentions: [{ id: 'c1', phrase: 'Alpha' }, { id: 'c2', phrase: 'Beta' }, { id: 'c3', phrase: 'Gamma' }],
    teachingContext: {
      requireEvidence: true, sourceId: 't_doc', displayText: 'Three Items', sourceEvidenceRefs: Object.values(refs),
      concepts: (['c1', 'c2', 'c3'] as const).map((id) => ({ id, label: id === 'c1' ? 'Alpha' : id === 'c2' ? 'Beta' : 'Gamma', kind: 'entity', definition: 'item definition', evidenceRefs: [refs[id]] })),
      relations: [],
    },
    candidates: {},
  };
  input.planningContext = {
    lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
    sceneContract: { learningDelta: 'x', targetDurationSec: 20, requiredConceptIds: ['c1', 'c2', 'c3'], requiredRelations: [], evidenceSpanIds: ['x'], teachingSkill: 'definition', candidateMechanisms: ['list'] },
    examples: [],
  } as unknown as ScenePlanningContext;
  return input;
}

test('role-less fallback downgrades to the plain visual and passes its own gates', () => {
  const input = looseScene();
  const board = fallbackBoard(input);
  assert.ok(board.nodes.length >= 3 && board.nodes.every((node) => node.role === 'item'));
  assert.equal(board.visual.kind, 'plain');
  const problems = [...boardProblems(board, input, boardEnums(input)), ...compileBoard(board, input).problems];
  assert.ok(!problems.some((problem) => problem.includes('process form needs')), problems.join(' | '));
  assert.deepEqual(validateBoard(board, input).problems, []);
});

test('plain visual compiles to the layout template with no role requirement', () => {
  const input = looseScene();
  const { spec, problems } = compileBoard(fallbackBoard(input), input);
  assert.deepEqual(problems, []);
  // No relation shape and no structure cue: sequence projects to flow.
  assert.equal(spec.template, 'chain');
  assert.equal(spec.boardIntent?.visualKind, 'plain');
  assert.ok(safeParseSceneSpec(spec).success);
  const laidOut = {
    sceneId: spec.sceneId,
    template: spec.template,
    elements: spec.elements.map((element, index) => ({
      id: element.id, element, visual: { paths: [], fills: [], texts: [] },
      intrinsicSize: { w: 20, h: 20 }, strokeLength: 0, bbox: { x: index * 30, y: 0, w: 20, h: 20 },
    })),
    edges: spec.edges.map((edge) => ({ ...edge, points: [] })),
    occupancy: 0.5, carryOver: [], focus: [], boardIntent: spec.boardIntent,
  };
  assert.deepEqual(typedBoardAdequacyFailures(laidOut as never), []);
});

test('process visual without a process role stays strictly rejected', () => {
  const board: Board = { ...fullListBoard(), visual: { kind: 'process' }, nodes: fullListBoard().nodes.map((node) => ({ ...node, role: 'item' as const })) };
  assert.match(validateBoard(board, chainScene()).problems.join(' | '), /process form needs at least one process-role node/);
});

test('compare layout with a plain visual stays strictly rejected', () => {
  const board: Board = { ...fullListBoard(), layout: 'compare', visual: { kind: 'plain' }, nodes: fullListBoard().nodes.slice(0, 2) };
  assert.match(validateBoard(board, chainScene()).problems.join(' | '), /compare layout requires comparison form/);
});

test('fallback keeps the process visual when the relation graph assigns a process role', () => {
  const input = chainScene();
  // Fan-in shape: two inputs join through one centre into an output.
  input.teachingContext = {
    ...input.teachingContext!,
    relations: [
      { from: 'c1', to: 'c3', type: 'feeds', evidenceRefs: input.teachingContext!.relations![0]!.evidenceRefs },
      { from: 'c2', to: 'c3', type: 'feeds', evidenceRefs: input.teachingContext!.relations![1]!.evidenceRefs },
      { from: 'c3', to: 'c4', type: 'produces', evidenceRefs: input.teachingContext!.relations![2]!.evidenceRefs },
    ],
  };
  const board = fallbackBoard(input);
  assert.equal(board.layout, 'convergence');
  assert.ok(board.nodes.some((node) => node.role === 'process'));
  assert.equal(board.visual.kind, 'process');
});

test('fallback chain without roles downgrades to plain (no behaviour change beyond the visual)', () => {
  const input = chainScene();
  // Cause structure with a linear chain projects to flow; roles stay item.
  const flow = fallbackBoard(input);
  assert.equal(flow.layout, 'flow');
  assert.equal(flow.visual.kind, 'plain');
});

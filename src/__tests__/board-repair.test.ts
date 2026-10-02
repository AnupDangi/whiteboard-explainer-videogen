import test from 'node:test';
import assert from 'node:assert/strict';
import { repairRawBoard } from '../planner/boardRepair.js';

const ctx = { requiredConceptCount: 4, maxLabelWords: 3 };
const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, mention: 'm', concept: 'c', representation: { kind: 'literal' }, label: 'a', role: 'item', ...extra });

test('unknown representation values become literal and facts are untouched', () => {
  const { board, repairs } = repairRawBoard({ layout: 'flow', nodes: [node('n1', { representation: { kind: 'semantic-role', role: 'made-up' } }), node('n2', { representation: { kind: 'zzz' } }), node('n3', { representation: { kind: 'semantic-role', role: 'gate' } })], visual: { kind: 'process' } }, ctx);
  const nodes = (board as { nodes: Array<{ representation: { kind: string; role?: string }; concept: string; mention: string }> }).nodes;
  assert.deepEqual(nodes.map((n) => n.representation.kind), ['literal', 'literal', 'semantic-role']);
  assert.ok(nodes.every((n) => n.concept === 'c' && n.mention === 'm'));
  assert.equal(repairs.length, 3, 'two enum repairs plus the missing process role');
});

test('compare with more nodes or concepts than it can hold becomes a layout that fits, with matching visual form', () => {
  const four = repairRawBoard({ layout: 'compare', nodes: [node('n1'), node('n2'), node('n3'), node('n4')], visual: { kind: 'comparison' } }, ctx).board as { layout: string; visual: { kind: string } };
  assert.equal(four.layout, 'fan_out');
  assert.equal(four.visual.kind, 'process');
  const two = repairRawBoard({ layout: 'compare', nodes: [node('n1'), node('n2')], visual: { kind: 'comparison' } }, { requiredConceptCount: 2, maxLabelWords: 3 }).board as { layout: string };
  assert.equal(two.layout, 'compare');
});

test('missing visual and process role get safe defaults; long labels are shortened', () => {
  const { board } = repairRawBoard({ layout: 'flow', nodes: [node('n1', { label: 'one two three four five six' }), node('n2'), node('n3')] }, ctx);
  const repaired = board as { visual: { kind: string }; nodes: Array<{ role: string; label: string }> };
  assert.equal(repaired.visual.kind, 'process');
  assert.equal(repaired.nodes.filter((n) => n.role === 'process').length, 1);
  assert.equal(repaired.nodes[0]!.label, 'one two three');
});

import { pruneLateTargets } from '../planner/board.js';
import { makeScene as makeSceneForPrune, goodBoard as goodBoardForPrune, WORDS as WORDS_FOR_PRUNE } from './support/boardScene.js';

test('pruneLateTargets drops claim targets spoken after the claim sentence ends, keeps claims with nothing earlier', () => {
  const raw = '[[m_a|flour]] and [[m_b|water]] go in. Then [[m_p|mixing]] makes [[m_o|dough]].';
  const plain = 'flour and water go in. Then mixing makes dough.';
  const input = { ...makeSceneForPrune(WORDS_FOR_PRUNE), raw, plainText: plain, claimSpans: [{ claimId: 'c1', exactText: 'flour and water go in.', plainStart: 0, plainEnd: 22 }, { claimId: 'c2', exactText: 'Then mixing makes dough.', plainStart: 23, plainEnd: 47 }] };
  const target = (elementId: string) => ({ kind: 'element' as const, elementId, evidenceSpanIds: ['x'] });
  const board = { ...goodBoardForPrune(), visualIntents: [{ claimId: 'c1', strategy: 'literal' as const, targets: [target('n1'), target('n2'), target('n4')] }, { claimId: 'c2', strategy: 'literal' as const, targets: [target('n1')] }] };
  const pruned = pruneLateTargets(board, input as never);
  assert.deepEqual(pruned.visualIntents![0]!.targets.map((item) => (item as { elementId: string }).elementId), ['n1', 'n2']);
  assert.equal(pruned.visualIntents![1]!.targets.length, 1);
});

test('repairRawBoard infers or drops claim targets whose kind the schema cannot read', () => {
  const board = { layout: 'flow', visual: { kind: 'process' }, nodes: [], visualIntents: [{ claimId: 'c', strategy: 'literal', targets: [{ elementId: 'n1', evidenceSpanIds: ['x'] }, { fromElementId: 'n1', toElementId: 'n2', relationType: 'causes', evidenceSpanIds: ['x'] }, { kind: 'element', elementId: 'n2', evidenceSpanIds: ['x'] }, { note: 'nothing usable' }] }] };
  const { board: out, repairs } = repairRawBoard(board, { requiredConceptCount: 2, maxLabelWords: 4 });
  const targets = ((out as { visualIntents: Array<{ targets: Array<{ kind: string }> }> }).visualIntents[0]!).targets;
  assert.deepEqual(targets.map((target) => target.kind), ['element', 'edge', 'element']);
  assert.ok(repairs.some((repair) => /target kinds/.test(repair)));
});

import { completeEdgeIntents } from '../planner/board.js';

test('completeEdgeIntents adds the depicting edge target a claim forgot', () => {
  const input = makeSceneForPrune(WORDS_FOR_PRUNE);
  const relation = input.teachingContext!.relations![0]!;
  const claim = { id: 'c1', statement: 'x', conceptIds: [relation.from, relation.to], relations: [{ from: relation.from, to: relation.to, type: relation.type }], evidenceSpanIds: ['span_a'] };
  const withClaim = { ...input, planningContext: { ...input.planningContext!, sceneContract: { ...input.planningContext!.sceneContract, essentialClaims: [claim] } } } as typeof input;
  const bare = { ...goodBoardForPrune(), visualIntents: [] };
  assert.equal(completeEdgeIntents(bare, withClaim), bare, 'a claim with no intent still goes to repair');
  const board = { ...goodBoardForPrune(), visualIntents: [{ claimId: 'c1', strategy: 'literal' as const, targets: [{ kind: 'element' as const, elementId: 'n1', evidenceSpanIds: ['span_a'] }] }] };
  const done = completeEdgeIntents(board, withClaim);
  const edge = done.visualIntents![0]!.targets.find((target) => target.kind === 'edge') as { fromElementId: string; toElementId: string } | undefined;
  assert.ok(edge, 'edge target added');
  assert.equal(done.visualIntents!.length, 1);
  // Idempotent: a second pass adds nothing.
  assert.equal(completeEdgeIntents(done, withClaim), done);
});

test('repairRawBoard keeps a structured picture when the layout is compare, and still pairs compare with the comparison form for process boards', () => {
  const context = { requiredConceptCount: 2, maxLabelWords: 4 };
  const geometry = repairRawBoard({ layout: 'compare', visual: { kind: 'geometry', shape: 'rightTriangle', illustrative: true }, nodes: [{ id: 'n1' }, { id: 'n2' }] }, context).board as { layout: string; visual: { kind: string } };
  assert.equal(geometry.visual.kind, 'geometry');
  assert.equal(geometry.layout, 'list');
  const process = repairRawBoard({ layout: 'compare', visual: { kind: 'process' }, nodes: [{ id: 'n1' }, { id: 'n2' }] }, context).board as { layout: string; visual: { kind: string } };
  assert.equal(process.visual.kind, 'comparison');
});

test('repairRawBoard turns a target of kind "visual" into the element "visual"', () => {
  const board = { layout: 'flow', visual: { kind: 'formula', latex: 'x' }, nodes: [], visualIntents: [{ claimId: 'c', strategy: 'quantitative', targets: [{ kind: 'visual', evidenceSpanIds: ['s'] }] }] };
  const { board: out } = repairRawBoard(board, { requiredConceptCount: 1, maxLabelWords: 4 });
  const target = (out as { visualIntents: Array<{ targets: Array<Record<string, unknown>> }> }).visualIntents[0]!.targets[0]!;
  assert.deepEqual({ kind: target.kind, elementId: target.elementId }, { kind: 'element', elementId: 'visual' });
});

test('repairRawBoard turns a convergence board without an output or a single process into a flow', () => {
  const context = { requiredConceptCount: 3, maxLabelWords: 4 };
  const noOutput = repairRawBoard({ layout: 'convergence', visual: { kind: 'process' }, nodes: [{ id: 'n1', role: 'input' }, { id: 'n2', role: 'input' }, { id: 'n3', role: 'process' }] }, context).board as { layout: string };
  assert.equal(noOutput.layout, 'flow');
  const complete = repairRawBoard({ layout: 'convergence', visual: { kind: 'process' }, nodes: [{ id: 'n1', role: 'input' }, { id: 'n2', role: 'process' }, { id: 'n3', role: 'output' }] }, context).board as { layout: string };
  assert.equal(complete.layout, 'convergence');
});

import { boardSchema, boardEnums as boardEnumsForSchema } from '../planner/board.js';

test('the provider-facing board schema repairs unknown enums and surplus targets before the strict parse', () => {
  const scene = makeSceneForPrune(WORDS_FOR_PRUNE);
  const enums = boardEnumsForSchema(scene);
  const board = goodBoardForPrune();
  const raw = {
    ...board,
    nodes: board.nodes.map((node, index) => (index === 0 ? { ...node, representation: { kind: 'semantic-role', role: 'definitely-not-a-role' } } : node)),
    visualIntents: [{ claimId: 'c', strategy: 'literal', targets: Array.from({ length: 15 }, () => ({ kind: 'element', elementId: 'n1', evidenceSpanIds: ['x'] })) }],
  };
  assert.equal(boardSchema(enums).safeParse(raw).success, false, 'the strict schema alone rejects it');
  const repaired = boardSchema(enums, { requiredConceptCount: 4, maxLabelWords: 4 }).safeParse(raw);
  assert.ok(repaired.success, repaired.success ? '' : JSON.stringify(repaired.error.issues));
});

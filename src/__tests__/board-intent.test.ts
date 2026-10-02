import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { Board } from '../planner/board.js';
import { buildBoardPrompt } from '../planner/board.js';
import { BOARD_EXAMPLES } from '../planner/fewshots/boardBank.v2.js';
import { compileBoard, BOARD_SCHEMA_VERSION } from '../planner/board.js';
import { safeParseSceneSpec } from '../shared/schema.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { renderSceneBody } from '../render/renderScene.js';
import type { Timeline } from '../shared/types.js';

test('S6 few-shots expose only typed representation intents, never legacy asset names', () => {
  const prompt = buildBoardPrompt(makeInput(['grain', 'liquid', 'change', 'mixture'], 14));
  assert.doesNotMatch(prompt.user, /\"(?:icon|iconSuggestions)\"\s*:/);
  assert.doesNotMatch(prompt.user, /calendar|fire-nature|delivery-truck|magnifying glass/);
  for (const example of BOARD_EXAMPLES) {
    assert.equal(example.board.schemaVersion, BOARD_SCHEMA_VERSION);
    for (const node of example.board.nodes) {
      assert.ok('representation' in node);
      assert.ok(!('icon' in node));
      assert.ok(node.representation.kind);
    }
  }
});

function makeInput(ids: string[], value: number): PlannerSceneInput {
  const [sourceA, sourceB, process, result] = ids;
  const mkRef = (id: string, quote: string, start: number) => ({
    sourceId: `doc-${ids[0]}`, spanId: `${id}-${ids[0]}`, startChar: start, endChar: start + quote.length, startLine: 1, endLine: 1, quote,
  });
  const first = mkRef('first', `${sourceA} ${value} feeds ${process}`, 0);
  const second = mkRef('second', `${process} produces ${result}`, 80);
  const concepts = [sourceA, sourceB, process, result].map((id) => ({
    id, label: id, kind: 'entity', definition: `${id} definition`, evidenceRefs: [first, second],
  }));
  return {
    sceneId: `scene-${ids[0]}`,
    raw: '',
    plainText: `${sourceA} and ${sourceB} enter ${process}, then ${result}.`,
    mentions: ids.map((id, index) => ({ id: `m${index}`, phrase: id })),
    teachingContext: {
      requireEvidence: true,
      sourceId: first.sourceId,
      displayText: `${process} and ${result}`,
      sourceEvidenceRefs: [first, second],
      concepts,
      relations: [
        { from: sourceA, to: process, type: 'feeds', evidenceRefs: [first] },
        { from: process, to: result, type: 'produces', evidenceRefs: [second] },
      ],
    },
    planningContext: {
      sceneContract: { requiredConceptIds: [sourceA, process, result], requiredRelations: [{ from: sourceA, to: process, type: 'feeds' }, { from: process, to: result, type: 'produces' }] },
      lessonBible: { persistentConceptIds: [], terminology: [] },
    } as unknown as PlannerSceneInput['planningContext'],
  };
}

function makeProcessBoard(ids: string[]): Board {
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    title: 'A changing system',
    layout: 'flow',
    visual: { kind: 'process' },
    nodes: ids.map((id, index) => ({ id: `n${index + 1}`, mention: `m${index}`, concept: id, representation: { kind: 'labelled' }, label: id, role: (['input', 'input', 'process', 'output'] as const)[index]! })),
  };
}

test('S6 compiles source-derived board intent and retains it through resolve and layout', () => {
  const ids = ['grain', 'liquid', 'change', 'mixture'];
  const input = makeInput(ids, 14);
  const { spec, problems } = compileBoard(makeProcessBoard(ids), input);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.boardIntent, {
    schemaVersion: 'typed-board-intent/v4-layout-recipes',
    layout: 'flow',
    visualKind: 'process',
    roles: [
      { elementId: 'n1', role: 'input' }, { elementId: 'n2', role: 'input' },
      { elementId: 'n3', role: 'process' }, { elementId: 'n4', role: 'output' },
    ],
    requiredConceptIds: ['grain', 'change', 'mixture'],
    requiredRelations: [
      { from: 'grain', to: 'change', type: 'feeds', evidenceRefs: input.teachingContext!.relations![0]!.evidenceRefs },
      { from: 'change', to: 'mixture', type: 'produces', evidenceRefs: input.teachingContext!.relations![1]!.evidenceRefs },
    ],
    visualIntents: [],
  });
  // Geometry carries the relationship; no verb label is emitted, the type itself stays in the intent.
  assert.deepEqual(spec.edges.map((edge) => edge.label ?? null), [null, null]);
  assert.ok(safeParseSceneSpec(spec).success);
  const resolved = resolveScene(spec);
  const laidOut = layoutScene(resolved);
  assert.deepEqual(resolved.boardIntent, spec.boardIntent);
  assert.deepEqual(laidOut.boardIntent, spec.boardIntent);
});

test('topic and numeric value changes preserve the typed intent contract without copying old facts', () => {
  const firstIds = ['grain', 'liquid', 'change', 'mixture'];
  const secondIds = ['signal', 'noise', 'filter', 'output'];
  const first = compileBoard(makeProcessBoard(firstIds), makeInput(firstIds, 14)).spec;
  const second = compileBoard(makeProcessBoard(secondIds), makeInput(secondIds, 37)).spec;
  assert.deepEqual(first.boardIntent?.roles.map(({ role }) => role), second.boardIntent?.roles.map(({ role }) => role));
  assert.deepEqual(first.boardIntent?.requiredRelations.map(({ type }) => type), second.boardIntent?.requiredRelations.map(({ type }) => type));
  assert.deepEqual(first.boardIntent?.requiredConceptIds, firstIds.filter((id) => ['grain', 'change', 'mixture'].includes(id)));
  assert.deepEqual(second.boardIntent?.requiredConceptIds, secondIds.filter((id) => ['signal', 'filter', 'output'].includes(id)));
  assert.ok(!JSON.stringify(second).includes('grain'));
  assert.ok(!JSON.stringify(second).includes('14'));
});

test('board intent roles are retained for gates but never rendered as visual badges', () => {
  // Concept ids are chosen so none literally contains "input"/"process"/"output":
  // this must fail only on a rendered role badge, never on a node's own visible label.
  const ids = ['grain', 'liquid', 'change', 'mixture'];
  const { spec } = compileBoard(makeProcessBoard(ids), makeInput(ids, 6));
  const scene = layoutScene(resolveScene(spec));
  // Roles still live in boardIntent, so board-role-* gates (validation/gates.ts) keep working.
  assert.deepEqual(scene.boardIntent?.roles.map((role) => role.role), ['input', 'input', 'process', 'output']);
  const events: Timeline['events'] = scene.elements.map((element) => ({ elementId: element.id, track: 'wipe', t0: 0, t1: 1000 }));
  scene.edges.forEach((edge, edgeIndex) => events.push({ elementId: edge.from, track: 'edge', edgeIndex, t0: 0, t1: 1000 }));
  const timeline: Timeline = { sceneId: scene.sceneId, events, sceneStartMs: 0, sceneEndMs: 1000 };
  const svg = renderSceneBody(scene, timeline, 1000);
  for (const role of ['INPUT', 'PROCESS', 'OUTPUT']) assert.ok(!svg.includes(`>${role}</text>`), `${role} badge must not be rendered (Simi never shows role chips)`);
  for (const relation of ['FEEDS INTO', 'PRODUCES']) assert.ok(!svg.includes(`>${relation}</text>`), `${relation} verb must not be rendered (geometry carries the relation)`);
});

test('comparison intent no longer draws a "VS" divider cue', () => {
  const ids = ['left_fact', 'right_fact'];
  const refs = ids.map((id, index) => ({ sourceId: 'compare-doc', spanId: `span-${id}`, startChar: index * 20, endChar: index * 20 + id.length, startLine: 1, endLine: 1, quote: id }));
  const input: PlannerSceneInput = {
    sceneId: 'comparison-scene', raw: '', plainText: ids.join(' versus '),
    mentions: ids.map((id, index) => ({ id: `m${index}`, phrase: id })),
    teachingContext: {
      sourceId: 'compare-doc', sourceEvidenceRefs: refs, concepts: ids.map((id, index) => ({ id, label: id, kind: 'entity', definition: id, evidenceRefs: [refs[index]!] })), relations: [],
    },
    planningContext: {
      sceneContract: { requiredConceptIds: ids, requiredRelations: [] },
      lessonBible: { persistentConceptIds: [], terminology: [] },
    } as unknown as PlannerSceneInput['planningContext'],
  };
  const board: Board = {
    schemaVersion: BOARD_SCHEMA_VERSION,
    title: 'Compare alternatives', layout: 'compare', visual: { kind: 'comparison' },
    nodes: ids.map((id, index) => ({ id: `n${index + 1}`, mention: `m${index}`, concept: id, representation: { kind: 'labelled' }, label: id, role: 'item' })),
  };
  const { spec } = compileBoard(board, input);
  assert.equal(spec.boardIntent?.visualKind, 'comparison');
  const scene = layoutScene(resolveScene(spec));
  const timeline: Timeline = { sceneId: scene.sceneId, events: [], sceneStartMs: 0, sceneEndMs: 1000 };
  const svg = renderSceneBody(scene, timeline, 650);
  assert.ok(!svg.includes('>VS</text>'), 'reference frames never draw a "VS" divider cue');
});

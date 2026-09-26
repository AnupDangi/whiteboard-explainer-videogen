import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { Board } from '../planner/board.js';
import { compileBoard, BOARD_SCHEMA_VERSION } from '../planner/board.js';
import { safeParseSceneSpec } from '../schema.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { renderSceneBody } from '../render/renderScene.js';
import type { Timeline } from '../types.js';
import { STYLE } from '../style.js';

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
    nodes: ids.map((id, index) => ({ id: `n${index + 1}`, mention: `m${index}`, concept: id, icon: 'label', label: id, role: (['input', 'input', 'process', 'output'] as const)[index]! })),
  };
}

test('S6 compiles source-derived board intent and retains it through resolve and layout', () => {
  const ids = ['grain', 'liquid', 'change', 'mixture'];
  const input = makeInput(ids, 14);
  const { spec, problems } = compileBoard(makeProcessBoard(ids), input);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.boardIntent, {
    schemaVersion: 'typed-board-intent/v1',
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
  });
  assert.deepEqual(spec.edges.map((edge) => edge.label), ['feeds', 'produces']);
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

test('deterministic rendering emits generic process roles and source relation labels from board intent', () => {
  const ids = ['input_a', 'input_b', 'operation', 'output'];
  const { spec } = compileBoard(makeProcessBoard(ids), makeInput(ids, 6));
  const scene = layoutScene(resolveScene(spec));
  const events: Timeline['events'] = scene.elements.map((element) => ({ elementId: element.id, track: 'wipe', t0: 0, t1: 1000 }));
  scene.edges.forEach((edge, edgeIndex) => events.push({ elementId: edge.from, track: 'edge', edgeIndex, t0: 0, t1: 1000 }));
  const timeline: Timeline = { sceneId: scene.sceneId, events, sceneStartMs: 0, sceneEndMs: 1000 };
  const svg = renderSceneBody(scene, timeline, 1000);
  for (const role of ['INPUT', 'PROCESS', 'OUTPUT']) assert.ok(svg.includes(`>${role}</text>`), role);
  for (const relation of ['FEEDS', 'PRODUCES']) assert.ok(svg.includes(`>${relation}</text>`), relation);
  const processNode = scene.elements.find((element) => element.id === 'n3')!;
  const roleBadgeY = processNode.bbox.y - STYLE.font.sizes.note - 24;
  assert.ok(roleBadgeY + STYLE.font.sizes.note + 16 < processNode.bbox.y, 'process role badge must sit clear of the node content box');
  assert.ok(svg.includes(`y="${roleBadgeY}"`), 'renderer should place the role badge above its node');
});

test('comparison intent gets a generic visual divider cue without source-specific copy', () => {
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
    nodes: ids.map((id, index) => ({ id: `n${index + 1}`, mention: `m${index}`, concept: id, icon: 'label', label: id, role: 'item' })),
  };
  const { spec } = compileBoard(board, input);
  const scene = layoutScene(resolveScene(spec));
  const timeline: Timeline = { sceneId: scene.sceneId, events: [], sceneStartMs: 0, sceneEndMs: 1000 };
  const svg = renderSceneBody(scene, timeline, 650);
  assert.ok(svg.includes('>VS</text>'));
});

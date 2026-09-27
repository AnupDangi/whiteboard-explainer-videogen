import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceReference } from '../../shared/contracts.js';
import type { LaidOutScene } from '../types.js';
import { labelOnlyProcessWarnings, typedBoardAdequacyFailures } from '../validation/gates.js';

const evidence = (spanId: string, quote: string): EvidenceReference => ({
  sourceId: 'source-document', spanId, startChar: 0, endChar: quote.length, startLine: 1, endLine: 1, quote,
});

const inputToProcess = evidence('span-input-process', 'material enters operation');
const processToOutput = evidence('span-process-output', 'operation produces result');

function makeScene(options: { template?: LaidOutScene['template']; slots?: Array<string | undefined>; omitConcept?: string; omitSecondRelation?: boolean; invalidEvidence?: boolean } = {}): LaidOutScene {
  const slots = options.slots ?? ['input', 'operator', 'output'];
  const concepts = ['material', 'operation', 'result'];
  const elements = concepts.flatMap((conceptId, index) => conceptId === options.omitConcept ? [] : [{
    id: `n${index + 1}`,
    element: { id: `n${index + 1}`, prim: 'text', text: conceptId, size: 'body', anchor: 'sceneStart', slot: slots[index], conceptIds: [conceptId] },
    visual: { paths: [], fills: [], texts: [] },
    intrinsicSize: { w: 20, h: 20 }, strokeLength: 0,
    bbox: { x: index * 30, y: 0, w: 20, h: 20 },
  }]);
  const edges = [
    {
      from: 'n1', to: 'n2', points: [], evidenceRefs: [inputToProcess],
      factualRelation: { fromConceptId: 'material', toConceptId: 'operation', type: 'feeds', evidenceRefs: [options.invalidEvidence ? processToOutput : inputToProcess] },
    },
    ...(!options.omitSecondRelation ? [{
      from: 'n2', to: 'n3', points: [], evidenceRefs: [processToOutput],
      factualRelation: { fromConceptId: 'operation', toConceptId: 'result', type: 'produces', evidenceRefs: [processToOutput] },
    }] : []),
  ];
  return {
    sceneId: 'scene', title: 'A topic neutral process', template: options.template ?? 'convergence',
    elements, edges, occupancy: 0.5, carryOver: [], focus: [],
    boardIntent: {
      schemaVersion: 'typed-board-intent/v1', layout: 'convergence', visualKind: 'process',
      roles: [
        { elementId: 'n1', role: 'input' },
        { elementId: 'n2', role: 'process' },
        { elementId: 'n3', role: 'output' },
      ],
      requiredConceptIds: ['material', 'operation', 'result'],
      requiredRelations: [
        { from: 'material', to: 'operation', type: 'feeds', evidenceRefs: [inputToProcess] },
        { from: 'operation', to: 'result', type: 'produces', evidenceRefs: [processToOutput] },
      ],
    },
  } as unknown as LaidOutScene;
}

test('typed-board adequacy accepts source-cited relation coverage and complete convergence roles', () => {
  assert.deepEqual(typedBoardAdequacyFailures(makeScene()), []);
});

test('text-only process relations get a review warning without invalidating source-backed boards', () => {
  const scene = makeScene();
  assert.deepEqual(typedBoardAdequacyFailures(scene), []);
  const warnings = labelOnlyProcessWarnings(scene);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.code === 'board-label-only-process' && !warning.hard));
  scene.elements[0]!.element = { id: 'n1', prim: 'shape', kind: 'circle', text: 'material', anchor: 'sceneStart', slot: 'input', conceptIds: ['material'] };
  assert.equal(labelOnlyProcessWarnings(scene).length, 1);
});

test('typed-board adequacy hard-fails a missing source relation even when its concepts remain present', () => {
  const failures = typedBoardAdequacyFailures(makeScene({ omitSecondRelation: true }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.code, 'board-relation-omitted');
  assert.equal(failures[0]?.hard, true);
  assert.match(failures[0]?.message ?? '', /operation -\[produces\]-> result/);
});

test('typed-board adequacy requires relation evidence to match the cited source relation', () => {
  const failures = typedBoardAdequacyFailures(makeScene({ invalidEvidence: true }));
  assert.ok(failures.some((failure) => failure.code === 'board-relation-omitted' && failure.message.includes('material -[feeds]-> operation')));
});

test('typed-board adequacy hard-fails missing required concepts and incomplete preserved roles', () => {
  const failures = typedBoardAdequacyFailures(makeScene({ slots: ['input', undefined, 'output'] }));
  assert.ok(failures.some((failure) => failure.code === 'board-role-incomplete' && failure.hard));
  const missingConcept = typedBoardAdequacyFailures(makeScene({ omitConcept: 'result' }));
  assert.ok(missingConcept.some((failure) => failure.code === 'board-concept-omitted'));
});

test('generic chain boards are checked against source relations without inventing roles lost by the scene schema', () => {
  const scene = makeScene({ template: 'chain', slots: ['node', 'node', 'node'] });
  scene.boardIntent!.layout = 'flow';
  const failures = typedBoardAdequacyFailures(scene);
  assert.deepEqual(failures, []);
});

test('typed-board adequacy detects role metadata detached from visible concept nodes', () => {
  const scene = makeScene();
  scene.boardIntent!.roles[1] = { elementId: 'missing-node', role: 'process' };
  const failures = typedBoardAdequacyFailures(scene);
  assert.ok(failures.some((failure) => failure.code === 'board-role-detached' && failure.hard));
});

test('typed-board adequacy detects a retained convergence role placed in the wrong visible slot', () => {
  const scene = makeScene();
  scene.elements[1]!.element.slot = 'input';
  const failures = typedBoardAdequacyFailures(scene);
  assert.ok(failures.some((failure) => failure.code === 'board-role-misplaced' && failure.message.includes('process role n2')));
});

test('legacy scenes without retained board intent remain backward compatible', () => {
  const scene = makeScene();
  delete scene.boardIntent;
  assert.deepEqual(typedBoardAdequacyFailures(scene), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBoard, validateBoard } from '../planner/board.js';
import { makeScene, goodBoard, WORDS } from './support/boardScene.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';

const scene = makeScene(WORDS);
const withVisual = (visual: unknown) => ({ ...goodBoard(), visual }) as never;

test('an illustrative array compiles to a tokenStrip with highlights and an Illustrative example label', () => {
  const board = withVisual({ kind: 'array', tokens: ['3', '8', '12', '19', '27', '35'], highlight: [3], illustrative: true });
  const checked = validateBoard(board, scene);
  assert.ok(!checked.problems.some((problem) => /array|absent from the scene/.test(problem)), checked.problems.join(' | '));
  const compiled = compileBoard(board, scene);
  const strip = compiled.spec.elements.find((element) => element.prim === 'tokenStrip') as { tokens: string[]; highlight?: number[]; origin?: string } | undefined;
  assert.deepEqual(strip?.tokens, ['3', '8', '12', '19', '27', '35']);
  assert.deepEqual(strip?.highlight, [3]);
  assert.equal(strip?.origin, 'illustrative-example');
  assert.ok(compiled.spec.elements.some((element) => element.id === 'example-label'));
  const laid = layoutScene(resolveScene(compiled.spec));
  assert.ok(laid.elements.some((element) => element.element.prim === 'tokenStrip'));
});

test('a non-illustrative array must be grounded: values absent from the cited evidence are a problem; a bad highlight index too', () => {
  const grounded = validateBoard(withVisual({ kind: 'array', tokens: ['41', '97'], illustrative: false }), scene).problems.join(' | ');
  assert.match(grounded, /absent from the scene/);
  const badIndex = validateBoard(withVisual({ kind: 'array', tokens: ['a', 'b'], highlight: [5], illustrative: true }), scene).problems.join(' | ');
  assert.match(badIndex, /highlight index 5/);
});

test('a geometry figure compiles to a shape with side labels', () => {
  const board = withVisual({ kind: 'geometry', shape: 'rightTriangle', sideLabels: ['a', 'b', 'c'], illustrative: true });
  const compiled = compileBoard(board, scene);
  const shape = compiled.spec.elements.find((element) => element.id === 'visual') as { prim: string; kind?: string; sideLabels?: string[] } | undefined;
  assert.equal(shape?.prim, 'shape');
  assert.equal(shape?.kind, 'rightTriangle');
  assert.deepEqual(shape?.sideLabels, ['a', 'b', 'c']);
});

test('a scene contract that requires an array makes any other visual kind a repairable problem', () => {
  const input = makeScene(WORDS);
  const bound = { ...input, planningContext: { ...input.planningContext!, sceneContract: { ...input.planningContext!.sceneContract, visualForm: 'array' } } } as typeof input;
  const wrong = validateBoard(goodBoard(), bound).problems.join(' | ');
  assert.match(wrong, /scene contract requires visual\.kind "array"/);
  const right = validateBoard({ ...goodBoard(), visual: { kind: 'array', tokens: ['1', '2'], illustrative: true } } as never, bound).problems.join(' | ');
  assert.doesNotMatch(right, /scene contract requires/);
});

import { withDerivedIllustrativeFlag } from '../planner/board.js';
test('the illustrative flag is derived from the evidence, never trusted from the model', () => {
  const claimsFalse = { ...goodBoard(), visual: { kind: 'array', tokens: ['41', '97'], illustrative: false } } as never;
  const flagged = withDerivedIllustrativeFlag(claimsFalse, scene) as { visual: { illustrative: boolean } };
  assert.equal(flagged.visual.illustrative, true, 'values absent from the evidence are an example');
  const quote = scene.teachingContext!.sourceEvidenceRefs![0]!.quote;
  const word = quote.split(/\s+/)[0]!.toLowerCase();
  const grounded = { ...goodBoard(), visual: { kind: 'array', tokens: [word, word], illustrative: true } } as never;
  assert.equal((withDerivedIllustrativeFlag(grounded, scene) as { visual: { illustrative: boolean } }).visual.illustrative, false);
  const checked = validateBoard(claimsFalse, scene, { normalizeInstances: true }).problems.join(' | ');
  assert.doesNotMatch(checked, /absent from the scene/);
});

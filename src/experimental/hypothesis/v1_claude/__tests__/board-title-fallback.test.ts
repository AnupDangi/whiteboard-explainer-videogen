import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { compileBoard, fallbackBoard, validateBoard } from '../planner/board.js';
import { typedBoardAdequacyFailures } from '../validation/gates.js';
import { numericClaims, unsupportedNumericClaims } from '../validation/numericClaims.js';
import { goodBoard, makeScene } from './support/boardScene.js';

// Two unrelated synthetic vocabularies through the same code paths (topic-swap rule, CLAUDE.md).
const TOPICS = [
  { words: { a: 'flour', b: 'water', p: 'mixing', o: 'dough' }, prefix: 'src' },
  { words: { a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, prefix: 'alt' },
];

test('number words and digits are one kind of numeric claim', () => {
  assert.deepEqual(numericClaims('Three modes, 3 cases, 40% share').map((claim) => [claim.value, claim.unit ?? '']), [[3, ''], [40, '%'], [3, '']]);
  assert.deepEqual(unsupportedNumericClaims(['Three Reasoning Modes'], ['reasoning has modes']), ['Three']);
  assert.deepEqual(unsupportedNumericClaims(['Three Reasoning Modes'], ['the three reasoning modes']), []);
  assert.deepEqual(unsupportedNumericClaims(['0.4 of the budget'], ['40% of the budget']), []);
});

for (const { words, prefix } of TOPICS) {
  const withHeading = (displayText: string): PlannerSceneInput => {
    const scene = makeScene(words, prefix);
    return { ...scene, teachingContext: { ...scene.teachingContext!, displayText } };
  };

  test(`a number-word heading the evidence does not state falls back to the model title (${prefix})`, () => {
    // Live failure 2026-09-27: "Three Reasoning Modes" passed the digits-only title check and failed the scene gate.
    const scene = withHeading(`Three ${words.p} Steps`);
    const repaired = validateBoard({ ...goodBoard(words, prefix), title: `${words.p} makes ${words.o}` }, scene);
    assert.deepEqual(repaired.problems, []);
    assert.equal(repaired.spec!.title, `${words.p} makes ${words.o}`);
  });

  test(`a model title that repeats the unsupported number gets a repairable title problem (${prefix})`, () => {
    const scene = withHeading(`Three ${words.p} Steps`);
    const problems = validateBoard({ ...goodBoard(words, prefix), title: `Three ${words.p} Steps` }, scene).problems.join(' | ');
    assert.match(problems, /title numbers \[Three\] are not stated in the evidence/);
  });

  test(`a heading whose number the cited evidence states is kept (${prefix})`, () => {
    const scene = withHeading(`${words.p} Makes ${words.o}`);
    assert.equal(validateBoard(goodBoard(words, prefix), scene).spec!.title, `${words.p} Makes ${words.o}`);
  });

  test(`the fallback board never reuses a heading with an unsupported number and passes its own role gates (${prefix})`, () => {
    const scene = withHeading(`Three ${words.p} Steps`);
    const board = fallbackBoard(scene);
    assert.equal(numericClaims(board.title).length, 0, board.title);
    const compiled = compileBoard(board, scene);
    const adequacy = typedBoardAdequacyFailures({ ...compiled.spec, elements: compiled.spec.elements.map((element) => ({ id: element.id, element })) });
    assert.deepEqual(adequacy.filter((failure) => failure.code.startsWith('board-role')), []);
  });

  test(`a fallback whose centre has no outgoing relation is a hub, not a convergence without output (${prefix})`, () => {
    // Live failure 2026-09-27: two inputs point at one concept that points nowhere.
    const scene = makeScene(words, prefix);
    scene.teachingContext = { ...scene.teachingContext!, relations: (scene.teachingContext!.relations ?? []).filter((relation) => relation.to === `${prefix}_p`) };
    scene.planningContext = { ...scene.planningContext!, sceneContract: { ...scene.planningContext!.sceneContract!, requiredConceptIds: [`${prefix}_a`, `${prefix}_b`, `${prefix}_p`] } };
    const board = fallbackBoard(scene);
    assert.equal(board.layout, 'hub');
    const compiled = compileBoard(board, scene);
    const failures = typedBoardAdequacyFailures({ ...compiled.spec, elements: compiled.spec.elements.map((element) => ({ id: element.id, element })) });
    assert.deepEqual(failures.map((failure) => failure.code), []);
  });

  test(`a flow fallback marks one process node so its process visual is complete (${prefix})`, () => {
    const scene = makeScene(words, prefix);
    scene.teachingContext = { ...scene.teachingContext!, relations: [(scene.teachingContext!.relations ?? [])[2]] };
    scene.planningContext = { ...scene.planningContext!, sceneContract: { ...scene.planningContext!.sceneContract!, requiredConceptIds: [] } };
    const board = fallbackBoard(scene);
    assert.equal(board.layout, 'flow');
    assert.equal(board.nodes.filter((node) => node.role === 'process').length, 1);
  });

  test(`a missing convergence output reaches the model repair instead of failing only after S6 (${prefix})`, () => {
    const scene = makeScene(words, prefix);
    const board = goodBoard(words, prefix);
    board.nodes = board.nodes.map((node) => (node.role === 'output' ? { ...node, role: 'input' } : node));
    assert.match(validateBoard(board, scene).problems.join(' | '), /convergence typed board is missing at least one output/);
  });
}

test('a discarded model label is not validated: persistent concepts always draw their canonical term', () => {
  const scene = makeScene({ a: 'flour', b: 'water', p: 'mixing', o: 'dough' });
  const board = goodBoard();
  board.nodes[2] = { ...board.nodes[2], label: 'totally different wording here now' };
  const checked = validateBoard(board, scene);
  assert.deepEqual(checked.problems, []);
  const node = checked.spec!.elements.find((element) => element.id === 'n3')!;
  assert.equal(node.prim === 'box' ? node.text : node.label, 'mixing');
});

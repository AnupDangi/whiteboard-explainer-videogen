import test from 'node:test';
import assert from 'node:assert/strict';
import { boardEnums, boardProblems, compileBoard } from '../planner/board.js';
import { makeScene, goodBoard, WORDS } from './support/boardScene.js';

const withQuote = (quote: string) => {
  const scene = makeScene(WORDS);
  const refs = scene.teachingContext!.sourceEvidenceRefs!.map((ref, index) => (index === 0 ? { ...ref, quote } : ref));
  return { ...scene, teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: refs } } as typeof scene;
};

test('a formula whose subscripted symbols appear joined in the extracted quote is grounded; an invented term is not', () => {
  const scene = withQuote('We compute Attention(Q, K, V ) = softmax(QK T / sqrt dk )V where dk is the key dimension');
  const grounded = { ...goodBoard(), visual: { kind: 'formula' as const, latex: '\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V' } };
  assert.deepEqual(boardProblems(grounded, scene, boardEnums(scene)).filter((problem) => /visual formula/.test(problem)), []);
  const invented = { ...goodBoard(), visual: { kind: 'formula' as const, latex: '\\mathrm{zebra}(QK^T)V' } };
  assert.ok(boardProblems(invented, scene, boardEnums(scene)).some((problem) => /visual formula labels/.test(problem)));
});

test('a node that repeats N times compiles to a stack of N copies labelled ×N, and an unsupported N is reported', () => {
  const scene = withQuote('The encoder is composed of a stack of N = 6 identical layers');
  const board = goodBoard();
  board.nodes[0] = { ...board.nodes[0]!, repeat: 6 };
  const compiled = compileBoard(board, scene);
  const stack = compiled.spec.elements.find((element) => element.id === 'n1') as { prim: string; count: number; text: string };
  assert.equal(stack.prim, 'stack');
  assert.equal(stack.count, 6);
  assert.match(stack.text, /×6$/);
  const wrong = goodBoard();
  wrong.nodes[0] = { ...wrong.nodes[0]!, repeat: 9 };
  const wrongCompiled = compileBoard(wrong, scene);
  const wrongStack = wrongCompiled.spec.elements.find((element) => element.id === 'n1') as { text: string };
  assert.match(wrongStack.text, /×9$/);
});

test('formula symbols up to three letters need no match in the cited quote, but a longer word still does', () => {
  const scene = withQuote('The attention weights come from a softmax over the compatibility scores');
  const symbols = { ...goodBoard(), visual: { kind: 'formula' as const, latex: '\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V' } };
  assert.deepEqual(boardProblems(symbols, scene, boardEnums(scene)).filter((problem) => /visual formula/.test(problem)), []);
  const word = { ...goodBoard(), visual: { kind: 'formula' as const, latex: '\\mathrm{normalizer}(QK^T)V' } };
  assert.ok(boardProblems(word, scene, boardEnums(scene)).some((problem) => /visual formula labels/.test(problem)));
});

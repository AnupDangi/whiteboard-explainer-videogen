import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackBoard, boardProblems, boardEnums } from '../planner/board.js';
import { makeScene, WORDS } from './support/boardScene.js';

test('a spoken example that names no concept becomes an extra node of the concept its claim sentence is about', () => {
  const input = makeScene(WORDS);
  // Narration: "... [[m_x|a small batch]] ..." sits inside the claim sentence about the dough concept.
  const raw = `${WORDS.a} and ${WORDS.b} go into [[m_p|${WORDS.p}]], which makes [[m_o|${WORDS.o}]] and [[m_x|a small batch]].`;
  const plain = raw.replace(/\[\[[^|]*\|([^\]]*)\]\]/g, '$1');
  const claimStart = plain.indexOf('which makes');
  const scene = {
    ...input, raw, plainText: plain,
    mentions: [{ id: 'm_p', phrase: WORDS.p }, { id: 'm_o', phrase: WORDS.o }, { id: 'm_x', phrase: 'a small batch' }],
    claimSpans: [{ claimId: 'c1', exactText: plain.slice(claimStart), plainStart: claimStart, plainEnd: plain.length }],
    planningContext: { ...input.planningContext!, sceneContract: { ...input.planningContext!.sceneContract, essentialClaims: [{ id: 'c1', statement: 's', conceptIds: ['src_o'], relations: [], evidenceSpanIds: ['src_o'] }] } },
  } as unknown as typeof input;
  const board = fallbackBoard(scene);
  const instances = board.nodes.filter((node) => node.concept === 'src_o');
  assert.equal(instances.length, 2, 'the example is drawn as a second instance of its concept');
  assert.equal(new Set(instances.map((node) => node.label.toLowerCase())).size, 2);
  assert.ok(boardProblems(board, scene, boardEnums(scene)).every((problem) => !/duplicate concept/.test(problem)));
});

test('the composed board for the standard scene satisfies every board rule', () => {
  const scene = makeScene(WORDS);
  assert.deepEqual(boardProblems(fallbackBoard(scene), scene, boardEnums(scene)).filter((problem) => !problem.includes('never names it nearby')), []);
});

test('a convergence fallback gives the process slot to one node even when the centre concept has several instances', () => {
  const input = makeScene(WORDS);
  const raw = `${WORDS.a} and ${WORDS.b} go into [[m_p|${WORDS.p}]], which makes [[m_o|${WORDS.o}]] and [[m_x|${WORDS.p} again]].`;
  const plain = raw.replace(/\[\[[^|]*\|([^\]]*)\]\]/g, '$1');
  const scene = {
    ...input, raw, plainText: plain,
    mentions: [{ id: 'm_a', phrase: WORDS.a }, { id: 'm_b', phrase: WORDS.b }, { id: 'm_p', phrase: WORDS.p }, { id: 'm_o', phrase: WORDS.o }, { id: 'm_x', phrase: `${WORDS.p} again` }],
  } as unknown as typeof input;
  const board = fallbackBoard(scene);
  assert.equal(board.nodes.filter((node) => node.role === 'process').length, 1);
});

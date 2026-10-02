import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBoard } from '../planner/board.js';
import { makeScene, goodBoard } from './support/boardScene.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';

// final_plan/04 §9: a real architecture fix survives lexical perturbation. Same lesson structure, reworded entities.
const VARIANTS = [
  { a: 'flour', b: 'water', p: 'mixing', o: 'dough' },
  { a: 'current', b: 'resistor', p: 'heating', o: 'warmth' },
  { a: 'the tax rule', b: 'a small business', p: 'reviewing', o: 'the ruling' },
];

function signature(words: (typeof VARIANTS)[number]) {
  const compiled = compileBoard(goodBoard(words), makeScene(words));
  const resolved = resolveScene(compiled.spec);
  const laid = layoutScene(resolved);
  return {
    template: compiled.spec.template,
    prims: compiled.spec.elements.map((element) => element.prim),
    edges: compiled.spec.edges.map((edge) => [edge.from, edge.to, edge.factualRelation?.type]),
    anchored: compiled.spec.edges.every((edge) => Boolean(edge.anchor)),
    rungClasses: resolved.elements.map((element) => element.resolution?.strategy?.split('-')[0] ?? 'none'),
    inSafeArea: laid.elements.every((element) => element.bbox.x >= 0 && element.bbox.y >= 0),
  };
}

test('structure, relations and anchoring are identical across reworded entities', () => {
  const [first, ...rest] = VARIANTS.map(signature);
  assert.ok(first!.edges.length > 0 && first!.anchored);
  for (const other of rest) {
    assert.equal(other.template, first!.template);
    assert.deepEqual(other.prims, first!.prims);
    assert.deepEqual(other.edges, first!.edges);
    assert.equal(other.inSafeArea, true);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { routeEdges } from '../layout/edges.js';
import type { BBox, Edge } from '../shared/types.js';

const row = (n: number): Map<string, BBox> => new Map(Array.from({ length: n }, (_, i) => [`n${i + 1}`, { x: 120 + i * 300, y: 400, w: 200, h: 120 }] as const));
const crosses = (points: Array<{ x: number; y: number }>, box: BBox): boolean => {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!;
    for (let t = 0; t <= 1; t += 0.01) {
      const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t;
      if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) return true;
    }
  }
  return false;
};

test('an arrow between two nodes of one row never passes through the nodes between them', () => {
  const boxes = row(4);
  const [edge] = routeEdges([{ from: 'n1', to: 'n4' } as Edge], boxes);
  assert.ok(edge!.points.length >= 4, 'arcs over the row');
  for (const id of ['n2', 'n3']) assert.equal(crosses(edge!.points, boxes.get(id)!), false, `${id} crossed`);
});

test('an arrow between neighbours stays straight', () => {
  const [edge] = routeEdges([{ from: 'n1', to: 'n2' } as Edge], row(4));
  assert.equal(edge!.points.length, 2);
});

test('containers are not obstacles for arrows drawn inside them', () => {
  const boxes = row(2);
  boxes.set('c', { x: 80, y: 360, w: 740, h: 200 });
  const [edge] = routeEdges([{ from: 'n1', to: 'n2' } as Edge], boxes, new Set(['c']));
  assert.equal(edge!.points.length, 2);
});

import { polylineCrossesBox } from '../validate/gates.js';
test('the gate helper sees an arrow through a node and ignores a clear path', () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.equal(polylineCrossesBox([{ x: 0, y: 150 }, { x: 300, y: 150 }], box), true);
  assert.equal(polylineCrossesBox([{ x: 0, y: 50 }, { x: 300, y: 50 }], box), false);
});

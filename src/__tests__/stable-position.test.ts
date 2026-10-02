import test from 'node:test';
import assert from 'node:assert/strict';
import { stablePositionViolations } from '../harness/boardMetrics.js';

const el = (id: string, x: number, y: number) => ({ id, bbox: { x, y, w: 100, h: 60 } });
const scene = (elements: ReturnType<typeof el>[], carryOver: string[] = []) => ({ elements, carryOver } as never);

test('carried elements that keep their box are stable; moved ones are counted', () => {
  assert.equal(stablePositionViolations(scene([el('a', 10, 10)]), scene([el('a', 10, 11)], ['a'])), 0);
  assert.equal(stablePositionViolations(scene([el('a', 10, 10), el('b', 200, 10)]), scene([el('a', 10, 10), el('b', 260, 10)], ['a', 'b'])), 1);
  assert.equal(stablePositionViolations(undefined, scene([el('a', 1, 1)], ['a'])), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { boxLabelLines, measureElement } from '../layout/measure.js';

test('wrapped box labels ending in one round digit remain measurable', () => {
  for (const digit of ['3', '6', '8']) {
    const label = `ELECTROMAGNETISM ${digit}`;
    assert.deepEqual(boxLabelLines(label, 40), ['ELECTROMAGNETISM', digit]);
    const size = measureElement({ id: `digit-${digit}`, anchor: 'sceneStart', prim: 'box', text: label });
    assert.equal(size.h, 172);
    assert.ok(size.w >= 180);
  }
});

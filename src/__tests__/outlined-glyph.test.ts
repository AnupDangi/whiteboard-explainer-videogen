import test from 'node:test';
import assert from 'node:assert/strict';
import { asOutlinedGlyph } from '../assets/streamline.js';

const square = 'M0 0H10V10H0Z';

test('a solid single-colour glyph becomes an outline plus a pastel body; highlights stay white', () => {
  const out = asOutlinedGlyph({ strokes: [] as Array<{ d: string; len: number; w: number }>, fills: [{ d: square, role: 'ink' as const }, { d: 'M2 2H4V4H2Z', role: 'white' as const }] });
  assert.equal(out.strokes.length, 1, 'the dark fill is drawn first as an outline');
  assert.equal(out.strokes[0]!.d, square);
  assert.deepEqual(out.fills.map((fill) => fill.role), ['main', 'white']);
});

test('multi-colour icons and outline-stroke icons are left untouched', () => {
  const coloured = { strokes: [] as Array<{ d: string; len: number; w: number }>, fills: [{ d: square, role: 'main' as const, color: '#ff8899' }, { d: square, role: 'ink' as const }] };
  assert.equal(asOutlinedGlyph(coloured), coloured);
  const stroked = { strokes: [{ d: square, len: 40, w: 2 }], fills: [{ d: square, role: 'ink' as const }] };
  assert.equal(asOutlinedGlyph(stroked), stroked);
});

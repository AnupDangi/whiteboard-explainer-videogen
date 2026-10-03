import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_READABLE_FONT_PX, STYLE } from '../render/style.js';
import { fitFont, fitText, MIN_FONT } from '../visual-v2/layout/textFit.js';

test('V2 text fitting uses the shared 32px floor even when a caller requests smaller text', () => {
  assert.equal(MIN_FONT, MIN_READABLE_FONT_PX);
  assert.equal(MIN_FONT, 32);
  assert.ok(fitFont('short', 300, 30) >= MIN_READABLE_FONT_PX);
  const readable = fitText('A longer label that needs to wrap over several words', 220, 120, STYLE.font.sizes.body);
  if (readable.fits) assert.ok(readable.size >= MIN_READABLE_FONT_PX);
  assert.equal(fitText('short note', 300, 60, 30).size, MIN_READABLE_FONT_PX);
});

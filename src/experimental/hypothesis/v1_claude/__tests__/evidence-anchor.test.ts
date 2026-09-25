import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDocFromText } from '../plan/sourceDoc.js';
import { anchorQuote, normalizeForAnchor } from '../plan/evidenceAnchor.js';

const doc = sourceDocFromText('# Heat\n\nThe engine’s piston moves — then  the valve opens.\n\nPressure rises when the gas is heated.\n\nThe valve opens.\n\nThe valve opens.', 'markdown');
const spanWith = (needle: string) => doc.spans.find((s) => s.text.includes(needle))!.id;

test('exact quote anchors unchanged', () => {
  const hit = anchorQuote(doc, spanWith('Pressure'), 'Pressure rises when the gas is heated.');
  assert.equal(hit?.match, 'exact');
  assert.equal(hit?.ref.quote, 'Pressure rises when the gas is heated.');
});

test('typographic and whitespace drift anchors to the verbatim source substring', () => {
  const hit = anchorQuote(doc, spanWith('piston'), "The engine's piston moves - then the valve opens");
  assert.equal(hit?.match, 'normalized');
  assert.equal(hit?.ref.quote, 'The engine’s piston moves — then  the valve opens');
  assert.equal(doc.text.slice(hit!.ref.startChar, hit!.ref.endChar), hit!.ref.quote);
});

test('a unique verbatim quote cited under the wrong span is relocated', () => {
  const hit = anchorQuote(doc, spanWith('piston'), 'Pressure rises when the gas is heated');
  assert.equal(hit?.match, 'relocated');
  assert.equal(hit?.ref.spanId, spanWith('Pressure'));
});

test('ambiguous relocation is rejected', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'The valve opens.'), undefined);
});

test('short quotes are never relocated', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'the valve'), undefined);
});

test('paraphrase is never anchored', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'Heating the gas raises the pressure.'), undefined);
});

test('normalization map points back to original offsets', () => {
  const { normalized, map } = normalizeForAnchor('a’  b');
  assert.equal(normalized, "a' b");
  assert.deepEqual(map, [0, 1, 2, 4]);
});

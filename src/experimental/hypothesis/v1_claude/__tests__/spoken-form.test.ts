import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenForm } from '../narration/spokenForm.js';
import { parseMarkers } from '../narration/markers.js';

test('integers, decimals, percents, ordinals, years and signs become words', () => {
  assert.equal(spokenForm('The tide turns every 24 hours.'), 'The tide turns every twenty-four hours.');
  assert.equal(spokenForm('About 3.5% of water'), 'About three point five percent of water');
  assert.equal(spokenForm('the 2nd bulge'), 'the second bulge');
  assert.equal(spokenForm('In 1998 and 2024'), 'In nineteen ninety-eight and twenty twenty-four');
  assert.equal(spokenForm('1,250 kilometres'), 'one thousand two hundred fifty kilometres');
  assert.equal(spokenForm('-4 degrees'), 'minus four degrees');
  assert.equal(spokenForm('100'), 'one hundred');
});

test('markers survive and their phrases are normalized too', () => {
  const out = spokenForm('Every [[cycle|12 hours]] the [[moon|Moon]] pulls.');
  assert.equal(out, 'Every [[cycle|twelve hours]] the [[moon|Moon]] pulls.');
  const { plainText, mentions } = parseMarkers(out);
  assert.equal(plainText.slice(mentions[0].plainStart, mentions[0].plainEnd), 'twelve hours');
});

test('output has no ASCII digits and is deterministic', () => {
  const input = 'Values 0, 7, 19, 45, 999, 1000001 and 0.05';
  const a = spokenForm(input);
  assert.equal(a, spokenForm(input));
  assert.equal(/\d/.test(a), false, a);
});

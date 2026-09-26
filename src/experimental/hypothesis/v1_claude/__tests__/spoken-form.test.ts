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

test('digits glued to letters are split into words without merging or spurious minus signs', () => {
  assert.equal(spokenForm('CO2 levels rose sharply.'), 'CO two levels rose sharply.');
  assert.equal(spokenForm('H2O is water.'), 'H two O is water.');
  assert.equal(spokenForm('Run it with x2 speed.'), 'Run it with x two speed.');
  assert.equal(spokenForm('This is a 3D model.'), 'This is a three D model.');
  assert.equal(spokenForm('The distance is 10km away.'), 'The distance is ten km away.');
  assert.equal(spokenForm('See page 3a for details.'), 'See page three a for details.');
  // A hyphen joining letters to digits (e.g. a virus name) is not a minus sign.
  assert.equal(spokenForm('COVID-19 spread quickly.'), 'COVID-nineteen spread quickly.');
  // Existing behavior must be unaffected by the letter/digit split.
  assert.equal(spokenForm('the 2nd bulge'), 'the second bulge');
  assert.equal(spokenForm('About 3.5% of water'), 'About three point five percent of water');
  assert.equal(spokenForm('1,250 kilometres'), 'one thousand two hundred fifty kilometres');
  assert.equal(spokenForm('-4 degrees'), 'minus four degrees');
  assert.equal(spokenForm('In 1998 and 2024'), 'In nineteen ninety-eight and twenty twenty-four');
  const out = spokenForm('Every [[cycle|12 hours]] the [[moon|Moon]] pulls.');
  assert.equal(out, 'Every [[cycle|twelve hours]] the [[moon|Moon]] pulls.');
});

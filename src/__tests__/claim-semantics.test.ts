import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSemanticsFromText, claimSemanticsMismatch } from '../evidence/claims.js';

test('claim semantics extracts only explicit protected cues', () => {
  assert.deepEqual(claimSemanticsFromText('This is not safe during pregnancy.'), {
    polarity: 'negative', temporal: { relation: 'during' },
  });
  assert.deepEqual(claimSemanticsFromText('Voltage is less than 5 V.'), {
    polarity: 'positive', comparison: { operator: 'lt', value: 5 }, quantities: [{ value: 5, unit: 'V' }],
  });
  assert.deepEqual(claimSemanticsFromText('The process takes no more than five seconds.'), {
    polarity: 'positive', comparison: { operator: 'lte', value: 5 }, quantities: [{ value: 5, unit: 's' }],
  });
  assert.deepEqual(claimSemanticsFromText('Statement one_c takes 3 steps.').quantities, [{ value: 3 }]);
});

test('claim semantics flags explicit polarity, comparison, temporal, and quantity mutations', () => {
  assert.match(claimSemanticsMismatch('Not safe during pregnancy.', 'Safe during pregnancy.').join('; '), /polarity/);
  assert.match(claimSemanticsMismatch('Voltage is less than 5 V.', 'Voltage is greater than 5 volts.').join('; '), /comparison/);
  assert.match(claimSemanticsMismatch('A happens before B.', 'A happens after B.').join('; '), /temporal relation/);
  assert.match(claimSemanticsMismatch('The dose is 5 mg.', 'The dose is 2 mg.').join('; '), /quantity 5/);
  assert.match(claimSemanticsMismatch('The voltage is 5 V.', 'The voltage is 5 A.').join('; '), /quantity 5 V/);
  assert.match(claimSemanticsMismatch('The system is stable.', 'The system is stable at 10 seconds.').join('; '), /unsupported quantity 10 s/);
});

test('claim semantics preserves direction, spatial, quantity-scope, extreme, and condition qualifiers', () => {
  const mutations = [
    ['Resistance increases.', 'Resistance decreases.', /change direction/],
    ['Molecules remain inside the membrane.', 'Molecules remain outside the membrane.', /spatial relation/],
    ['All cells divide.', 'Some cells divide.', /quantity scope/],
    ['The minimum voltage is 5 V.', 'The maximum voltage is 5 V.', /extreme/],
    ['If heated, resistance rises.', 'Unless heated, resistance rises.', /condition or exception/],
    ['The reaction occurs except at low pressure.', 'The reaction occurs at low pressure.', /condition or exception/],
  ] as const;
  for (const [canonical, changed, expectedProblem] of mutations) {
    assert.match(claimSemanticsMismatch(canonical, changed).join('; '), expectedProblem, `${canonical} -> ${changed}`);
  }
  assert.deepEqual(claimSemanticsMismatch('Resistance increases.', 'Resistance rises.'), []);
  assert.deepEqual(claimSemanticsMismatch('Molecules remain inside the membrane.', 'Molecules remain within the membrane.'), []);
  assert.deepEqual(claimSemanticsMismatch('All cells divide.', 'Every cell divides.'), []);
  assert.deepEqual(claimSemanticsMismatch('The minimum voltage is 5 V.', 'The lowest voltage is 5 volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('If heated, resistance rises.', 'When heated, resistance rises.'), []);
  assert.deepEqual(claimSemanticsMismatch('The threshold is at least 5 V.', 'The threshold is no less than 5 volts.'), []);
  assert.match(claimSemanticsMismatch('The temperature is rising.', 'The temperature is falling.').join('; '), /change direction/);
  assert.match(claimSemanticsMismatch('If heated, resistance rises.', 'Only if heated, resistance rises.').join('; '), /condition or exception/);
  assert.match(claimSemanticsMismatch('Only if heated, resistance rises.', 'If heated, resistance rises.').join('; '), /condition or exception/);
});

test('claim semantics accepts a faithful paraphrase while leaving unrepresented meaning to other QA', () => {
  assert.deepEqual(claimSemanticsMismatch('Voltage is less than five volts.', 'The voltage stays below 5 volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('The voltage is 5 V.', 'The voltage is five volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('Two bulbs each draw less than five amperes.', 'Each of the two bulbs draws under 5 amps.'), []);
  assert.deepEqual(claimSemanticsMismatch('One hundred and five volts.', '105 volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('1,000 ohms.', '1000 ohms.'), []);
  assert.deepEqual(claimSemanticsMismatch('Acceleration is 10 m/s².', 'Acceleration is ten meters per second squared.'), []);
  assert.deepEqual(claimSemanticsMismatch('Area is five square centimetres.', 'Area is 5 cm².'), []);
  assert.deepEqual(claimSemanticsMismatch('Voltage is 5 V or less for 2 seconds.', 'Voltage is at most 5 V for 2 seconds.'), []);
  assert.deepEqual(claimSemanticsMismatch('5 kΩ.', 'five kiloohms.'), []);
  assert.deepEqual(claimSemanticsMismatch('5 kHz.', 'five kilohertz.'), []);
  assert.deepEqual(claimSemanticsMismatch('The value is less than 5 and greater than 2.', 'The value is under five and above 2.'), []);
  assert.deepEqual(claimSemanticsMismatch('The value is less than 5 and greater than 2.', 'The value is greater than 2 and less than 5.'), []);
  assert.deepEqual(claimSemanticsMismatch('They sell 5 a day.', 'They sell five per day.'), []);
  assert.deepEqual(claimSemanticsMismatch('The system is safe.', 'The system is reliable.'), []);
});

test('claim semantics normalizes comparator aliases and count zero without confusing measured zero', () => {
  assert.deepEqual(claimSemanticsMismatch('No fewer than five cells divide.', 'At least 5 cells divide.'), []);
  assert.deepEqual(claimSemanticsMismatch('No greater than 5 V.', 'At most five volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('0 V.', 'Zero volts.'), []);
  assert.deepEqual(claimSemanticsMismatch('No cells divide.', 'None of the cells divide.'), []);
  assert.deepEqual(claimSemanticsMismatch('No cells divide.', 'Zero cells divide.'), []);
  assert.deepEqual(claimSemanticsMismatch('Zero cells divide.', 'No cells divide.'), []);
  assert.deepEqual(claimSemanticsMismatch('No cells divide; 0 steps remain.', 'Zero cells divide; 0 steps remain.'), []);
  assert.deepEqual(claimSemanticsFromText('No greater than 5 V.').polarity, 'positive');
  assert.deepEqual(claimSemanticsFromText('No fewer than five cells.').polarity, 'positive');
  assert.match(claimSemanticsMismatch('No cells divide; 0 steps remain.', 'No cells divide.').join('; '), /quantity 0/);
  assert.match(claimSemanticsMismatch('No cells divide; the system is not stable.', 'Zero cells divide; the system is stable.').join('; '), /polarity/);
  assert.match(claimSemanticsMismatch('No cells divide with 0 steps remaining.', 'Zero cells divide.').join('; '), /quantity scope|polarity/);
  assert.match(claimSemanticsMismatch('No cells divide at 5 V with 0 steps remaining.', 'Zero cells divide at 5 V.').join('; '), /quantity scope|quantity 0|polarity/);
  assert.match(claimSemanticsMismatch('No cells divide, the system is not stable.', 'Zero cells divide, the system is stable.').join('; '), /polarity/);
});

test('claim semantics preserves each temporal relation in multi-clause claims', () => {
  assert.match(claimSemanticsMismatch('A occurs before B and after C.', 'A occurs before B and before C.').join('; '), /temporal relation/);
  assert.deepEqual(claimSemanticsMismatch('A occurs before B and after C.', 'After C, A occurs before B.'), []);
});

test('claim semantics catches numeric notation, unit, and qualifier mutations', () => {
  for (const [canonical, changed] of [
    ['The voltage is .5 V.', 'The voltage is 5 V.'],
    ['The voltage is −5 V.', 'The voltage is 5 V.'],
    ['The voltage is 1e3 V.', 'The voltage is 1e6 V.'],
    ['The voltage is 5 mV.', 'The voltage is 5 MV.'],
    ['The frequency is 5 MHz.', 'The frequency is 5 mHz.'],
    ['The speed is 10 m/s.', 'The speed is 10 m.'],
    ['The speed is 10 m/s.', 'The speed is 10 m/s².'],
    ['The acceleration is 10 m/s².', 'The acceleration is 10 m.'],
    ['The acceleration is 10 m/s².', 'The acceleration is 10 m/s³.'],
    ['The force is 10 kg·m/s².', 'The force is 10 kg·m/s³.'],
    ['The force is 10 kg m/s².', 'The force is 10 kg m/s³.'],
    ['The area is 5 cm².', 'The area is 5 m².'],
    ['The temperature is 5 degrees Celsius.', 'The temperature is 5 degrees Fahrenheit.'],
    ['The dose is thirteen milligrams.', 'The dose is fourteen milligrams.'],
    ['One million milligrams.', 'One billion milligrams.'],
    ['5 kiloohms.', '5 megaohms.'],
  ]) {
    assert.notDeepEqual(claimSemanticsMismatch(canonical, changed), [], `${canonical} -> ${changed}`);
  }
  assert.match(claimSemanticsMismatch('The voltage is 5 V.', 'The voltage is less than 5 V.').join('; '), /unsupported comparison/);
  assert.match(claimSemanticsMismatch('The threshold is 5 V or less.', 'The threshold is 5 V or more.').join('; '), /comparison/);
  assert.match(claimSemanticsMismatch('The value is less than 5 and greater than 2.', 'The value is less than 5 and less than 2.').join('; '), /comparison/);
  assert.match(claimSemanticsMismatch('A happens.', 'A happens after B.').join('; '), /unsupported temporal relation/);
});

test('an unsupported quantity scope names the words that trigger it', () => {
  const message = claimSemanticsMismatch('Doubling keeps the search small.', 'Doubling keeps each search small.').join('; ');
  assert.match(message, /unsupported quantity scope all/);
  assert.match(message, /each/);
});

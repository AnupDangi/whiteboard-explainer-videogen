import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRepresentation} from '../dist/src/semantic/identity/representation.js';

/** Routing before search: a concept an icon could never represent must not be
 *  searched for, and must not report a degradation. A `2x + 3 = 11` is not an
 *  entity, and counting it as an unresolved concept hides the genuine gaps. */

test('an equation is not searched for and is not reported as a degradation', () => {
  const decision = resolveRepresentation({id: 'eq1', canonicalName: '2x + 3 = 11', aliases: [], semanticType: 'equation'}, ['flow', 'structural_diagram']);
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.representation, undefined);
  assert.equal(decision.fallback, 'not-applicable');
  assert.deepEqual(decision.warnings, [], 'an inapplicable concept must not warn');
});

test('every other semantic type keeps searching, including one that fails', () => {
  const entity = resolveRepresentation({id: 'zzz', canonicalName: 'Zzz', aliases: [], semanticType: 'entity'}, ['flow']);
  assert.equal(entity.fallback, 'composition', 'an entity with no asset gets a composition, not a bare label');
  assert.match(entity.warnings.join(' '), /no visualFamily/);

  const quantity = resolveRepresentation({id: 'q1', canonicalName: 'Elasticity', aliases: [], semanticType: 'quantity'}, ['flow']);
  assert.notEqual(quantity.fallback, 'not-applicable', 'quantity is not special-cased away');

  const untyped = resolveRepresentation({id: 'u1', canonicalName: 'Nonsense', aliases: []}, ['flow']);
  assert.equal(untyped.fallback, 'primitive-label');
});

test('a symbol alone is still an equation even when a glyph exists for it', () => {
  for (const name of ['=', '×', '2x = 8']) {
    const decision = resolveRepresentation({id: `eq_${name}`, canonicalName: name, aliases: [], semanticType: 'equation'}, ['equation_walkthrough']);
    assert.equal(decision.fallback, 'not-applicable', `${name} must not be icon-searched`);
    assert.deepEqual(decision.warnings, []);
  }
});

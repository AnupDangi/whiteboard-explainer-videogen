import test from 'node:test';
import assert from 'node:assert/strict';
import {healSchema, visualActionSchema} from '../dist/src/semantic/schemas.js';
import {MOTIONS} from '../dist/src/semantic/types.js';
import {healCounts} from '../dist/src/semantic/planning/model-adapter.js';

/** S2 — deterministic corrections must be visible and classified.
 *
 *  `healSchema` rewrote model output silently: ~12 rules, no reporting. A
 *  correction that only reshapes data is harmless; one that invents or alters
 *  instructional content must be counted, because the pipeline must never
 *  present corrected output as if the model produced it. */

test('a shape-only correction is reported and classified as normalisation', () => {
  const events = [];
  const healed = healSchema(
    {unknownField: 1, leadMs: 9000},
    {type: 'object', additionalProperties: false, required: [], properties: {leadMs: {type: 'number', minimum: -300, maximum: 300}}},
    '$',
    event => events.push(event),
  );
  assert.ok(events.some(e => e.rule === 'unknown-key-dropped' && e.classification === 'NORMALIZATION'),
    'dropping an unknown key must be reported');
  assert.ok(events.some(e => e.rule === 'number-clamped' && e.classification === 'NORMALIZATION'),
    'clamping a number must be reported');
  assert.equal(healed.leadMs, 300);
  assert.equal('unknownField' in healed, false);
});

test('a contract-implied correction is reported as safe-deterministic', () => {
  const events = [];
  const healed = healSchema(
    {objects: [{id: 'p', children: [], parentId: undefined}, {id: 'c', parentId: 'p', children: []}], beats: []},
    {type: 'object', additionalProperties: false, required: [], properties: {
      objects: {type: 'array', items: {type: 'object', additionalProperties: false, required: [], properties: {id: {type: 'string'}, parentId: {type: 'string'}, children: {type: 'array', items: {type: 'string'}}}}},
      beats: {type: 'array', items: {type: 'object', additionalProperties: false, required: [], properties: {}}},
    }},
    '$',
    event => events.push(event),
  );
  assert.ok(events.some(e => e.rule === 'parent-child-linked' && e.classification === 'SAFE_DETERMINISTIC'),
    'a repaired parent/child link must be reported');
  assert.deepEqual(healed.objects.find(o => o.id === 'p').children, ['c']);
});

test('a correction that invents instructional content is classified SEMANTIC', () => {
  const events = [];
  healSchema(
    {centralConceptId: 'a', requiredConceptIds: [], beats: [{introduce: ['b']}]},
    {type: 'object', additionalProperties: false, required: [], properties: {
      centralConceptId: {type: 'string'},
      requiredConceptIds: {type: 'array', items: {type: 'string'}},
      beats: {type: 'array', items: {type: 'object', additionalProperties: false, required: [], properties: {introduce: {type: 'array', items: {type: 'string'}}}}},
    }},
    '$',
    event => events.push(event),
  );
  const derived = events.find(e => e.rule === 'required-concepts-derived');
  assert.ok(derived, 'deriving the required-concept inventory must be reported');
  assert.equal(derived.classification, 'SEMANTIC', 'inventing concept coverage is a semantic change');
  assert.deepEqual(derived.after, ['a', 'b']);
});

test('no motion alias can heal to a motion the renderer does not implement', () => {
  const typeSchema = visualActionSchema.properties.type;
  for (const alias of ['activate', 'activation', 'emphasize', 'emphasis', 'transport', 'appear', 'disappear', 'erase', 'draw_arrow']) {
    const healed = healSchema(alias, typeSchema);
    assert.ok(MOTIONS.includes(healed), `alias ${alias} healed to ${healed}, which is not an implemented motion`);
  }
  // `move` was removed from MOTIONS when it turned out to have no renderer
  // branch, so its alias must not resurrect it as a valid-looking value.
  assert.equal(healSchema('move_to', typeSchema), 'move_to',
    'move_to must not heal onto an unimplemented motion');
});

test('a semantic heal is counted separately from shape normalisation', () => {
  const counts = healCounts([
    {kind: 'heal', healClass: 'SEMANTIC'},
    {kind: 'heal', healClass: 'SEMANTIC'},
    {kind: 'heal', healClass: 'NORMALIZATION'},
    {kind: 'heal', healClass: 'SAFE_DETERMINISTIC'},
    {kind: 'raw'},
  ]);
  assert.deepEqual(counts, {normalization: 1, safeDeterministic: 1, semantic: 2});
  assert.deepEqual(healCounts(undefined), {normalization: 0, safeDeterministic: 0, semantic: 0},
    'a model without an event stream must not break the tally');
});

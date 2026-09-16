import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directVisual} from '../dist/src/semantic/planning/visual-director.js';
import {selectVisualModel} from '../dist/src/semantic/planning/visual-model.js';

/** S8 — one shape end to end. The director must be given the teaching contract
 *  in the SAME field names the output schema and the validator use, so it never
 *  has to translate `fromConceptId`/`relationType`/`targetAnchor` into
 *  `fromConcept`/`relation`/`targetPart`. A live run failed because it emitted
 *  the right concept pair with the wrong relation type and the one targeted
 *  repair did not converge. */

const plan = JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json', 'utf8'));
const semantic = plan.scenes[0];
const mental = selectVisualModel(semantic, plan.conceptRegistry, {keepFromPrevious: [], prepareForNext: []}, semantic.candidateArchetypes);

const capture = async () => {
  let captured;
  const model = {calls: [], events: [], async generate(stage, instructions, input) { captured = {instructions, input, stage}; throw new Error('probe'); }};
  await assert.rejects(() => directVisual(semantic, plan.conceptRegistry, mental, model, undefined, 'en'), /probe/);
  return captured;
};

test('the director receives required relations in the exact output schema shape', async () => {
  const {input} = await capture();
  assert.ok(Array.isArray(input.requiredRelations), 'requiredRelations must be structured input');
  assert.ok(input.requiredRelations.length > 0, 'the fixture must require relations');
  const allowed = new Set(['fromConcept', 'relation', 'toConcept', 'targetPart']);
  for (const relation of input.requiredRelations) {
    for (const key of Object.keys(relation)) {
      assert.ok(allowed.has(key), `a required relation must use the output field names; found "${key}"`);
    }
    for (const key of ['fromConcept', 'relation', 'toConcept']) {
      assert.ok(key in relation, `a required relation must carry "${key}"`);
    }
  }
  for (const required of semantic.requiredRelations) {
    const match = input.requiredRelations.find(r => r.fromConcept === required.fromConceptId && r.toConcept === required.toConceptId);
    assert.ok(match, `required relation ${required.id} must be present`);
    assert.equal(match.relation, required.relationType, 'the type must be copied, not renamed');
  }
  assert.ok(!/relationType|fromConceptId|toConceptId/.test(JSON.stringify(input.requiredRelations)),
    'input-side field names must not leak into the echoed contract');
});

test('the director receives the required objects and the hero role', async () => {
  const {input} = await capture();
  assert.ok(Array.isArray(input.requiredObjects), 'requiredObjects must be structured input');
  const hero = input.requiredObjects.find(o => o.role === 'hero');
  assert.ok(hero, 'the central concept must be declared as the hero');
  assert.equal(hero.conceptKey, semantic.centralConceptId);
  for (const id of semantic.requiredConceptIds) {
    assert.ok(input.requiredObjects.some(o => o.conceptKey === id), `required concept ${id} must be listed`);
  }
});

test('the instruction names the contract fields rather than describing them in prose', async () => {
  const {instructions} = await capture();
  assert.match(instructions, /requiredRelations/);
  assert.match(instructions, /relationRefs/);
  assert.ok(!/--\S*-->/.test(instructions), 'relations must not be re-serialised as prose arrows');
});

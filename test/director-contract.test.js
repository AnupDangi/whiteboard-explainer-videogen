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

test('a concept the model invented is dropped, not fatal', async () => {
  const {directScene, assetCandidates} = await import('../dist/src/semantic/planning/visual-director.js');
  const direction = {
    title: 't', teachingGoal: 'g', mentalModel: 'm', archetype: 'flow',
    objects: [
      {conceptKey: 'c1', label: 'One', role: 'hero', state: 'neutral', allowedStates: ['neutral'], importance: 'primary', collisionPolicy: 'forbid', primitiveRef: 'rectangle', children: []},
      {conceptKey: 'invented', label: 'Ghost', role: 'support', state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'forbid', primitiveRef: 'rectangle', children: []},
    ],
    relations: [{fromConcept: 'invented', relation: 'causes', toConcept: 'c1'}],
    beats: [{key: 'beat_1', narration: 'One', actions: [{type: 'reveal', durationMs: 400, leadMs: 0, easing: 'linear', conceptKeys: ['c1'], relationRefs: []}]}],
  };
  const decisions = {centralTeachingObject: 'c1', firstFocus: 'c1', illustratedConcepts: 'c1', labelsOnly: '', movingRelations: '', persistentContext: '', stateChanges: '', omit: ''};
  const model = {calls: [], events: [], async generate(stage, instructions, input, schema, validate) { return validate({direction, decisions}); }};
  const semantic = {
    version: 2, id: 's1', centralConceptId: 'c1', teachingGoal: 'g', learnerShouldUnderstand: 'u', mentalModel: 'm',
    beats: [{id: 'beat_1', narrationDraft: 'One', requirementIds: [], introduce: ['c1'], reinforce: [], transform: [], relationFocus: [], evidenceRefs: []}],
    requiredConceptIds: ['c1'], requiredRelations: [], candidateArchetypes: ['flow'],
    continuity: {keepFromPrevious: [], prepareForNext: []},
  };
  const registry = [{id: 'c1', canonicalName: 'One', aliases: [], semanticType: 'entity', evidenceRefs: []}];
  const mental = selectVisualModel(semantic, registry, {keepFromPrevious: [], prepareForNext: []}, semantic.candidateArchetypes);
  const directed = await directScene(semantic, registry, mental, model, undefined, 'en', {candidates: assetCandidates(semantic, registry, mental)});
  assert.equal(directed.scene.objects.some(o => o.conceptId === 'invented'), false,
    'an invented identity must not survive: it would be rejected as an unknown concept');
  assert.equal(directed.scene.objects.some(o => o.conceptId === 'c1'), true, 'the required concept must');
  assert.equal(directed.scene.relations.some(r => String(r.id).includes('invented')), false,
    'no relation may reference a dropped concept');
});

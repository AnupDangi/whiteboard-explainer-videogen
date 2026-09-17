import test from 'node:test';
import assert from 'node:assert/strict';
import {assetCandidates} from '../dist/src/semantic/planning/visual-director.js';

/** The resolver offers semantically-matching assets and PREFERS the ones that
 *  name the selected archetype.
 *
 *  It used to hard-filter on `asset.archetypes.includes(archetype)` because the
 *  compiler stripped incompatible picks. That gate is gone: the compiler draws
 *  any asset in any layout, because an illustration is geometry with anchors. The
 *  filter was also why nothing ever matched - 37 of 43 catalog assets declared
 *  two or three layouts and `cause_effect`, `numbered_steps` and `hierarchy`
 *  appeared on almost none of them, so a `cause_effect` scene was offered no
 *  assets at all and every concept fell to a generic composition (measured: 25 of
 *  25 concepts across three live lessons, `trusted-asset: 0`). */

const scene=(archetypes)=>({version:2,id:'probe',centralConceptId:'c1',teachingGoal:'g',learnerShouldUnderstand:'u',mentalModel:'m',beats:[],requiredConceptIds:['c1'],requiredRelations:[],candidateArchetypes:archetypes,continuity:{keepFromPrevious:[],prepareForNext:[]}});
const registry=[{id:'c1',canonicalName:'Value',aliases:['value','V'],semanticType:'quantity',evidenceRefs:[]}];
const model=(archetypes)=>({mentalModel:'m',candidateArchetypes:archetypes,heroConceptIds:['c1'],supportConceptIds:[],relationStrategy:[],requiredObjectStates:[]});

test('a cause_effect scene is offered real assets, not only compositions',()=>{
 const archetypes=['cause_effect','flow'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 const offered=candidates.flatMap(entry=>entry.candidates.map(candidate=>candidate.id));
 assert.ok(offered.length>0,'a cause_effect scene must be offered at least one real asset');
});

test('the archetype ranks candidates but no longer excludes them',()=>{
 const archetypes=['cause_effect','flow'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 const ids=candidates.flatMap(entry=>entry.candidates.map(candidate=>candidate.id));
 assert.equal(ids.includes('data.value.v2'),true,
  'data.value.v2 does not name cause_effect but the compiler draws it there, so it is offered rather than stripped to a label');
});

test('the same concept is offered the asset when its archetype is the selected one',()=>{
 const archetypes=['flow','cause_effect'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 const ids=candidates.flatMap(entry=>entry.candidates.map(candidate=>candidate.id));
 assert.ok(ids.includes('data.value.v2'),'flow does support data.value.v2');
});

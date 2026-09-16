import test from 'node:test';
import assert from 'node:assert/strict';
import {assetCandidates} from '../dist/src/semantic/planning/visual-director.js';

/** The resolver must offer only what the selected archetype can carry.
 *
 *  It previously resolved against the whole `candidateArchetypes` union, so a
 *  scene whose primary archetype was `cause_effect` could be offered
 *  `data.value.v2` (structural_diagram / matrix / equation / transformation /
 *  flow / comparison). The director picked it, the compiler stripped it as
 *  archetype-incompatible, and the post-compile integrity check then reported
 *  an unexplained representation degradation. */

const scene=(archetypes)=>({version:2,id:'probe',centralConceptId:'c1',teachingGoal:'g',learnerShouldUnderstand:'u',mentalModel:'m',beats:[],requiredConceptIds:['c1'],requiredRelations:[],candidateArchetypes:archetypes,continuity:{keepFromPrevious:[],prepareForNext:[]}});
const registry=[{id:'c1',canonicalName:'Value',aliases:['value','V'],semanticType:'quantity',evidenceRefs:[]}];
const model=(archetypes)=>({mentalModel:'m',candidateArchetypes:archetypes,heroConceptIds:['c1'],supportConceptIds:[],relationStrategy:[],requiredObjectStates:[]});

test('a candidate is only offered when it supports the selected archetype',()=>{
 const archetypes=['cause_effect','flow'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 for(const entry of candidates)for(const candidate of entry.candidates){
  assert.ok(candidate.archetypes.includes('cause_effect'),
   `${candidate.id} was offered for cause_effect but supports ${candidate.archetypes.join(',')}`);
 }
});

test('an asset that cannot support the selected archetype is not offered even though a secondary archetype could',()=>{
 const archetypes=['cause_effect','flow'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 const ids=candidates.flatMap(entry=>entry.candidates.map(candidate=>candidate.id));
 assert.equal(ids.includes('data.value.v2'),false,
  'data.value.v2 supports flow but not cause_effect, so it must not be offered');
});

test('the same concept is offered the asset when its archetype is the selected one',()=>{
 const archetypes=['flow','cause_effect'];
 const candidates=assetCandidates(scene(archetypes),registry,model(archetypes));
 const ids=candidates.flatMap(entry=>entry.candidates.map(candidate=>candidate.id));
 assert.ok(ids.includes('data.value.v2'),'flow does support data.value.v2');
});

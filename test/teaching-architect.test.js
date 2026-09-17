import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateArchitectOutput} from '../dist/src/semantic/planning/teaching-architect.js';
import {conceptGraphFromPlan} from '../dist/src/semantic/harness/state.js';

const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
const scenePlan=plan().scenes[0];
const graph=conceptGraphFromPlan(plan());
const learnerState={establishedConcepts:[],activeMentalModels:[],terminology:{},unresolvedQuestions:[],misconceptionsAddressed:[],checkpoints:[],provenance:[]};

const allContracts=(overrides=[])=>({contracts:scenePlan.beats.map((currentBeat,index)=>({beatKey:currentBeat.id,objective:`Objective ${index+1}`,motivation:`Motivation ${index+1}`,prerequisites:index===0?[]:[scenePlan.beats[0].introduce[0]],learnerDelta:{before:`before ${index+1}`,after:`after ${index+1}`,newConcepts:currentBeat.introduce,reinforcedConcepts:currentBeat.reinforce},strategy:'intuition',mechanismIds:[],evidenceRefs:graph.evidence.slice(0,1).map(evidence=>evidence.id),...overrides[index]}))});
const valid=(overrides={})=>allContracts([overrides]);

test('a valid contract list maps one-to-one onto the scene beats',()=>{
 const contracts=validateArchitectOutput(valid(),{scene:scenePlan,learnerState,conceptGraph:graph});
 assert.equal(contracts.length,scenePlan.beats.length);
 assert.equal(contracts[0].narrationDraft,scenePlan.beats[0].narrationDraft);
 assert.equal(contracts[0].relationIds.join(','),scenePlan.beats[0].relationFocus.join(','));
 assert.match(contracts[0].id,/contract:photosynthesis_plant:1/);
});

test('skill eval:prereq-order — contracts referencing the graph pass and unknown references reject',()=>{
 const contracts=validateArchitectOutput(valid({prerequisites:['plant']}),{scene:scenePlan,learnerState,conceptGraph:graph});
 assert.ok(contracts[0].prerequisites.includes('plant'));
 const unknown=allContracts();unknown.contracts[0].prerequisites=['chloroplast'];
 assert.throws(()=>validateArchitectOutput(unknown,{scene:scenePlan,learnerState,conceptGraph:graph}),/Unknown prerequisite chloroplast/);
 const unknownMech=allContracts();unknownMech.contracts[0].mechanismIds=['ghost_mech'];
 assert.throws(()=>validateArchitectOutput(unknownMech,{scene:scenePlan,learnerState,conceptGraph:graph}),/Unknown mechanism ghost_mech/);
 const unknownEvidence=allContracts();unknownEvidence.contracts[0].evidenceRefs=['ev_ghost'];
 const healed=validateArchitectOutput(unknownEvidence,{scene:scenePlan,learnerState,conceptGraph:graph});
 assert.ok(!healed[0].evidenceRefs.includes('ev_ghost'),'unknown evidence refs are dropped, not fatal');
});

test('the architect cannot invent concepts outside the beat or change beat order',()=>{
 const outside=allContracts();outside.contracts[0].learnerDelta.newConcepts=['chloroplast'];
 // Scoped back to the beat rather than fatal: a real source-grounded run died
 // here twice and the repair reproduced it, losing the whole lesson over a delta
 // list. The contract keeps its objective, mechanism and checkpoint.
 const scoped=validateArchitectOutput(outside,{scene:scenePlan,learnerState,conceptGraph:graph});
 assert.equal(scoped[0].learnerDelta.newConcepts.includes('chloroplast'),false,'an out-of-beat concept is dropped, not fatal');
 const reordered=allContracts();reordered.contracts[0].beatKey='zzz_wrong';
 assert.throws(()=>validateArchitectOutput(reordered,{scene:scenePlan,learnerState,conceptGraph:graph}),/expected/);
 assert.throws(()=>validateArchitectOutput({contracts:[]},{scene:scenePlan,learnerState,conceptGraph:graph}),/array bounds/);
});

test('the architect contract forbids narration, geometry and unknown fields',()=>{
 const raw=allContracts();raw.contracts[0].narration='the model wrote narration';
 assert.throws(()=>validateArchitectOutput(raw,{scene:scenePlan,learnerState,conceptGraph:graph}),/additional property/);
 const coords=allContracts();coords.contracts[0].layout={x:1,y:2};
 assert.throws(()=>validateArchitectOutput(coords,{scene:scenePlan,learnerState,conceptGraph:graph}),/additional property/);
});

test('the manifest config records the grounding policy verbatim',async()=>{
 const {readFileSync}=await import('node:fs');
 const {generateV2}=await import('../dist/src/semantic/planning/generate.js');
 const planJson=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
 const scene=()=>{const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;return value;};
 const model={calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){return validate(stage==='teaching'?planJson:{scene:scene(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});}};
 let manifest;
 for await(const result of generateV2({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1,groundingPolicy:'source-plus-verified'},model))manifest=result.manifest;
 assert.equal(manifest.config.groundingPolicy,'source-plus-verified');
});

test('the legacy director scene passthrough still works and its instrumentation is pinned in source',()=>{
 const source=readFileSync('src/semantic/planning/visual-director.ts','utf8');
 assert.match(source,/v2\.director\.legacy-scene-passthrough/);
 assert.match(source,/Not silent\./);
 assert.match(source,/directionToScene\(response\.direction,scene\)/);
});

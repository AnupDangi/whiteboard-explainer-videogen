import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conceptGraphFromPlan,contractsFromScene,defaultLearnerProfile,initialLearnerState,whiteboardPlanFromContracts,advanceLearnerState,stableHash} from '../dist/src/semantic/harness/state.js';
import {gateConceptGraph,gateTeachingContracts,gateWhiteboard,gateVisual} from '../dist/src/semantic/harness/gates.js';
import {LessonSemanticRegistry} from '../dist/src/semantic/harness/registry.js';
import {MemoryStageJournal} from '../dist/src/semantic/harness/journal.js';
import {executeStage} from '../dist/src/semantic/harness/stage.js';
import {validateSynthesisSpec,cacheSynthesisSpec} from '../dist/src/semantic/representation-synthesis.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';

const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
const scene=()=>{const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;return value;};
const model=()=>({calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){return validate(stage==='teaching'?plan():{scene:scene(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});}});

test('knowledge, teaching, learner and whiteboard contracts form one validated chain',()=>{
 const teaching=plan(),graph=conceptGraphFromPlan(teaching),before=initialLearnerState(defaultLearnerProfile('en')),contracts=contractsFromScene(teaching.scenes[0],teaching,before),board=whiteboardPlanFromContracts(teaching.scenes[0],contracts),after=advanceLearnerState(before,contracts,graph);
 assert.equal(gateConceptGraph(graph).passed,true);assert.equal(gateTeachingContracts(contracts,before,graph).passed,true);assert.equal(gateWhiteboard(board,teaching.scenes[0]).passed,true);
 assert.ok(after.establishedConcepts.includes('plant'));assert.ok(after.terminology.plant);assert.ok(board.beats.some(beat=>beat.diffs.some(diff=>diff.operation==='INTRODUCE')));
});

test('knowledge and teaching gates reject ambiguous identity, cycles, and premature prerequisites',()=>{
 const teaching=plan();teaching.conceptRegistry[1].aliases.push('plant');assert.throws(()=>conceptGraphFromPlan(teaching),/Ambiguous canonical alias/);
 const graph=conceptGraphFromPlan(plan());graph.prerequisites=[{before:'plant',after:'water',reason:'test'},{before:'water',after:'plant',reason:'test'}];assert.equal(gateConceptGraph(graph).passed,false);
 const before=initialLearnerState(defaultLearnerProfile('en')),contracts=contractsFromScene(plan().scenes[0],plan(),before);contracts[0].prerequisites=['water'];const gate=gateTeachingContracts(contracts,before,conceptGraphFromPlan(plan()));assert.equal(gate.passed,false);assert.equal(gate.findings[0].code,'PREREQUISITE_ORDER');
});

test('lesson registry keeps stable identity and rejects unannounced representation changes',()=>{
 const graph=conceptGraphFromPlan(plan()),registry=new LessonSemanticRegistry(graph),first=scene();registry.observeScene(first);const snapshot=registry.snapshot();assert.equal(snapshot.entries.find(e=>e.semanticKey==='plant').persistentId,'concept:plant');
 const changed=scene();changed.id='next';changed.objects.find(o=>o.conceptId==='plant').assetRef='biology.plant.flower.v1';assert.throws(()=>registry.observeScene(changed),/changed without transition/);
});

test('declarative synthesis rejects executable and geometry-bearing fields',()=>{
 const valid={semanticSubject:'cell',parts:[{key:'membrane',primitive:'ellipse',semanticRole:'boundary'}],requestedAnchors:['center'],styleFamily:'chalk-ink-v2'};
 assert.equal(validateSynthesisSpec(valid).parts.length,1);assert.equal(cacheSynthesisSpec(valid).hash,cacheSynthesisSpec(valid).hash);
 assert.throws(()=>validateSynthesisSpec({...valid,svg:'<script>alert(1)</script>'}),/Unsafe/);assert.throws(()=>validateSynthesisSpec({...valid,parts:[{...valid.parts[0],x:10}]}),/Unsafe/);
});

test('stage envelopes are hashed, owned and journaled',async()=>{
 const journal=new MemoryStageJournal();const {envelope}=await executeStage({stage:'teaching-architect',input:{a:1},run:()=>({ok:true}),gate:()=>({stage:'teaching-architect',passed:true,findings:[]}),journal});
 assert.equal(envelope.owner,'teaching-architect');assert.equal(envelope.inputHash,stableHash({a:1}));assert.equal(journal.entries.length,1);
});

test('failed stage boundaries remain inspectable in the append-only journal',async()=>{
 const journal=new MemoryStageJournal();
 await assert.rejects(()=>executeStage({stage:'teaching-architect',input:{beat:'broken'},run:()=>({ok:false}),gate:()=>({stage:'teaching-architect',passed:false,findings:[{stage:'teaching-architect',code:'LEARNER_DELTA',severity:'hard',message:'missing delta'}]}),journal}),/gate failed/);
 assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].status,'FAIL');assert.equal(journal.entries[0].owner,'teaching-architect');assert.equal(journal.entries[0].gate.findings[0].code,'LEARNER_DELTA');
});

test('generateV2 returns a PASS harness manifest without changing renderer contracts',async()=>{
 const results=[];for await(const result of generateV2({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},model()))results.push(result);
 assert.equal(results.length,1);assert.equal(results[0].manifest.status,'PASS');assert.equal(results[0].manifest.version,'teaching-compiler-v1');assert.equal(results[0].gates.every(g=>g.passed),true);assert.equal(gateVisual(results[0].directed.scene,results[0].registry).passed,true);assert.ok(results[0].teachingContracts.length>0);
 assert.deepEqual(results[0].manifest.stages.map(stage=>stage.stage),['ingest','knowledge-compiler','teaching-architect','whiteboard-planner','representation-guide','source-visual-grounding','visual-director','compiler','tts-alignment','pedagogy-critic','render']);
});

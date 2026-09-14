import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {readFileSync} from 'node:fs';
import {validateKnowledge,compileKnowledge,knowledgeGraphSchema} from '../dist/src/semantic/planning/knowledge-compiler.js';
import {conceptGraphFromPlan,stableHash} from '../dist/src/semantic/harness/state.js';
import {planTeaching} from '../dist/src/semantic/planning/teaching-planner.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';
import {createVoiceEngineSpeech} from '../dist/src/semantic/speech.js';

const SOURCE='Plants make food using sunlight, water and carbon dioxide. Leaves capture sunlight for energy. Roots absorb water from the soil. Leaves take in carbon dioxide from the air. Inputs enable plant food production.';
const CONCEPT=(key,canonicalName,aliases,semanticType='entity')=>({key,canonicalName,aliases,semanticType,evidenceRefs:['ev_light']});
const validKnowledge=()=>({
 version:1,
 concepts:[CONCEPT('plant','Plant',['Plants']),CONCEPT('sunlight','Sunlight',['light']),CONCEPT('water','Water',['H2O'],'material'),CONCEPT('carbon_dioxide','Carbon dioxide',['CO2'],'material')],
 prerequisites:[{before:'sunlight',after:'plant',reason:'light energy precedes food production'}],
 mechanisms:[{id:'inputs_mechanism',statement:'Inputs enable plant food production',conceptIds:['plant','sunlight','water','carbon_dioxide'],requiresStateChange:false,evidenceRefs:['ev_light']}],
 claims:[
  {id:'light_claim',statement:'Leaves capture sunlight',critical:true,evidenceRefs:['ev_light']},
  {id:'water_claim',statement:'Roots absorb water',critical:true,evidenceRefs:['ev_water']},
  {id:'carbon_claim',statement:'Leaves take in carbon dioxide',critical:true,evidenceRefs:['ev_carbon']}],
 quantities:[{conceptKey:'water',value:'continuous supply',evidenceRefs:['ev_water']}],
 terminology:[{key:'plant',definition:'A green organism that makes its own food'},{key:'sunlight',definition:'Light energy from the sun'}],
 evidence:[
  {id:'ev_light',sourceId:'src_test',quote:'Leaves capture sunlight'},
  {id:'ev_water',sourceId:'src_test',quote:'Roots absorb water'},
  {id:'ev_carbon',sourceId:'src_test',quote:'Leaves take in carbon dioxide'},
  {id:'ev_mech',sourceId:'src_test',quote:'Inputs enable plant food production'}]
});

test('a valid knowledge graph collapses aliases and returns the truth layer',()=>{
 const graph=validateKnowledge(validKnowledge(),SOURCE);
 assert.equal(graph.concepts.length,4);
 assert.equal(graph.aliases['plants'],'plant');
 assert.equal(graph.aliases['h2_o'],'water');
 assert.equal(graph.aliases['v41_flash'],undefined);
 assert.equal(graph.claims.length,3);assert.equal(graph.claims.every(claim=>claim.evidenceRefs.length>0),true);
 assert.equal(stableHash(graph).length,64);
});

test('skill eval:alias-collapse merges spelling variants into one key',()=>{
 const merged=validKnowledge();
 merged.concepts.push({...CONCEPT('v41_flash','V41 Flash',['v41-flash','v41-flash-total'])});
 const graph=validateKnowledge(merged,SOURCE);
 assert.equal(graph.aliases['v41_flash'],'v41_flash');
 assert.equal(graph.aliases['v41_flash_total'],'v41_flash');
 assert.equal(new Set(Object.values(graph.aliases).filter(target=>target.startsWith('v41'))).size,1);
});

test('skill invariants: alias forks, cycles, orphan claims and fabricated evidence reject',()=>{
 const fork=validKnowledge();fork.concepts.push({...CONCEPT('light_ray','Light ray',['light'])});
 assert.throws(()=>validateKnowledge(fork,SOURCE),/Alias fork/);
 const cycle=validKnowledge();cycle.prerequisites=[{before:'plant',after:'sunlight',reason:'x'},{before:'sunlight',after:'plant',reason:'y'}];
 assert.throws(()=>validateKnowledge(cycle,SOURCE),/cycle/);
 const orphan=validKnowledge();orphan.claims[0].evidenceRefs=[];
 assert.throws(()=>validateKnowledge(orphan,SOURCE),/no verbatim evidence/);
 const fabricated=validKnowledge();fabricated.evidence[0].quote='Leaves photosynthesize moonlight on Tuesdays';
 assert.throws(()=>validateKnowledge(fabricated,SOURCE),/Fabricated evidence/);
 const unknown=validKnowledge();unknown.mechanisms[0].evidenceRefs=['ev_ghost'];
 assert.throws(()=>validateKnowledge(unknown,SOURCE),/Unknown evidence/);
 const badEdge=validKnowledge();badEdge.prerequisites=[{before:'plant',after:'chloroplast',reason:'x'}];
 assert.throws(()=>validateKnowledge(badEdge,SOURCE),/Invalid prerequisite edge/);
});

test('schema forbids geometry, ids, code and unknown fields in the knowledge contract',()=>{
 const raw=validKnowledge();
 raw.concepts[0].x=12;
 assert.throws(()=>validateKnowledge(raw,SOURCE),/additional property/);
 const code=(validKnowledge());
 code.mechanisms[0].script='eval(1)';
 assert.throws(()=>validateKnowledge(code,SOURCE),/additional property/);
 const shape=knowledgeGraphSchema;
 assert.equal(shape.properties.concepts.items.type,'object');
});

const fixturePlan=()=>{
 const plan=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
 plan.evidenceRefs=[
  {id:'ev_light',sourceId:'src_test',quote:'Leaves capture sunlight'},
  {id:'ev_water',sourceId:'src_test',quote:'Roots absorb water'},
  {id:'ev_carbon',sourceId:'src_test',quote:'Leaves take in carbon dioxide'},
  {id:'ev_mech',sourceId:'src_test',quote:'Inputs enable plant food production'}];
 for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])requirement.evidenceRefs=['ev_light'];
 for(const scene of plan.scenes)for(const beat of scene.beats)beat.evidenceRefs=['ev_light'];
 return plan;
};

test('grounded planning rejects concepts, evidence and requirements outside the inventory',async()=>{
 const graph=conceptGraphFromPlan(fixturePlan());
 const model={calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){return validate(fixturePlan());}};
 await assert.rejects(()=>planTeaching({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence']},model,{conceptGraph:{...graph,concepts:graph.concepts.filter(c=>c.id!=='carbon_dioxide')}}),/Concept outside knowledge inventory: carbon_dioxide/);
 const plan=await planTeaching({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence']},model,{conceptGraph:graph});
 assert.equal(plan.version,2);assert.equal(model.calls.length,0);
});

const sceneJson=()=>{
 const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));
 for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;
 return value;
};
const groundedModel=(knowledgeJson,planJson)=>({
 calls:[],events:[],
 async generate(stage,_instructions,input,_schema,validate){
  this.calls.push({stage});
  if(stage==='knowledge')return validate(knowledgeJson);
  if(stage==='teaching')return validate(planJson);
  const s=sceneJson();s.id=input.semanticScene.id;
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});
 }
});

test('generateV2 runs the real knowledge stage before teaching on grounded sources',async()=>{
 const results=[];
 for await(const result of generateV2({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},groundedModel(validKnowledge(),fixturePlan())))results.push(result);
 assert.equal(results.length,1);assert.equal(results[0].manifest.status,'PASS');
 assert.deepEqual([...new Set(results[0].manifest.stages.map(stage=>stage.stage))].slice(0,3),['ingest','knowledge-compiler','teaching-architect']);
 assert.ok(results[0].manifest.stages.find(stage=>stage.stage==='knowledge-compiler'));
 assert.equal(results[0].conceptGraph.claims.length,3);
 assert.equal(results[0].conceptGraph.aliases['plants'],'plant');
});

test('grounded narration flows through the bundled voice engine',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'knowledge-ve-')),audioPath=join(dir,'scene.wav');
 await writeFile(audioPath,Buffer.from('RIFF'));
 const speech=createVoiceEngineSpeech({run:async()=>({audioPath,provider:'supertonic',language:'en',voice:'F3',generationMs:10,audioDurationMs:2000,rtf:0.005})});
 let narrated;
 for await(const result of generateV2({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},groundedModel(validKnowledge(),fixturePlan()),{speech}))narrated=result;
 assert.equal(narrated.speech.audio.toString(),'RIFF');
 assert.equal(narrated.speech.provider,'supertonic');
 assert.equal(narrated.compiled.timing.kind,'engine');
 assert.equal(narrated.compiled.timing.timingSource,'estimated');
});

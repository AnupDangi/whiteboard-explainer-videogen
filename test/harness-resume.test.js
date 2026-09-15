import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStage} from '../dist/src/semantic/harness/stage.js';
import {MemoryStageJournal} from '../dist/src/semantic/harness/journal.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';
import {SemanticJobStore} from '../dist/src/semantic/jobs.js';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ok=stage=>({stage,passed:true,findings:[]});
const bad=stage=>({stage,passed:false,findings:[{stage,code:'COMPILE',severity:'hard',message:'broken'}]});

test('resume replays a validated journal entry without re-running the stage',async()=>{
 const journal=new MemoryStageJournal();
 await executeStage({stage:'knowledge-compiler',input:{prompt:'x'},run:()=>({plan:'first'}),gate:()=>ok('knowledge-compiler'),journal});
 let runs=0;
 const second=await executeStage({stage:'knowledge-compiler',input:{prompt:'x'},run:()=>{runs++;return {plan:'should-not-run'};},gate:()=>ok('knowledge-compiler'),journal,resume:true});
 assert.equal(runs,0);
 assert.deepEqual(second.output,{plan:'first'});
 assert.equal(second.envelope.elapsedMs,0);
 assert.equal(journal.entries.length,2);
 assert.ok(journal.entries.every(entry=>entry.stage==='knowledge-compiler'));
});

test('resume skips mismatches: different input, different stage, or failed entry',async()=>{
 const journal=new MemoryStageJournal();
 await executeStage({stage:'compiler',input:{a:1},run:()=>({ok:true}),gate:()=>ok('compiler'),journal});
 let runs=0;
 const otherInput=await executeStage({stage:'compiler',input:{a:2},run:()=>{runs++;return {ok:true};},gate:()=>ok('compiler'),journal,resume:true});
 assert.equal(runs,1);assert.deepEqual(otherInput.output,{ok:true});
 const otherStage=await executeStage({stage:'render',input:{a:1},run:()=>{runs++;return {ok:true};},gate:()=>ok('render'),journal,resume:true});
 assert.equal(runs,2);assert.equal(otherStage.envelope.stage,'render');
 await assert.rejects(executeStage({stage:'tts-alignment',input:{a:1},run:()=>{throw new Error('boom')},gate:()=>ok('tts-alignment'),journal}),/boom/);
 const afterFailure=await executeStage({stage:'tts-alignment',input:{a:1},run:()=>{runs++;return {ok:true};},gate:()=>ok('tts-alignment'),journal,resume:true});
 assert.equal(runs,3);assert.deepEqual(afterFailure.output,{ok:true});
});

test('a resumed pipeline completes without re-calling completed model stages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-resume-'));
 const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
 const scene=()=>{const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;return value;};
 const model=(directShouldFail)=>({calls:[],events:[],async generate(stage,_instructions,input,_schema,validate){
  this.calls.push({stage});
  if(stage==='teaching')return validate(plan());
  const s=scene();s.id=input.semanticScene.id;
  if(directShouldFail)throw new Error('director provider exploded');
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});
 }});
 const store=new SemanticJobStore(root,{model:()=>model(true)});
 let failed;
 try{
  const first=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false});
  await new Promise(resolve=>{const timer=setInterval(async()=>{const job=await store.get(first.id);if(job&&['error','partial','complete'].includes(job.status)){failed=job;clearInterval(timer);resolve();}},50);});
  assert.equal(failed.status,'error');
  const retryStore=new SemanticJobStore(root,{model:()=>model(false)});
  try{
   const retried=await retryStore.retry(first.id);
   const retryModel=retryStore.jobs.get(retried.id).model;
   await new Promise(resolve=>{const timer=setInterval(async()=>{const job=await retryStore.get(retried.id);if(job&&['complete','partial','error'].includes(job.status)){clearInterval(timer);resolve();}},50);});
   const done=await retryStore.get(retried.id);
   assert.equal(done.status,'complete');
   assert.equal(retryModel.calls.filter(call=>call.stage==='teaching').length,0);
   assert.equal(retryModel.calls.filter(call=>call.stage==='director').length,1);
   assert.ok(done.scenes.length>=1);
  }finally{await retryStore.close();}
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

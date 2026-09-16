import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStage} from '../dist/src/semantic/harness/stage.js';
import {MemoryStageJournal} from '../dist/src/semantic/harness/journal.js';
import {stageFailure,classifyFailure} from '../dist/src/semantic/repair.js';

/** Acceptance for failure ownership: a stage must never spend a model repair on
 *  a decision it does not own. The concrete live bug was a compiler geometry
 *  error (`Illegal overlap`) raised while running visual-director, which bought
 *  two more director calls that produced byte-identical output. */

const ok=stage=>({stage,passed:true,findings:[]});
const bad=(stage,code='VISUAL_SUPPORT')=>({stage,passed:false,findings:[{stage,code,severity:'hard',message:`${code} failed`}]});

test('a compiler geometry failure inside the director stage is routed, not repaired',async()=>{
 const journal=new MemoryStageJournal();let runs=0,repairs=0;
 await assert.rejects(()=>executeStage({stage:'visual-director',input:{},run:()=>{runs++;throw stageFailure(new Error('Illegal overlap: object_a/object_b'),'compile');},gate:()=>ok('visual-director'),repair:async()=>{repairs++;return {ok:true};},journal}),(error)=>{
  assert.equal(error.name,'RoutedStageFailure');
  assert.equal(error.classification.owner,'compiler');
  assert.equal(error.classification.failureClass,'GEOMETRY');
  assert.equal(error.classification.code,'geometry-failed');
  return true;
 });
 assert.equal(runs,1,'the director must be called exactly once');
 assert.equal(repairs,0,'the director must not be asked to repair compiler geometry');
});

test('a representation failure is not repaired by the stage that observed it',async()=>{
 let repairs=0;
 await assert.rejects(()=>executeStage({stage:'teaching-architect',input:{},run:()=>{throw stageFailure(new Error('no candidate representation for the hero'),'representation');},gate:()=>ok('teaching-architect'),repair:async()=>{repairs++;return {ok:true};},journal:new MemoryStageJournal()}),(error)=>{
  assert.equal(error.classification.owner,'representation-guide');
  assert.equal(error.classification.failureClass,'REPRESENTATION');
  return true;
 });
 assert.equal(repairs,0);
});

test('a provider timeout or budget failure is not converted into a semantic repair',async()=>{
 for(const message of ['OpenRouter 503: upstream unavailable','The operation was aborted due to timeout','V2 knowledge request exceeds remaining cost budget']){
  let repairs=0;
  await assert.rejects(()=>executeStage({stage:'knowledge-compiler',input:{},run:()=>{throw new Error(message);},gate:()=>ok('knowledge-compiler'),repair:async()=>{repairs++;return {ok:true};},journal:new MemoryStageJournal()}),(error)=>{
   assert.equal(error.classification.owner,'harness',`${message} must be provider-owned`);
   assert.equal(error.classification.failureClass,'PROVIDER');
   return true;
  });
  assert.equal(repairs,0,`${message} must not trigger a model repair`);
 }
});

test('a director-owned semantic failure still gets exactly one repair',async()=>{
 const journal=new MemoryStageJournal();let runs=0,repairs=0;
 const {output,envelope}=await executeStage({stage:'visual-director',input:{},run:()=>{runs++;if(runs===1)throw new Error('Director omitted concept world_models');return {ok:true};},gate:()=>ok('visual-director'),repair:async context=>{repairs++;assert.equal(context.owner,'visual-director');return {ok:true};},journal});
 assert.equal(runs,1);assert.equal(repairs,1);assert.equal(output.ok,true);assert.equal(envelope.attempt,1);
});

test('a gate finding stamped with another stage is routed to that stage',async()=>{
 let repairs=0;
 await assert.rejects(()=>executeStage({stage:'visual-director',input:{},run:()=>({ok:true}),gate:()=>bad('compiler','COMPILE'),repair:async()=>{repairs++;return {ok:true};},journal:new MemoryStageJournal()}),(error)=>{
  assert.equal(error.classification.owner,'compiler');
  return true;
 });
 assert.equal(repairs,0);
});

test('a gate finding owned by the running stage is still repaired',async()=>{
 const journal=new MemoryStageJournal();let repairs=0;
 const {output}=await executeStage({stage:'knowledge-compiler',input:{},run:()=>({ok:false}),gate:value=>value.ok?ok('knowledge-compiler'):bad('knowledge-compiler','GROUNDING'),repair:async()=>{repairs++;return {ok:true};},journal});
 assert.equal(repairs,1,'the owning stage must keep its one repair');
 assert.equal(output.ok,true);
});

test('classifyFailure defaults an unclassified failure to the running stage',()=>{
 const classification=classifyFailure(new Error('something odd happened'),'teaching-architect');
 assert.equal(classification.owner,'teaching-architect');
 assert.equal(classification.failureClass,'SEMANTIC');
});

test('the routed failure survives stageFailure so the real owner reaches the job layer',()=>{
 const classification={owner:'compiler',code:'COMPILE',failureClass:'GEOMETRY',gate:{stage:'compile',passed:false,findings:[]}};
 const routed=stageFailure(Object.assign(new Error('wrapped'),{gate:classification.gate}),'compile');
 assert.equal(routed.failureClass,'GEOMETRY');
 assert.equal(classifyFailure(routed,'visual-director').owner,'compiler');
});

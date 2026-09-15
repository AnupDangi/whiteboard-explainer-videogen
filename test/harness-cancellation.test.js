import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStage} from '../dist/src/semantic/harness/stage.js';
import {MemoryStageJournal} from '../dist/src/semantic/harness/journal.js';
import {createJsonModel} from '../dist/src/semantic/planning/model-adapter.js';

const ok=stage=>({stage,passed:true,findings:[]});

test('a stage deadline aborts the running work instead of leaving it dangling',async()=>{
 const journal=new MemoryStageJournal();
 let observedAbort=false;
 const started=Date.now();
 await assert.rejects(
  executeStage({stage:'visual-director',input:{},policy:{owner:'visual-director',timeoutMs:80,maxRepairs:0,budgetUsd:0},run:(signal)=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>{observedAbort=true;reject(new Error('aborted by deadline'));});}),gate:()=>ok('visual-director'),journal}),
  /exceeded 80ms/);
 assert.equal(observedAbort,true,'run must observe the abort');
 assert.ok(Date.now()-started<1000,'deadline enforced promptly');
 assert.equal(journal.entries.length,1);
 assert.equal(journal.entries[0].status,'FAIL');
 assert.equal(journal.entries[0].stage,'visual-director');
});

test('work that completes inside the deadline still succeeds',async()=>{
 const {output,envelope}=await executeStage({stage:'compiler',input:{},policy:{owner:'compiler',timeoutMs:500,maxRepairs:0,budgetUsd:0},run:async(signal)=>{await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);return {ok:true};},gate:()=>ok('compiler')});
 assert.deepEqual(output,{ok:true});
 assert.equal(envelope.attempt,0);
});

test('a repair attempt receives an abort signal bound to the stage deadline',async()=>{
 let repairSignal;
 const {output}=await executeStage({stage:'knowledge-compiler',input:{},policy:{owner:'knowledge-compiler',timeoutMs:400,maxRepairs:1,budgetUsd:0},run:(signal)=>{assert.ok(signal instanceof AbortSignal);throw new Error('validation exhausted: unknown field');},gate:()=>ok('knowledge-compiler'),repair:async({signal})=>{repairSignal=signal;return {fixed:true};}});
 assert.deepEqual(output,{fixed:true});
 assert.ok(repairSignal instanceof AbortSignal);
});

test('provider calls abort when the stage signal aborts',async()=>{
 const controller=new AbortController();
 const model=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/model'},maxCostUsd:.5,fetcher:async(url,init)=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/model',pricing:{prompt:'0',completion:'0'}}]}));
  return await new Promise((_,reject)=>{const signal=init.signal;if(signal.aborted)return reject(new Error('aborted'));signal.addEventListener('abort',()=>reject(new Error('The operation was aborted due to timeout')));});
 }});
 const pending=model.generate('knowledge','x',{}, {type:'object',additionalProperties:false,required:['a'],properties:{a:{type:'string'}}},v=>v,{signal:controller.signal});
 setTimeout(()=>controller.abort(),20);
 await assert.rejects(pending,/aborted/i);
});

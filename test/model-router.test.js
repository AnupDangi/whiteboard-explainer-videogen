import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModelRouter,taskOfLabel} from '../dist/src/shared/model-router.js';

test('Model router: precedence MODEL_ROUTER JSON > per-task env > base',()=>{
  const base='base/model';
  const env1={OPENROUTER_OUTLINE_MODEL:'env-outline',OPENROUTER_CONTENT_MODEL:'env-content'};
  const r1=loadModelRouter(env1,base);
  assert.equal(r1.outline,'env-outline');
  assert.equal(r1.content,'env-content');
  assert.equal(r1.director,base,'unset tasks fall back to the base model');

  const env2={...env1,MODEL_ROUTER:JSON.stringify({outline:'json-outline',director:'json-director'})};
  const r2=loadModelRouter(env2,base);
  assert.equal(r2.outline,'json-outline','JSON config beats per-task env');
  assert.equal(r2.content,'env-content','tasks absent from JSON keep their env value');
  assert.equal(r2.director,'json-director');
});

test('Model router: malformed JSON is ignored, falls back to env/base',()=>{
  const r=loadModelRouter({MODEL_ROUTER:'{not json',OPENROUTER_CONTENT_MODEL:'env-content'},'base');
  assert.equal(r.content,'env-content');
  assert.equal(r.outline,'base');
});

test('Model router: ledger labels map to tasks',()=>{
  assert.equal(taskOfLabel('outline'),'outline');
  assert.equal(taskOfLabel('content-repair'),'content');
  assert.equal(taskOfLabel('director-repair'),'director');
  assert.equal(taskOfLabel('critic'),'critic');
  assert.equal(taskOfLabel('figure'),'vision');
});

test('route cooldown is sticky: cooldown routes are skipped and stay skipped',async()=>{
 const {createJsonModel,routeHealthState,resetRouteHealth}=await import('../dist/src/semantic/planning/model-adapter.js');
 resetRouteHealth();
 const hang=new Error('The operation was aborted due to timeout');
 const okBody=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:10,cost:.000001}}));
 const schema={type:'object',required:['ok'],properties:{ok:{type:'boolean'}}};
 const validate=value=>value;
 const callsTo={a:0,b:0};
 const script=[['a','timeout'],['b','timeout'],['a','timeout'],['b','ok'],['b','ok'],['b','ok']];
 let step=0;
 const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/a',OPENROUTER_MODEL_FALLBACKS:'test/b'},maxCostUsd:1,fetcher:async(url,init)=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:['test/a','test/b'].map(id=>({id,pricing:{prompt:'0.0000001',completion:'0.0000001'}}))}));
  const model=JSON.parse(init.body).model.split('/').pop();
  const [who,action]=script[step++]??['b','ok'];
  callsTo[who]!==undefined&&callsTo[who]++;
  if(model.split('/').pop()!==who)throw new Error('unexpected route order '+model);
  if(action==='timeout')throw hang;
  return okBody();
 }});
 // Call 1: fresh order [a,b]: a hangs, b hangs -> exhausted
 await assert.rejects(m.generate('knowledge','instr',{x:1},schema,validate),/timeout/);
 assert.equal(routeHealthState()['test/a'].timeouts,1);
 assert.equal(routeHealthState()['test/b'].timeouts,1);
 // Call 2: both usable (1<2); hangOrdered keeps [a,b]; a hangs again -> cooldown
 await m.generate('knowledge','instr',{x:2},schema,validate);
 assert.equal(routeHealthState()['test/a'].timeouts,2,'two hangs put a route in cooldown');
 // Call 3: a must be skipped (cooldown); b serves directly
 callsTo.a=0;
 await m.generate('knowledge','instr',{x:3},schema,validate);
 assert.equal(callsTo.a,0,'a cooldown route is never called while skipped');
 assert.equal(routeHealthState()['test/a'].timeouts,2,'b succeeding does not forgive a hung route (sticky)');
 resetRouteHealth();
});

test('three consecutive successes forgive one recorded timeout',async()=>{
 const {createJsonModel,routeHealthState,resetRouteHealth}=await import('../dist/src/semantic/planning/model-adapter.js');
 resetRouteHealth();
 let hang=true;
 const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/solo'},maxCostUsd:1,fetcher:async(url,init)=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/solo',pricing:{prompt:'0.0000001',completion:'0.0000001'}}]}));
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/solo',pricing:{prompt:'0.0000001',completion:'0.0000001'}}]}));
  if(hang){hang=false;throw new Error('The operation was aborted due to timeout');}
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:10,cost:.000001}}));
 }});
 const schema={type:'object',required:['ok'],properties:{ok:{type:'boolean'}}};
 const validate=value=>value;
 await assert.rejects(m.generate('knowledge','instr',{x:1},schema,validate),/timeout/);
 assert.equal(routeHealthState()['test/solo'].timeouts,1);
 await m.generate('knowledge','instr',{x:2},schema,validate);
 await m.generate('knowledge','instr',{x:3},schema,validate);
 await m.generate('knowledge','instr',{x:4},schema,validate);
 assert.equal(routeHealthState()['test/solo'].timeouts,0,'three successes forgive the recorded timeout');
 resetRouteHealth();
});

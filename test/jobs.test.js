import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {JobStore,classifyError} from '../dist/src/jobs.js';
import {makeServer} from '../dist/src/server.js';
const options={mode:'fixture',fixture:'attention',delayMs:30,narration:false};
async function setup(t,providers={}){const root=await mkdtemp(join(tmpdir(),'canvas-test-'));const store=new JobStore(root,providers);t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return {store,root};}
test('H18/H20 scenes become playable before completion and grow monotonically',async t=>{
  const {store}=await setup(t);const initial=await store.create(options);const history=[];
  for(let i=0;i<200;i++){const job=await store.get(initial.id);history.push(job);if(job.status==='complete')break;await delay(5);}
  assert.equal(history.at(-1).status,'complete');assert(history.some(j=>j.scenes.length>0&&j.status!=='complete'));
  for(let i=1;i<history.length;i++){assert(history[i].availableMs>=history[i-1].availableMs);assert(history[i].revision>=history[i-1].revision);}
  assert.equal(history.at(-1).scenes.length,4);
});
test('H22 cancelling during a delay stops future scene commits',async t=>{
  const {store}=await setup(t);const j=await store.create({...options,delayMs:150});await store.cancel(j.id);
  const result=await store.get(j.id);assert.equal(result.status,'cancelled');assert.equal(result.scenes.length,0);
});
test('H22 a failing TTS scene degrades to estimated timing; later scenes still commit',async t=>{
  // Scene tasks run concurrently (bounded); fail deterministically on the 'qkv' scene's
  // own narration. Per harness §56 a TTS failure must not kill the job: the scene is
  // committed with explicitly-estimated (silent) timing and the failure stays visible.
  const {store}=await setup(t,{speech:async text=>{
    if(text.includes('learned vectors, not literal questions'))throw new Error('Synthetic outage');
    const {estimateTiming}=await import('../dist/src/engine.js');return {audio:Buffer.from('test'),timing:estimateTiming(text)};
  }});
  const j=await store.create({...options,delayMs:0,narration:true});await store.jobs.get(j.id).task;
  const result=await store.get(j.id);
  assert.equal(result.status,'partial','degraded scene makes the job partial, never a silent success');
  assert.equal(result.scenes.length,4,'later scenes still commit');
  assert.equal(result.fallbackCount,1);
  assert.deepEqual(result.degradedScenes.map(d=>d.id),['qkv']);
  assert.match(result.degradedScenes[0].reason,/Synthetic outage/);
  const qkv=result.scenes.find(s=>s.id==='qkv');
  assert.equal(qkv.timing.kind,'estimated');
  assert.equal(qkv.audioUrl,undefined);
});
test('H22 restart reports interrupted work, preserves committed snapshots',async t=>{
  const {store,root}=await setup(t);const id='11111111-1111-1111-1111-111111111111';await mkdir(join(root,id));
  await writeFile(join(root,id,'job.json'),JSON.stringify({id,status:'preparing',scenes:[{id:'saved'}]}));
  const result=await store.get(id);assert.equal(result.status,'interrupted');assert.equal(result.scenes[0].id,'saved');
});
test('HTTP job lifecycle, assets, missing media and cross-origin protection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'canvas-http-'));const {server,store}=makeServer({dataRoot:root});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await store.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const player=await fetch(base+'/api/client-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'seek',jobId:null,timeMs:5000,rate:1})});assert.equal(player.status,200);
  const invalidPlayer=await fetch(base+'/api/client-events',{method:'POST',body:JSON.stringify({type:'arbitrary-log',jobId:null,timeMs:0,rate:1})});assert.equal(invalidPlayer.status,400);
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/src/engine.js')).status,200);assert.equal((await fetch(base+'/.env')).status,404);
  const forbidden=await fetch(base+'/api/jobs',{method:'POST',headers:{Origin:'https://unrelated.example'},body:JSON.stringify(options)});assert.equal(forbidden.status,403);
  const response=await fetch(base+'/api/jobs',{method:'POST',body:JSON.stringify({...options,delayMs:0})});assert.equal(response.status,202);const j=await response.json();await store.jobs.get(j.id).task;
  assert.equal((await (await fetch(base+`/api/jobs/${j.id}`)).json()).status,'complete');
});
test('Voice selection reaches speech adapter and preparation events are persisted',async t=>{
  const calls=[];const {store}=await setup(t,{speech:async(text,options)=>{calls.push(options.voiceId);const {estimateTiming}=await import('../dist/src/engine.js');return {audio:Buffer.from('test'),timing:estimateTiming(text)};}});
  const j=await store.create({...options,delayMs:0,narration:true,ttsProvider:'elevenlabs',voiceId:'chosen'});await store.jobs.get(j.id).task;
  const job=await store.get(j.id);assert.equal(job.status,'complete');assert.deepEqual(calls,['chosen','chosen','chosen','chosen']);assert(job.events.some(e=>e.type==='speech-started'));
  await assert.rejects(store.create({...options,ttsProvider:'invalid'}),/Unknown TTS/);
});
test('Quota errors remain visible: degraded scenes are marked, never a silent success',async t=>{
  const {store}=await setup(t,{speech:async()=>{throw new Error('Speech HTTP 402 quota');}});
  const j=await store.create({...options,delayMs:0,narration:true});await store.jobs.get(j.id).task;
  const job=await store.get(j.id);
  assert.equal(job.status,'partial','a provider failure is never reported as a clean complete job');
  assert.equal(job.scenes.length,4);
  assert.equal(job.fallbackCount,4);
  assert.match(job.degradedScenes[0].reason,/402/);
  assert(job.scenes.every(s=>s.timing.kind==='estimated'&&!s.audioUrl),'every degraded scene is explicitly estimated and silent');
});
test('A6: job snapshot is stamped with the generation manifest version',async t=>{
  const {store}=await setup(t);
  const job=await store.create(options);
  assert.equal(typeof job.manifestVersion,'string');
  assert(job.manifestVersion.length>0);
  const fetched=await store.get(job.id);
  assert.equal(fetched.manifestVersion,job.manifestVersion,'the stamped version survives a save/reload round trip');
});
test('failure taxonomy: timeout, truncation, refusal and model-schema errors are distinguishable',()=>{
  assert.equal(classifyError('The operation was aborted due to timeout'),'timeout');
  assert.equal(classifyError('Model output truncated at 3000 tokens'),'provider-truncated');
  assert.equal(classifyError('Provider returned no completion (finish_reason=length)'),'provider-truncated');
  assert.equal(classifyError('Provider content filter blocked this request'),'provider-refused');
  assert.equal(classifyError('Invalid conceptId (node c)'),'plan');
  assert.equal(classifyError('Speech HTTP 402 quota'),'speech');
  assert.equal(classifyError('something entirely new'),'unknown');
});

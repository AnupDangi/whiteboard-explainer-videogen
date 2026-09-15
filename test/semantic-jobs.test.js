import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SemanticJobStore,classifySemanticError} from '../dist/src/semantic/jobs.js';
import {contractsFromScene} from '../dist/src/semantic/harness/state.js';
import {makeServer} from '../dist/src/server.js';
import {wordsFromDuration} from '../dist/src/shared/voice-engine-client.js';
import {readFileSync} from 'node:fs';
const sceneJson=()=>{const s=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const o of s.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(o.id))o.conceptId=o.id;return s;};
const teaching=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
/** Deterministic mock model: teaching returns the fixture plan; director returns the fixture scene. */
function mockModel(calls){
  calls=calls||[];
  return {calls,async generate(stage,_instructions,_input,_schema,validate){
    calls.push({stage});
    return validate(stage==='teaching'?teaching():{scene:sceneJson(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'root and leaf labels',movingRelations:'input flows',persistentContext:'plant',stateChanges:'activation',omit:'detailed chemistry'}});
  }};
}
function factories(calls){
  calls=calls||[];
  let i=0;
  return {model:()=>mockModel(calls[i++]||[]),speech:language=>async text=>({timing:wordsFromDuration(text,2000),audio:Buffer.from('wav-audio'),format:'wav'})};
}
test('semantic job lifecycle: create → scenes pushed in order → complete snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-jobs-'));
  const store=new SemanticJobStore(root,factories());
  try{
    const snapshot=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:true,maxScenes:1});
    assert.ok(['queued','planning','streaming'].includes(snapshot.status));
    const done=await waitFor(()=>store.get(snapshot.id),j=>j&&['complete','partial','error'].includes(j.status));
    assert.equal(done.status,'complete');
    assert.equal(done.scenes.length,1);
    assert.ok(done.firstPlayableMs!==undefined&&done.firstPlayableMs>=0);
    assert.ok(done.availableMs>0);
    assert.equal(done.narration,true);
    assert.equal(done.finalGate,'PASS');assert.equal(done.publishable,true);assert.equal(done.harnessVersion,'teaching-compiler-v1');
    const persisted=JSON.parse(await readFile(join(root,snapshot.id,'job.json'),'utf8'));
    assert.equal(persisted.status,'complete');
    const manifest=JSON.parse(await readFile(join(root,snapshot.id,'harness-manifest.json'),'utf8'));
    assert.equal(manifest.status,'PASS');assert.ok(manifest.stages.some(stage=>stage.stage==='render'));
    const journal=(await readFile(join(root,snapshot.id,'stage-journal.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(journal[0].stage,'ingest');assert.equal(journal.at(-1).stage,'render');
  }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('semantic job without narration stays silent; audio url absent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-jobs-'));
  const store=new SemanticJobStore(root,{model:factories().model});
  try{
    const snapshot=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false});
    const done=await waitFor(()=>store.get(snapshot.id),j=>j&&['complete','partial','error'].includes(j.status));
    assert.equal(done.status,'complete');
    assert.equal(done.scenes[0].audioUrl,undefined);
  }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('validation rejects bad input before any model call',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-jobs-'));
  const calls=[];
  const store=new SemanticJobStore(root,factories(calls));
  try{
    await assert.rejects(()=>store.create({prompt:'   ',allowedArchetypes:['structural_diagram','convergence'],narration:false}));
    await assert.rejects(()=>store.create({prompt:'x',allowedArchetypes:[],narration:false}));
    await assert.rejects(()=>store.create({prompt:'x',allowedArchetypes:['BAD!'],narration:false}));
    await assert.rejects(()=>store.create({prompt:'x',allowedArchetypes:['structural_diagram','convergence'],narration:false,maxCostUsd:5}));
    await assert.rejects(()=>store.create({prompt:'x',allowedArchetypes:['structural_diagram','convergence'],narration:false,language:'toolonglanguage!!'}));
    assert.equal(calls.length,0);
  }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('model failure with zero scenes is error; with committed scenes is partial',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-jobs-'));
  const store=new SemanticJobStore(root,{model:()=>({calls:[],async generate(){throw new Error('V2 teaching validation exhausted: bad');}})});
  try{
    const snapshot=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false});
    const done=await waitFor(()=>store.get(snapshot.id),j=>j&&['complete','partial','error'].includes(j.status));
    assert.equal(done.status,'error');
    assert.equal(done.errorKind,'plan');
    assert.equal(done.scenes.length,0);
  }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('wrong long-form duration retains previews but withholds MP4 publication',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-duration-')),store=new SemanticJobStore(root,{model:()=>mockModel()});
  try{const created=await store.create({prompt:'One hour lesson',allowedArchetypes:['structural_diagram','convergence'],narration:false,targetMinutes:60});const done=await waitFor(()=>store.get(created.id),job=>job&&['complete','partial','error'].includes(job.status));assert.equal(done.status,'partial');assert.equal(done.finalGate,'FAIL');assert.equal(done.publishable,false);assert.equal(done.mp4Status,'withheld');assert.equal(done.scenes.length,1);assert.equal(done.errorKind,'timing');await assert.rejects(()=>store.exportMp4(done.id),/not publishable/);}
  finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('failure taxonomy maps stage errors to kinds',()=>{
  assert.equal(classifySemanticError('V2 teaching validation exhausted: x'),'plan');
  assert.equal(classifySemanticError('V2 cost ceiling exhausted'),'budget');
  assert.equal(classifySemanticError('OpenRouter 503: down'),'provider');
  assert.equal(classifySemanticError('aborted due to timeout'),'timeout');
  assert.equal(classifySemanticError('mystery'),'unknown');
});
test('SSE stream pushes scenes as they become ready and ends on completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-sse-'));
  const {server,semanticStore}=makeServer({dataRoot:root,providers:{}});
  // Inject mock factories into the running server's store.
  Object.assign(semanticStore.factories,{model:()=>mockModel(),speech:factories().speech});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}`;
    const created=await (await fetch(base+'/api/semantic/jobs',{method:'POST',body:JSON.stringify({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false})})).json();
    const id=created.id;
    const streamText=await new Promise((resolve,reject)=>{
      fetch(base+`/api/semantic/jobs/${id}/stream`).then(r=>r.body.getReader()).then(reader=>{
        let text='';const decode=new TextDecoder();
        const pump=async()=>{const {done,value}=await reader.read();if(done)return resolve(text);text+=decode.decode(value);if(text.includes('event: end'))return resolve(text);pump();};
        pump();
      }).catch(reject);
    });
    assert.ok(streamText.includes('event: scene'));
    assert.ok(streamText.includes('event: end'));
    assert.ok(streamText.includes('"status":"complete"'));
    // Offset resume: from=1 replays nothing (only 1 scene), from=0 replays the scene.
    const resumed=await (await fetch(base+`/api/semantic/jobs/${id}/stream?from=1`)).text();
    assert.ok(!resumed.includes('event: scene'));
    assert.ok(resumed.includes('event: end'));
  }finally{await semanticStore.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('polling fallback: GET /api/semantic/jobs/:id returns snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'semantic-poll-'));
  const {server,semanticStore}=makeServer({dataRoot:root,providers:{}});
  Object.assign(semanticStore.factories,{model:()=>mockModel(),speech:factories().speech});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}`;
    const created=await (await fetch(base+'/api/semantic/jobs',{method:'POST',body:JSON.stringify({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false})})).json();
    await waitFor(()=>semanticStore.get(created.id),j=>j&&['complete','partial','error'].includes(j.status));
    const polled=await (await fetch(base+`/api/semantic/jobs/${created.id}`)).json();
    assert.equal(polled.status,'complete');
    assert.equal((await fetch(base+`/api/semantic/jobs/${created.id}/cancel`,{method:'POST'})).status,200);
    assert.equal((await fetch(base+'/api/semantic/jobs/00000000-0000-0000-0000-000000000000')).status,404);
  }finally{await semanticStore.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
async function waitFor(get,predicate){
  for(let i=0;i<600;i++){const v=await get();if(predicate(v))return v;await new Promise(r=>setTimeout(r,50));}
  throw new Error('waitFor timeout');
}

test('requested budget and cancellation reach the provider; ready artifacts exist',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-contract-'));let context;
 const store=new SemanticJobStore(root,{model:(env,options)=>{context=options;return mockModel();}});
 try{
  const created=await store.create({prompt:'Plant',allowedArchetypes:['convergence','structural_diagram'],narration:false,maxCostUsd:.42});
  assert.equal(context.maxCostUsd,.42);
  const done=await waitFor(()=>store.get(created.id),j=>j.status==='complete');
  assert.ok(done.scenes[0].compiledUrl.endsWith('.json'));
  assert.ok(JSON.parse(await readFile(join(root,done.id,done.scenes[0].id+'.json'),'utf8')));
  assert.equal(done.costUsd,0);
  await store.cancel(done.id);assert.equal(context.signal.aborted,true);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('failed or delayed artifact persistence never advertises an unreadable scene',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-disk-'));const store=new SemanticJobStore(root,{model:()=>mockModel()});
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 store.writeArtifact=async()=>{await blocked;throw new Error('disk full');};
 try{
  const created=await store.create({prompt:'Plant',allowedArchetypes:['convergence','structural_diagram'],narration:false});
  await new Promise(r=>setTimeout(r,20));assert.equal((await store.get(created.id)).scenes.length,0);
  release();const done=await waitFor(()=>store.get(created.id),j=>j.status==='error');
  assert.equal(done.scenes.length,0);assert.match(done.error,/disk full/);
 }finally{release();await store.close();await rm(root,{recursive:true,force:true});}
});

test('autoMp4 assembles the final file without failing the job',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-automp4-'));
 const store=new SemanticJobStore(root,{model:()=>mockModel()},join(root,'output'));
 let assembled=null;
 store.exportMp4=async id=>{assembled=id;return {output:`/output/${id}.mp4`,size:'1 KB'};};
 try{
  const created=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,autoMp4:true});
  const done=await waitFor(()=>store.get(created.id),j=>j&&['complete','partial','error'].includes(j.status)&&j.mp4Status!==undefined&&j.mp4Status!=='pending');
  assert.equal(done.status,'complete');assert.equal(assembled,done.id);
  assert.equal(done.mp4Status,'ready');assert.equal(done.mp4Url,`/output/${done.id}.mp4`);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('autoMp4 failure is recorded loudly; the lesson stays complete',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-automp4-fail-'));
 const store=new SemanticJobStore(root,{model:()=>mockModel()},join(root,'output'));
 store.exportMp4=async()=>{throw new Error('encoder unavailable');};
 try{
  const created=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,autoMp4:true});
  const done=await waitFor(()=>store.get(created.id),j=>j&&['complete','partial','error'].includes(j.status)&&j.mp4Status!==undefined&&j.mp4Status!=='pending');
  assert.equal(done.status,'complete');assert.equal(done.mp4Status,'failed');assert.match(done.mp4Error,/encoder unavailable/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('jobs without autoMp4 leave assembly state untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-noautomp4-'));
 const store=new SemanticJobStore(root,{model:()=>mockModel()},join(root,'output'));
 let calls=0;store.exportMp4=async()=>{calls++;return {output:'/output/x.mp4',size:'1 KB'};};
 try{
  const created=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false});
  const done=await waitFor(()=>store.get(created.id),j=>j&&['complete','partial','error'].includes(j.status));
  assert.equal(done.status,'complete');assert.equal(calls,0);assert.equal(done.mp4Status,undefined);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('document source is ingested and grounded as teaching evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-source-'));
 let teachingInput=null;
 const model={calls:[],async generate(stage,_instructions,input,_schema,validate){
  this.calls.push({stage});
  if(stage==='knowledge')return validate({version:1,concepts:['plant','sunlight','water','carbon_dioxide'].map(key=>({key,canonicalName:key,aliases:[],semanticType:'entity',evidenceRefs:['e1']})),prerequisites:[],mechanisms:[{id:'inputs_mechanism',statement:'Inputs enable plant food production',conceptIds:['plant'],requiresStateChange:false,evidenceRefs:['e1']}],claims:[{id:'light_claim',statement:'light claim',critical:true,evidenceRefs:['e1']},{id:'water_claim',statement:'water claim',critical:true,evidenceRefs:['e1']},{id:'carbon_claim',statement:'carbon claim',critical:true,evidenceRefs:['e1']}],quantities:[],terminology:[],evidence:[{id:'e1',sourceId:input.sourceId,quote:'sunlight, water and carbon dioxide'}]});
  if(stage==='architect'){const p=teaching();const scene=input.scene;const contracts=contractsFromScene(scene,p,input.learnerState);return validate({contracts:contracts.map((contract,index)=>({beatKey:scene.beats[index].id,objective:contract.objective,motivation:contract.motivation,prerequisites:contract.prerequisites,learnerDelta:contract.learnerDelta,strategy:contract.strategy,mechanismIds:contract.mechanismIds,evidenceRefs:contract.evidenceRefs,...(contract.misconception?{misconception:contract.misconception}:{}),...(contract.checkpoint?{checkpoint:{prompt:contract.checkpoint.prompt,expectedUnderstanding:contract.checkpoint.expectedUnderstanding,kind:contract.checkpoint.kind}}:{})}))});}
  if(stage==='teaching'){teachingInput=input;const p=teaching();p.evidenceRefs=[{id:'e1',sourceId:input.sourceId,quote:'sunlight, water and carbon dioxide'}];for(const s of p.scenes)for(const b of s.beats)if(b.requirementIds.length)b.evidenceRefs=['e1'];return validate(p);}
  const s=sceneJson();s.id=input.semanticScene.id;
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'inputs',labelsOnly:'none',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'none'}});
 }};
 const store=new SemanticJobStore(root,{model:()=>model});
 try{
  const created=await store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,source:{kind:'text',text:'Photosynthesis converts sunlight, water and carbon dioxide into glucose in the leaves of green plants.'}});
  const done=await waitFor(()=>store.get(created.id),j=>j&&['complete','partial','error'].includes(j.status));
  assert.equal(done.status,'complete');
  assert.ok(teachingInput.sourceText.includes('Photosynthesis'));
  assert.equal(typeof teachingInput.sourceId,'string');
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('source and sourceText together are rejected; bad kinds fail loudly',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-source-reject-'));
 const store=new SemanticJobStore(root,{model:()=>mockModel()});
 try{
  await assert.rejects(()=>store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,source:{kind:'text',text:'Enough characters to pass the readable minimum here.'},sourceText:'duplicate'}),/not both/);
  await assert.rejects(()=>store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,source:{kind:'fax',text:'Enough characters to pass the readable minimum here.'}}),/Choose prompt/);
  await assert.rejects(()=>store.create({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],narration:false,source:{kind:'text',text:'tiny'}}),/readable characters/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('exportMp4 rejects unknown jobs loudly',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-export404-'));
 const store=new SemanticJobStore(root,{model:()=>mockModel()},join(root,'output'));
 try{await assert.rejects(()=>store.exportMp4('00000000-0000-4000-8000-000000000000'),/Job not found/);}
 finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('multi-scene cost counts each call once and actual scene count wins over the cap',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-cost-'));
 const calls=[];
 const model={calls,async generate(stage,_instructions,input,_schema,validate){
  calls.push({stage,costUsd:.01});
  if(stage==='teaching'){const p=teaching();const second=structuredClone(p.scenes[0]);second.id='plant_again';p.scenes.push(second);return validate(p);}
  const s=sceneJson();s.id=input.semanticScene.id;
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'inputs',labelsOnly:'none',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'none'}});
 }};
 const store=new SemanticJobStore(root,{model:()=>model});
 try{
  const created=await store.create({prompt:'Plant',allowedArchetypes:['convergence','structural_diagram'],narration:false,maxScenes:3});
  const done=await waitFor(()=>store.get(created.id),j=>['complete','partial','error'].includes(j.status));
  assert.equal(done.status,'complete');assert.equal(done.scenes.length,2);assert.equal(done.totalScenes,2);assert.equal(done.costUsd,.03);assert.equal(done.calls,3);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

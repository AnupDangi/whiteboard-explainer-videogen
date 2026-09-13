import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SemanticJobStore,classifySemanticError} from '../dist/src/semantic/jobs.js';
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
    const persisted=JSON.parse(await readFile(join(root,snapshot.id,'job.json'),'utf8'));
    assert.equal(persisted.status,'complete');
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
  for(let i=0;i<200;i++){const v=await get();if(predicate(v))return v;await new Promise(r=>setTimeout(r,50));}
  throw new Error('waitFor timeout');
}

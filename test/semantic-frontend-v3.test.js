import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlocks} from '../dist/src/shared/ingestion/blocks.js';
import {generateV3,canonicalizeSceneIds} from '../dist/src/semantic/frontend/generate-v3.js';
import {createMemoryCache} from '../dist/src/semantic/cache/store.js';

const text='# Photosynthesis\n\nPlants use sunlight, water and carbon dioxide to make glucose.\n';
const doc={kind:'text',label:'Photosynthesis',text,sha256:'sha-v3-test',blocks:parseBlocks(text)};

const fragment={
  concepts:[{key:'plant',canonicalName:'Plant',aliases:['flora'],semanticType:'entity',evidenceRefs:['e1']}],
  relations:[],claims:[{id:'cl1',statement:'Plants use sunlight to make glucose.',critical:true,evidenceRefs:['e1']}],
  mechanisms:[],prerequisites:[],terminology:[],evidence:[{id:'e1',quote:'Plants use sunlight, water and carbon dioxide to make glucose.'}],
};
const rawLesson=()=>({
  lessonGraph:{title:'Photosynthesis',lessonGoal:'g',targetDurationSec:60,scenes:[{id:'s1',sequence:1,learningDelta:'Plants need light.',requiredConceptIds:['plant'],requiredRelations:[],mechanismIds:[],evidenceRefs:['e1'],targetDurationSec:60,narrationIntent:'introduce photosynthesis',candidateArchetypes:['flow'],continuityIn:[],continuityOut:[]}],continuity:{throughline:'light to sugar',persistentConceptIds:['plant']},endingGoal:'recall inputs'},
  lessonBible:{canonicalTerminology:[],conceptIdentity:[{conceptId:'plant',canonicalName:'Plant',aliases:['flora']}],visualIdentity:[],analogies:[],narrativeStyle:'direct',learnerLevel:'beginner',persistentObjects:[],introducedConceptsByScene:[{sceneId:'s1',conceptIds:['plant']}],forbiddenRepetition:[]},
});
const longNarration=Array(7).fill('Plants use sunlight, water and carbon dioxide to make glucose and release oxygen in the chloroplast.').join(' ');
const scene=id=>({version:2,id,title:'Photosynthesis',teachingGoal:'g',mentalModel:'light makes sugar',archetype:'flow',objects:[{id:'o1',conceptId:'plant',label:'Plant',role:'hero',primitiveRef:'label',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid'}],relations:[],beats:[{id:'b1',narration:longNarration,actions:[{id:'a1',type:'draw',objectIds:['o1'],relationIds:[],durationMs:800,leadMs:0,easing:'ease_in_out'}]}],continuity:{keepFromPrevious:[],prepareForNext:[]}});

function fakeModel(){
  const model={calls:[],events:[],async generate(stage,_i,input,_schema,validate){
    model.calls.push({stage});
    if(stage==='graphMap')return validate(fragment);
    if(stage==='teacherPlanner')return validate(rawLesson());
    if(stage==='sceneWorker')return validate({scenes:input.scenes.map(entry=>scene(entry.contract.id))});
    throw new Error(`unexpected stage ${stage}`);
  }};
  return model;
}

test('W5 generateV3: one source pass compiles scenes through the existing compiler',async()=>{
  const model=fakeModel();
  const results=[];
  for await(const result of generateV3(doc,{prompt:'photosynthesis',targetMinutes:1},model))results.push(result);
  assert.equal(results.length,1,'one scene yielded');
  const result=results[0];
  assert.equal(result.compiled.scene.id,'s1');
  assert.ok(result.compiled.durationMs>0,'the trusted compiler produced a duration');
  assert.equal(result.manifest.status,'PASS');
  assert.equal(result.manifest.config.pipeline,'semantic-v3');
  assert.deepEqual(result.learnerAfter.establishedConcepts,['plant']);
  const stages=model.calls.map(call=>call.stage).sort();
  assert.ok(stages.includes('graphMap')&&stages.includes('teacherPlanner')&&stages.includes('sceneWorker'));
});

test('W5 canonical ids: the same concept carries the same object id across scenes',()=>{
  const one=scene('s1');one.objects[0].id='obj-chloroplast';
  const two=scene('s2');two.objects[0].id='chloroplast_structure';
  canonicalizeSceneIds(one);canonicalizeSceneIds(two);
  assert.equal(one.objects[0].id,two.objects[0].id,'identity is concept-based, not worker-authored');
  assert.equal(one.objects[0].id,'obj_plant');
});

test('W5 generateV3: a warm cache buys zero model calls',async()=>{
  const store=createMemoryCache();
  const first=fakeModel();
  let produced=0;
  for await(const result of generateV3(doc,{prompt:'photosynthesis',targetMinutes:1},first,{store})){produced++;assert.ok(result.compiled.durationMs>0);}
  assert.equal(produced,1);
  assert.ok(first.calls.length>=3,'cold run calls graphMap, teacherPlanner and sceneWorker');
  const second=fakeModel();
  let reused=0;
  for await(const result of generateV3(doc,{prompt:'photosynthesis',targetMinutes:1},second,{store})){reused++;assert.ok(result.compiled.durationMs>0);}
  assert.equal(reused,1);
  assert.equal(second.calls.length,0,'source, lesson and scene caches all hit');
});

test('W5 generateV3: a scene-worker contract mismatch is a visible failure, never a silent scene',async()=>{
  const model={calls:[],events:[],async generate(stage,_i,_input,_schema,validate){
    model.calls.push({stage});
    if(stage==='graphMap')return validate(fragment);
    if(stage==='teacherPlanner')return validate(rawLesson());
    if(stage==='sceneWorker')return validate({scenes:[scene('wrong-id')]});
    throw new Error(`unexpected stage ${stage}`);
  }};
  await assert.rejects(async()=>{for await(const _result of generateV3(doc,{prompt:'photosynthesis',targetMinutes:1},model)){/* drain */}},/returned \[wrong-id\] for contracts \[s1\]/);
});

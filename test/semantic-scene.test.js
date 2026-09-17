import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceFragments} from '../dist/src/semantic/knowledge/reducer.js';
import {sceneBatches,runSceneWorkers,gateSceneIntent} from '../dist/src/semantic/scene/worker.js';
import {narrationForScene,ttsCacheKey,voiceProfileFromEnv} from '../dist/src/semantic/scene/voice.js';

const graph=reduceFragments([{
  concepts:[{key:'plant',canonicalName:'Plant',aliases:[],semanticType:'entity',evidenceRefs:['e1']}],
  relations:[],claims:[{id:'cl1',statement:'Plants use sunlight.',critical:true,evidenceRefs:['e1']}],
  mechanisms:[],prerequisites:[],terminology:[],evidence:[{id:'e1',quote:'Plants use sunlight.'}],
}]);
const bible={canonicalTerminology:{},conceptIdentity:{plant:{canonicalName:'Plant',aliases:[]}},visualIdentity:{},analogies:{},narrativeStyle:'direct',learnerLevel:'beginner',persistentObjects:[],introducedConceptsByScene:{},forbiddenRepetition:[]};
const contract=(id,sequence)=>({id,sequence,learningDelta:'d',requiredConceptIds:['plant'],requiredRelations:[],mechanismIds:[],evidenceRefs:['e1'],targetDurationSec:30,narrationIntent:'explain plant',candidateArchetypes:['flow'],continuityIn:[],continuityOut:[]});
const scene=(id)=>({version:2,id,title:'Photosynthesis',teachingGoal:'g',mentalModel:'m',archetype:'flow',objects:[{id:'o1',conceptId:'plant',label:'Plant',role:'hero',primitiveRef:'label',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid'}],relations:[],beats:[{id:'b1',narration:'Plants use sunlight.',actions:[{id:'a1',type:'draw',objectIds:['o1'],relationIds:[],durationMs:800,leadMs:0,easing:'ease_in_out'}]}],continuity:{keepFromPrevious:[],prepareForNext:[]}});

function workerModel(){
  const model={calls:[],events:[],async generate(stage,_i,input,_schema,validate){
    model.calls.push({stage,contractIds:input.scenes.map(s=>s.contract.id)});
    return validate({scenes:input.scenes.map(s=>scene(s.contract.id))});
  }};
  return model;
}

test('W4 batching: Scene 1 alone, then pairs, in sequence order',()=>{
  const batches=sceneBatches([contract('s1',1),contract('s2',2),contract('s3',3),contract('s4',4),contract('s5',5)]);
  assert.deepEqual(batches.map(batch=>batch.map(c=>c.id)),[['s1'],['s2','s3'],['s4','s5']]);
});

test('W4 worker: one call decides narration and visual intent per batch',async()=>{
  const model=workerModel();
  const scenes=await runSceneWorkers([contract('s1',1),contract('s2',2),contract('s3',3)],{graph,bible,evidence:{}},{model});
  assert.equal(model.calls.length,2,'scene 1 alone, then the pair');
  assert.ok(model.calls.every(call=>call.stage==='sceneWorker'));
  assert.deepEqual(scenes.map(s=>s.id),['s1','s2','s3']);
  assert.match(scenes[0].beats[0].narration,/Plants use sunlight/);
});

test('W4 gate: closed-world concepts, archetype candidacy and required coverage are enforced',()=>{
  const input={graph};
  assert.equal(gateSceneIntent(scene('s1'),contract('s1',1),input).passed,true);
  const unknown={...scene('s1'),objects:[{...scene('s1').objects[0],conceptId:'ghost'}]};
  assert.ok(gateSceneIntent(unknown,contract('s1',1),input).findings.some(f=>/unknown concept ghost/.test(f)));
  const badArchetype={...scene('s1'),archetype:'chart'};
  assert.ok(gateSceneIntent(badArchetype,contract('s1',1),input).findings.some(f=>/not a candidate/.test(f)));
  const missing={...scene('s1'),objects:[{...scene('s1').objects[0],conceptId:undefined}]};
  assert.ok(gateSceneIntent(missing,contract('s1',1),input).findings.some(f=>/does not represent required concept plant/.test(f)));
});

test('W4 worker: a batch that omits a contract scene is rejected',async()=>{
  const wrong={calls:[],events:[],async generate(_stage,_i,_input,_schema,validate){return validate({scenes:[scene('s2')]});}};
  await assert.rejects(runSceneWorkers([contract('s1',1),contract('s2',2)],{graph,bible,evidence:{}},{model:wrong}),/returned \[s2\] for contracts \[s1\]/);
});

test('W4 gate: structural archetypes need a hero and every object a primitive carrier',()=>{
  const structural={...scene('s1'),archetype:'structural_diagram',objects:[{...scene('s1').objects[0],role:'support'}]};
  assert.ok(gateSceneIntent(structural,{...contract('s1',1),candidateArchetypes:['structural_diagram']},{graph}).findings.some(f=>/exactly one hero/.test(f)));
  const representationOnly={...scene('s1'),objects:[{id:'o1',conceptId:'plant',label:'Plant',role:'hero',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid'}]};
  assert.ok(gateSceneIntent(representationOnly,contract('s1',1),{graph}).findings.some(f=>/exactly one primitiveRef or assetRef/.test(f)));
});

test('W4 heal: an object nobody draws gets a reveal instead of failing the lesson',async()=>{
  const model={calls:[],events:[],async generate(_stage,_i,_input,_schema,validate){
    const value=scene('s1');
    value.objects.push({id:'o2',label:'Leaf',role:'support',primitiveRef:'label',children:[],state:'neutral',allowedStates:['neutral'],importance:'secondary',collisionPolicy:'forbid'});
    return validate({scenes:[value]});
  }};
  const scenes=await runSceneWorkers([contract('s1',1)],{graph,bible,evidence:{}},{model});
  const actions=scenes[0].beats[0].actions;
  assert.ok(actions.some(a=>a.type==='reveal'&&a.objectIds.includes('o2')),'the untargeted object was revealed');
});

test('W4 heal: object state and structural hero are normalized',async()=>{
  const model={calls:[],events:[],async generate(_stage,_i,_input,_schema,validate){
    const value=scene('s1');
    value.archetype='structural_diagram';
    value.objects[0]={...value.objects[0],role:'support',state:'activated',allowedStates:['neutral']};
    return validate({scenes:[value]});
  }};
  const scenes=await runSceneWorkers([{...contract('s1',1),candidateArchetypes:['structural_diagram']}],{graph,bible,evidence:{}},{model});
  assert.equal(scenes[0].objects.filter(o=>o.role==='hero').length,1,'a structural scene ends with exactly one hero');
  assert.ok(scenes[0].objects[0].allowedStates.includes('activated'),'the object state is a declared state');
});

test('W4 voice: one narration per scene and a version-sensitive TTS cache key',()=>{
  const profile=voiceProfileFromEnv({},'en');
  assert.equal(narrationForScene(scene('s1')),'Plants use sunlight.');
  const key=ttsCacheKey(profile,'Plants use sunlight.');
  assert.equal(key,ttsCacheKey(profile,'Plants use sunlight.'));
  assert.notEqual(key,ttsCacheKey(profile,'Different narration.'));
  assert.notEqual(key,ttsCacheKey({...profile,voiceId:'other'},'Plants use sunlight.'));
});

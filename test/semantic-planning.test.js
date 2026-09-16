import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateTeachingPlan} from '../dist/src/semantic/planning/validate.js';
import {createJsonModel} from '../dist/src/semantic/planning/model-adapter.js';
import {planTeaching} from '../dist/src/semantic/planning/teaching-planner.js';
import {repairOwner,toRepairFailure} from '../dist/src/semantic/repair.js';
import {selectVisualModel} from '../dist/src/semantic/planning/visual-model.js';
import {finalizeNarration} from '../dist/src/semantic/planning/narration.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';
const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
const visual=()=>{const s=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const o of s.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(o.id))o.conceptId=o.id;return s;};
const intent=()=>{const p=plan();p.conceptRegistry=p.conceptRegistry.map(({id,...c})=>({...c,key:id}));p.requiredMechanisms=p.requiredMechanisms.map(({conceptIds,...m})=>({...m,conceptKeys:conceptIds}));p.scenes=p.scenes.map(({id,centralConceptId,requiredConceptIds,requiredRelations,beats,...s})=>({...s,key:id,centralConceptKey:centralConceptId,requiredConceptKeys:requiredConceptIds,requiredRelations:requiredRelations.map(({id,fromConceptId,toConceptId,relationType,targetAnchor})=>({key:id,fromConcept:fromConceptId,toConcept:toConceptId,relation:relationType,...(targetAnchor?{targetPart:targetAnchor}:{})})),beats:beats.map(({id,transform,...b})=>({...b,key:id,transform:transform.map(({conceptId,...t})=>({...t,conceptKey:conceptId}))}))}));return p;};
const model=()=>({calls:[],async generate(stage,_instructions,_input,_schema,validate){return validate(stage==='teaching'?plan():{scene:visual(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'root and leaf labels',movingRelations:'input flows',persistentContext:'plant',stateChanges:'activation',omit:'detailed chemistry'}});}});
const input={prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1};
test('V2 teaching plan covers claims and mechanisms with global concept identity',()=>{assert.equal(validateTeachingPlan(plan()).warnings.length,0);
 // Stripping requirementIds from the combine beat heals deterministically: the mechanism
 // reattaches to the establishment beat whose narration still states it.
 {const p=plan();p.scenes[0].beats[4].requirementIds=[];assert.throws(()=>validateTeachingPlan(p),/Uncovered critical/);}
 for(const mutate of [p=>p.scenes[0].beats[0].introduce=['unknown'],p=>p.scenes[0].beats[0].evidenceRefs=['fabricated'],p=>p.conceptRegistry[1].aliases=['Plant'],p=>p.scenes[0].beats[1].narrationDraft=p.scenes[0].beats[0].narrationDraft,p=>p.requiredMechanisms[0].requiresStateChange=true]){const p=plan();mutate(p);assert.throws(()=>validateTeachingPlan(p));}});
test('V2 mental model selection respects archetype gates and central semantic relations',()=>{const p=plan(),s=p.scenes[0],m=selectVisualModel(s,p.conceptRegistry,{keepFromPrevious:[],prepareForNext:[]},['structural_diagram']);assert.deepEqual(m.heroConceptIds,['plant']);assert.throws(()=>selectVisualModel(s,p.conceptRegistry,{keepFromPrevious:[],prepareForNext:[]},['flow']));});
test('V2 source-grounded planning rejects fabricated evidence and prompt-only invented sources',async()=>{const fake=model();fake.generate=async(_s,_i,_input,_schema,validate)=>{const p=plan();p.evidenceRefs=[{id:'evidence',sourceId:'source',quote:'made up'}];p.scenes[0].beats.forEach(b=>b.evidenceRefs=['evidence']);return validate(p);};await assert.rejects(planTeaching({...input,sourceText:'An actual source paragraph.'},fake),/Fabricated evidence/);await assert.rejects(planTeaching(input,fake),/invent evidence/);});
test('V2 narration is frozen only after visual feasibility, before speech starts',async()=>{const order=[],m=model(),original=m.generate;m.generate=async(...args)=>{order.push(args[0]);return original(...args);};const results=[];for await(const r of generateV2(input,m)){results.push(r);assert.ok(Object.isFrozen(r.narration));assert.ok(Object.isFrozen(r.narration.beats));}assert.deepEqual(order,['teaching','director']);assert.equal(results.length,1);assert.equal(results[0].compiled.timing.kind,'estimated');assert.throws(()=>finalizeNarration(plan().scenes[0],{...visual(),beats:[]}),/mismatch/);});
test('V2 speech failure cannot become an estimated successful generation',async()=>{await assert.rejects(async()=>{for await(const _ of generateV2(input,model(),{speech:async()=>{throw new Error('Speech unavailable');}})){}},/Speech unavailable/);});
test('V2 provider shares a cost budget and repairs invalid JSON only once',async()=>{let posts=0;const calls=[];const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/model'},maxCostUsd:.1,fetcher:async(url,init)=>{if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000001'}}]}));posts++;calls.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(posts===1?{bad:true}:intent())}}],usage:{prompt_tokens:100,completion_tokens:200,cost:.00003}}));}});await planTeaching(input,m);assert.equal(posts,2);assert.equal(m.calls.length,2);assert.ok(calls[1].messages[1].content.includes('Previous output failed'));assert.equal(m.calls.reduce((s,c)=>s+c.costUsd,0),.00006);});
test('V2 provider exposes HTTP failures without fixture fallback or retry spend',async()=>{let posts=0;const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/model'},fetcher:async url=>{if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/model',pricing:{prompt:'0',completion:'0'}}]}));posts++;return new Response('Unavailable',{status:503});}});await assert.rejects(planTeaching(input,m),/503/);assert.equal(posts,1);});

test('typed repair failures route to the owning subsystem',()=>{
  const failure=toRepairFailure(new Error('missing semantic anchor'),'representation');
  assert.equal(failure.class,'REPRESENTATION');
  assert.equal(repairOwner(failure),'representation-resolver');
  assert.equal(repairOwner({class:'GEOMETRY'}),'compiler');
  assert.equal(repairOwner({class:'TIMING'}),'timeline');
});
test('V2 provider refuses an unpriced or unaffordable model before generation',async()=>{let posts=0;const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'expensive'},maxCostUsd:.001,fetcher:async url=>{if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'expensive',pricing:{prompt:'1',completion:'1'}}]}));posts++;throw new Error('Unexpected request');}});await assert.rejects(planTeaching(input,m),/budget/);assert.equal(posts,0);});

test('V2 route health retries models that hung to the request timeout last',async()=>{
 const asked=[];
 const respond=init=>{const model=JSON.parse(init.body).model;
  if(model==='test/c')return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(intent())}}],usage:{prompt_tokens:100,completion_tokens:200,cost:.00003}}));
  throw new Error(`The operation was aborted due to timeout`);};
 const fetcher=async(url,init)=>{if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:['test/a','test/b','test/c'].map(id=>({id,pricing:{prompt:'0.0000001',completion:'0.0000001'}}))}));
  asked.push({model:JSON.parse(init.body).model});
  return respond(init);};
 const m=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/a',OPENROUTER_MODEL_FALLBACKS:'test/b,test/c'},maxCostUsd:1,fetcher});
 await planTeaching(input,m);
 const second=await planTeaching(input,m);
 assert.equal(m.calls.length,2);
 const sequence=asked.map(entry=>entry.model);
 assert.deepEqual(sequence.slice(0,3),['test/a','test/b','test/c']);
 assert.ok(sequence.at(-1)!=='test/b',`hung model must not be retried before a healthy route: ${sequence.join(',')}`);
 assert.equal(sequence.at(-1),'test/c');
 void second;
});

test('V2 teaching evidence validates against the full source scope, not the chapter window',async()=>{
 const scope='Leaves capture sunlight.\nRoots absorb water from the soil.';
 const withEvidence=(quote,id='evidence')=>{const build=()=>{const p=intent();p.evidenceRefs=[{id,sourceId:'source',quote}];p.scenes[0].beats.forEach(beat=>beat.evidenceRefs=[id]);return p;};return {generate:async(_s,_i,_inp,_schema,validate)=>validate(build())};};
 const plan=await planTeaching({...input,sourceText:'Leaves capture sunlight.',evidenceScope:scope,sourceId:'source'},withEvidence('Roots absorb water from the soil.'));
 assert.ok(scope.includes(plan.evidenceRefs[0].quote),'evidence from another chapter window is accepted');
 const snapped=await planTeaching({...input,sourceText:'Leaves capture sunlight.',evidenceScope:scope,sourceId:'source'},withEvidence('Plant roots take up water from the soil.'));
 assert.ok(scope.includes(snapped.evidenceRefs[0].quote),'mild paraphrase snaps to real source text');
 await assert.rejects(planTeaching({...input,sourceText:'Leaves capture sunlight.',evidenceScope:scope,sourceId:'source'},withEvidence('Quantum tunnelling explains gravity.')),/Fabricated evidence/);
});

test('teaching rejects a scene whose concepts cannot fit any candidate archetype',async()=>{
 const plan=intent();
 plan.conceptRegistry=[...plan.conceptRegistry,{key:'extra1',canonicalName:'Extra One',aliases:[],semanticType:'entity',evidenceRefs:[]},{key:'extra2',canonicalName:'Extra Two',aliases:[],semanticType:'entity',evidenceRefs:[]},{key:'extra3',canonicalName:'Extra Three',aliases:[],semanticType:'entity',evidenceRefs:[]}];
 plan.scenes[0].candidateArchetypes=['cycle'];
 plan.scenes[0].requiredConceptKeys=['plant','sunlight','water','carbon_dioxide','extra1','extra2','extra3'];
 plan.scenes[0].beats[0].introduce=[...new Set([...(plan.scenes[0].beats[0].introduce??[]),'extra1','extra2','extra3'])];
 const model={generate:async(_s,_i,_inp,_schema,validate)=>validate(structuredClone(plan))};
 await assert.rejects(planTeaching({...input,allowedArchetypes:['cycle']},model),/no candidate archetype/);
 const fitting=structuredClone(plan);fitting.scenes[0].requiredConceptKeys=['plant','sunlight','water','carbon_dioxide','extra1','extra2'];
 fitting.scenes[0].beats[0].introduce=fitting.scenes[0].beats[0].introduce.filter(key=>fitting.scenes[0].requiredConceptKeys.includes(key));
 const model2={generate:async(_s,_i,_inp,_schema,validate)=>validate(structuredClone(fitting))};
 const accepted=await planTeaching({...input,allowedArchetypes:['cycle']},model2);
 assert.equal(accepted.scenes[0].requiredConceptIds.length,6);
});

test('archetype selection prefers a family that can hold the scene concept count',async()=>{
 const scene={...plan().scenes[0],candidateArchetypes:['cycle','flow'],requiredConceptIds:['plant','sunlight','water','carbon_dioxide','extra1','extra2','extra3']};
 const registry=[...plan().conceptRegistry,...['extra1','extra2','extra3'].map(id=>({id,canonicalName:id,aliases:[],semanticType:'entity'}))];
 const model=selectVisualModel(scene,registry,{keepFromPrevious:[],prepareForNext:[]},['flow','cycle']);
 assert.equal(model.candidateArchetypes[0],'cycle','cycle (3-6) precedes flow (2-5) for seven concepts');
 const small=selectVisualModel({...scene,requiredConceptIds:['plant','sunlight','water'],requiredRelations:[
  {id:'r1',fromConceptId:'plant',toConceptId:'sunlight',relationType:'flows_to'},
  {id:'r2',fromConceptId:'sunlight',toConceptId:'water',relationType:'flows_to'},
  {id:'r3',fromConceptId:'water',toConceptId:'plant',relationType:'flows_to'}]},registry,{keepFromPrevious:[],prepareForNext:[]},['cycle','flow']);
 assert.equal(small.candidateArchetypes[0],'cycle','cycle stays first when it fits and closes');
});

test('a cycle candidate is deprioritised when the plan relations cannot close a ring',async()=>{
 const base=plan().scenes[0];
 const registry=plan().conceptRegistry;
 const ring={...base,candidateArchetypes:['cycle','flow'],requiredConceptIds:['plant','sunlight','water'],requiredRelations:[
  {id:'r1',fromConceptId:'plant',toConceptId:'sunlight',relationType:'flows_to'},
  {id:'r2',fromConceptId:'sunlight',toConceptId:'water',relationType:'flows_to'},
  {id:'r3',fromConceptId:'water',toConceptId:'plant',relationType:'flows_to'}]};
 const closed=selectVisualModel(ring,registry,{keepFromPrevious:[],prepareForNext:[]},['cycle','flow']);
 assert.equal(closed.candidateArchetypes[0],'cycle','a closing ring keeps cycle first');
 const broken={...ring,requiredRelations:[...ring.requiredRelations,{id:'r4',fromConceptId:'plant',toConceptId:'water',relationType:'causes'}]};
 const open=selectVisualModel(broken,registry,{keepFromPrevious:[],prepareForNext:[]},['cycle','flow']);
 assert.equal(open.candidateArchetypes[0],'flow','a non-closing relation set no longer leads with cycle');
});

test('spreadExcessIntroductions heals a beat that introduces more than three concepts',async()=>{
 const {spreadExcessIntroductions}=await import('../dist/src/semantic/planning/teaching-planner.js');
 const value={scenes:[{key:'s1',beats:[
  {key:'b1',introduce:['a','b','c','d','e']},
  {key:'b2',introduce:['f']},
  {key:'b3',introduce:[]}]}]};
 spreadExcessIntroductions(value);
 const beats=value.scenes[0].beats;
 assert.ok(beats.every(b=>b.introduce.length<=3),'no beat introduces more than three concepts');
 const all=beats.flatMap(b=>b.introduce).sort();
 assert.deepEqual(all,['a','b','c','d','e','f'],'every concept is still introduced exactly once');
 assert.deepEqual(beats[0].introduce,['a','b','c'],'the earliest concepts stay in the first beat');
 assert.deepEqual(beats[1].introduce,['d','e','f'],'overflow moves into the next beat ahead of its own concepts');
});

test('healStateMechanisms injects a neutral→activated transform for a forgotten state mechanism',async()=>{
 const {healStateMechanisms}=await import('../dist/src/semantic/planning/teaching-planner.js');
 const value=intent();
 value.requiredMechanisms=[...value.requiredMechanisms,{id:'mech_state_test',statement:'The plant activates photosynthesis under light.',critical:true,conceptKeys:['plant','sunlight'],requiresStateChange:true,evidenceRefs:[]}];
 healStateMechanisms(value);
 const transformed=value.scenes.flatMap(scene=>scene.beats.flatMap(beat=>beat.transform??[]));
 assert.ok(transformed.some(t=>['plant','sunlight'].includes(t.conceptKey)&&t.fromState==='neutral'&&t.toState==='activated'),'a transform was injected for the mechanism concept');
 // idempotent: no duplicate transforms
 healStateMechanisms(value);
 const transforms=value.scenes.flatMap(scene=>scene.beats.flatMap(beat=>beat.transform??[]));
 assert.equal(transforms.filter(t=>t.conceptKey==='plant').length,1,'the heal does not duplicate');
});

test('healPreservedRedraws converts a PRESERVED concept re-draw into a highlight',async()=>{
 const {healPreservedRedraws}=await import('../dist/src/semantic/planning/visual-director.js');
 const board={sceneId:'s1',archetypes:['structural_diagram'],beats:[{contractId:'c1',narration:'keep',semanticKeys:['plant'],relations:[],diffs:[{operation:'PRESERVE',semanticKeys:['plant'],toState:undefined}]}]};
 const scene={...plan().scenes[0],id:'s1',beats:[{id:'b1',narration:'keep',actions:[{id:'a1',type:'draw',objectIds:['obj_plant'],relationIds:[],durationMs:500,leadMs:0,easing:'linear'}],intentionalPause:undefined}],objects:[{id:'obj_plant',conceptId:'plant',role:'hero'}]};
 const healed=healPreservedRedraws(scene,board);
 assert.equal(healed,1);
 assert.equal(scene.beats[0].actions[0].type,'highlight');
 assert.equal(healPreservedRedraws(scene,board),0,'already healed');
});

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

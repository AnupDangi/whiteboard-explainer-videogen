import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDirectedScene,assetCandidates} from '../dist/src/semantic/planning/visual-director.js';
import {selectVisualModel} from '../dist/src/semantic/planning/visual-model.js';
import {canonicalizeVisualScene} from '../dist/src/semantic/identity/canonicalize.js';
import {computeRunMetrics} from '../dist/eval/live/metrics.js';
const plan=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
const fresh=()=>{const s=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const o of s.objects)if(plan.conceptRegistry.some(c=>c.id===o.id))o.conceptId=o.id;return s;};
const semantic=plan.scenes[0],mental=selectVisualModel(semantic,plan.conceptRegistry,{keepFromPrevious:[],prepareForNext:[]},semantic.candidateArchetypes);
const allowed=new Set(assetCandidates(semantic,plan.conceptRegistry,mental).flatMap(c=>c.candidates.map(a=>a.id)));
const validate=s=>validateDirectedScene(s,semantic,plan.conceptRegistry,mental,allowed);
test('a single wrong arc for a required relation is corrected to the contract, and prose is still rejected',()=>{
 assert.ok(validate(fresh()));
 const required=semantic.requiredRelations[0];
 const pairOf=(s)=>{const a=s.objects.find(o=>s.relations.find(r=>r.from.objectId===o.id&&r.to.objectId===s.objects[1].id)||true);return s;};
 /** The plan's relation is the contract. A single arc between the required
  *  concepts that carries the wrong direction, type or anchor is corrected in
  *  place and recorded, rather than rendering a wrong arrow or failing the job.
  *  Two or more candidate arcs stay ambiguous and are rejected. */
 for(const mutate of [
  s=>{[s.relations[0].from,s.relations[0].to]=[s.relations[0].to,s.relations[0].from];},
  s=>{s.relations[0].relationType='inhibits';},
  s=>{s.relations[0].to.anchor='center';},
 ]){
  const s=fresh();mutate(s);
  const result=validate(s);
  const corrected=result.relations.find(r=>r.relationType===required.relationType&&r.to.anchor===required.targetAnchor);
  assert.ok(corrected,'the required relation must be realized with the contract type and target');
 }
 // Prose the plan never wrote is still a hard failure.
 assert.throws(()=>validate((()=>{const s=fresh();s.beats[0].narration='Different teaching';return s;})()));
});
test('an entirely absent required relation is synthesized, a reversed one still fails',()=>{
 const required=semantic.requiredRelations[0];
 const inScene=(s,r,req)=>{const a=s.objects.find(o=>o.id===r.from.objectId),b=s.objects.find(o=>o.id===r.to.objectId);return Boolean(a&&b&&a.conceptId===req.fromConceptId&&b.conceptId===req.toConceptId&&r.relationType===req.relationType);};
 const absent=fresh();
 const at=absent.relations.findIndex(r=>inScene(absent,r,required));
 assert.ok(at>=0,'fixture must contain the required relation to remove it');
 const removed=absent.relations[at].id;
 absent.relations.splice(at,1);
 for(const beat of absent.beats)beat.actions=beat.actions.filter(action=>{action.relationIds=action.relationIds.filter(id=>id!==removed);return action.objectIds.length>0||action.relationIds.length>0;});
 const result=validate(absent);
 const synthesized=result.relations.find(r=>r.id===`relation_synth_${required.id}`);
 assert.ok(synthesized,'a required relation that is entirely absent must be realized by the harness');
 assert.equal(synthesized.relationType,required.relationType);
 assert.ok(result.objects.some(o=>o.id===synthesized.from.objectId));
 assert.ok(result.objects.some(o=>o.id===synthesized.to.objectId));
});
test('ID canonicalization preserves relation anchors, forms and object topology',()=>{
 const s=fresh(),result=canonicalizeVisualScene(s.id,s,plan.conceptRegistry);
 for(const [i,r] of result.relations.entries()){
  assert.equal(r.from.anchor,s.relations[i].from.anchor);assert.equal(r.to.anchor,s.relations[i].to.anchor);assert.equal(r.visualForm,s.relations[i].visualForm);
 }
 for(const [i,o] of result.objects.entries())assert.equal(o.children.length,s.objects[i].children.length);
});
test('AV metrics use request-relative readiness, never compile duration or fabricated first-byte timing',()=>{
 const m=computeRunMetrics([{stage:'compile',status:'success',elapsedMs:2,atMs:9000},{stage:'tts',status:'success',elapsedMs:3000,atMs:9500}],[],[],[{timingKind:'engine',stageMetrics:{sceneReadyMs:9502},diagnostics:['Narrated static interval 5000ms'],compileFindings:[{severity:'hard',code:'clipping'}]}],'complete');
 assert.equal(m.firstVisualReadyMs,9000);assert.equal(m.firstAVPlayableMs,9502);assert.equal(m.firstAudioByteMs,null);assert.equal(m.ttsCompleteMs,9500);assert.equal(m.invalidReferenceCount,0);assert.equal(m.timelineRepairCount,0);assert.equal(m.staticIntervalCount,1);
});

test('the board contract heal supplies a missing INTRODUCE reveal and TRANSFORM morph',async()=>{
 const {healBoardContract}=await import('../dist/src/semantic/planning/visual-director.js');
 const {gateBoardAlignment}=await import('../dist/src/semantic/harness/gates.js');
 const object=(id,conceptId,extra={})=>({id,conceptId,label:id,role:'support',children:[],state:'neutral',allowedStates:['neutral'],importance:'secondary',collisionPolicy:'forbid',primitiveRef:'rectangle',...extra});
 const scene={
  version:2,id:'s',title:'S',teachingGoal:'g',mentalModel:'m',archetype:'flow',
  objects:[object('a','alpha'),object('b','beta')],
  relations:[],
  beats:[
   {id:'b1',narration:'one',actions:[{id:'x1',type:'reveal',objectIds:['b'],relationIds:[],durationMs:400,leadMs:0,easing:'linear'}]},
   {id:'b2',narration:'two',actions:[{id:'x2',type:'reveal',objectIds:['b'],relationIds:[],durationMs:400,leadMs:0,easing:'linear'}]},
  ],
  continuity:{keepFromPrevious:[],prepareForNext:[]},
 };
 const board={sceneId:'s',archetypes:['flow'],beats:[
  {contractId:'c1',narration:'one',semanticKeys:['alpha'],relations:[],diffs:[{operation:'INTRODUCE',semanticKeys:['alpha'],reason:'first sight'}]},
  {contractId:'c2',narration:'two',semanticKeys:['beta'],relations:[],diffs:[{operation:'TRANSFORM',semanticKeys:['beta'],reason:'activates',fromState:'neutral',toState:'activated'}]},
 ]};
 const before=gateBoardAlignment(board,scene);
 assert.equal(before.passed,false,'the fixture must start out violating the board contract');
 const healed=healBoardContract(scene,board);
 assert.equal(healed.introduced,1,'a missing INTRODUCE reveal is supplied');
 assert.equal(healed.transformed,1,'a missing TRANSFORM morph is supplied');
 const reveal=scene.beats[0].actions.find(a=>a.type==='reveal'&&a.objectIds.includes('a'));
 assert.ok(reveal,'alpha is now introduced in its beat');
 const morph=scene.beats[1].actions.find(a=>a.type==='morph'&&a.toState==='activated');
 assert.ok(morph,'beta now reaches activated');
 assert.ok(scene.objects.find(o=>o.id==='b').allowedStates.includes('activated'),'the promised state must be allowed');
 assert.equal(gateBoardAlignment(board,scene).passed,true,'the board contract now holds');
});

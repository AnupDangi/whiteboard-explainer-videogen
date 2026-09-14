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
test('teaching contract rejects reversed relationships, wrong types, parts and changed prose',()=>{
 assert.ok(validate(fresh()));
 for(const mutate of [s=>{[s.relations[0].from,s.relations[0].to]=[s.relations[0].to,s.relations[0].from];},s=>s.relations[0].relationType='inhibits',s=>s.relations[0].to.anchor='center',s=>s.beats[0].narration='Different teaching']){
  const s=fresh();mutate(s);assert.throws(()=>validate(s));
 }
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

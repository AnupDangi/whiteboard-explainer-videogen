import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {parseVisualScene,visualSceneSchema,teachingPlanSchema} from '../dist/src/semantic/schemas.js';
import {validateVisualScene,validateTeachingPlan} from '../dist/src/semantic/planning/validate.js';
import {ASSETS,getAsset} from '../dist/src/semantic/assets/registry.js';
import {validateAsset} from '../dist/src/semantic/assets/validator.js';
import {searchAssets} from '../dist/src/semantic/assets/search.js';
import {compileTimeline,estimatedTiming,staticIntervals} from '../dist/src/semantic/compiler/timeline.js';
import {MAX_STATIC_INTERVAL_MS} from '../dist/src/shared/language.js';
import {findCollisions} from '../dist/src/semantic/compiler/collisions.js';
import {renderIllustration} from '../dist/src/semantic/renderer/illustrations.js';
import {length,pointAt} from '../dist/src/semantic/assets/geometry.js';
import {archetypePlacements} from '../dist/src/semantic/compiler/archetypes.js';
const golden=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));
const mutate=fn=>{const s=golden();fn(s);return s;};
test('V2 strict schemas close every object boundary',()=>{for(const root of [visualSceneSchema,teachingPlanSchema]){const visit=s=>{if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.ok(s.required.length);Object.values(s.properties).forEach(visit);}if(s.items)visit(s.items);};visit(root);}for(const fn of [s=>s.svg='<svg/>',s=>s.objects[0].x=2,s=>s.beats[0].actions[0].script='alert(1)'])assert.throws(()=>parseVisualScene(mutate(fn)),/additional property/);});
test('V2 schema bounds, IDs, enums and asset refs reject unsafe scene data',()=>{for(const fn of [s=>s.objects[0].assetRef='https://bad.test/a.svg',s=>s.objects[0].id='../x',s=>s.archetype='generic_boxes',s=>s.beats[0].actions[0].type='eval',s=>s.objects.push(...Array(40).fill(s.objects[0])),s=>s.title='x'.repeat(101),s=>s.beats[0].actions[0].durationMs=NaN,s=>s.objects=[]])assert.throws(()=>parseVisualScene(mutate(fn)));});
test('V2 rejects duplicate, dangling, cyclic and ambiguous object references',()=>{for(const fn of [s=>s.objects[1].id=s.objects[0].id,s=>s.relations[0].to.objectId='missing',s=>s.beats[0].actions[0].objectIds=['missing'],s=>s.objects[0].primitiveRef='rectangle',s=>s.continuity.keepFromPrevious=['missing'],s=>{s.objects[0].parentId=s.objects[0].id;s.objects[0].children=[s.objects[0].id];},s=>s.objects[0].state='after',s=>s.beats[0].actions[0].objectIds=[]])assert.throws(()=>validateVisualScene(mutate(fn)));});
test('V2 plant golden uses actual root and leaf anchors and a dominant illustration',()=>{const s=compileScene(golden());assert.equal(findCollisions(s.objects).length,0);assert.equal(s.scene.objects.filter(o=>o.primitiveRef==='rectangle').length,0);const plant=s.objects.find(o=>o.id==='plant');const water=s.relations.find(r=>r.id==='water_to_roots');assert.deepEqual(water.points.at(-1),plant.anchors.roots);assert.notDeepEqual(water.points.at(-1),plant.anchors.center);assert.equal(s.scene.beats.length,5);assert.ok(s.objects.filter(o=>o.role!=='hero').every(o=>plant.w*plant.h>o.w*o.h));});
test('V2 compiler repairs illustration-label overlap instead of hiding it',()=>{const s=compileScene(golden());assert.ok(s.diagnostics.some(d=>d.includes('moved annotation leaf_label')));assert.equal(findCollisions(s.objects).length,0);});
test('V2 compiler fails closed on unknown assets, anchors, unsupported archetypes and motions',()=>{for(const fn of [s=>s.objects[0].assetRef='missing.asset.v2',s=>s.archetype='matrix_operation',s=>{s.beats[0].actions[0].type='teleport';s.beats[0].actions[0].destination='right';}])assert.throws(()=>compileScene(mutate(fn)));});
test('V2 compiler degrades an unroutable anchor to a direct warned line',()=>{const s=compileScene(mutate(s=>s.relations[0].to.anchor='missing'));assert.ok(s.diagnostics.some(d=>d.includes('representation fallback')&&(d.includes('degraded to center')||d.includes('no safe connector route'))));assert.equal(s.relations[0].points.length,2);});
test('V2 renderer is seek-independent, serialized, fresh-process deterministic and escaped',()=>{const s=compileScene(golden()),before=JSON.stringify(s),a=renderSVG(s,18200);renderSVG(s,0);renderSVG(s,s.durationMs);assert.equal(renderSVG(s,18200),a);assert.equal(renderSVG(JSON.parse(before),18200),a);assert.equal(JSON.stringify(s),before);const fresh=execFileSync(process.execPath,['--input-type=module','-e',`import {readFileSync} from 'node:fs';import {compileScene} from './dist/src/semantic/compiler/compile-scene.js';import {renderSVG} from './dist/src/semantic/renderer/render-svg.js';process.stdout.write(renderSVG(compileScene(JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'))),18200));`],{encoding:'utf8'});assert.equal(fresh,a);const bad=compileScene(mutate(s=>s.title='<script>unsafe</script>'));assert.ok(renderSVG(bad,0).includes('&lt;script&gt;'));assert.ok(!renderSVG(bad,0).includes('<script>'));assert.throws(()=>renderSVG(s,NaN));});
test('V2 assets are immutable, bounded and expose semantic plant anchors',()=>{for(const a of ASSETS){validateAsset(a);assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.parts));}const plant=getAsset('biology.plant.sapling.v2');for(const name of ['roots','stem','leaf.top','leaf.left','leaf.right','canopy'])assert.ok(plant.anchors[name]);const broken=structuredClone(plant);broken.anchors.roots.x=Infinity;assert.throws(()=>validateAsset(broken));});
test('V2 asset retrieval is deterministic and never returns paths or weak unrelated matches',()=>{const query={name:'plant',archetype:'structural_diagram',semanticType:'entity'};assert.deepEqual(searchAssets(query),searchAssets(query));assert.equal(searchAssets(query)[0].id,'biology.plant.sapling.v2');assert.equal(searchAssets({...query,name:'Plant System'})[0].id,'biology.plant.sapling.v2');assert.deepEqual(searchAssets({name:'spaceship',archetype:'structural_diagram'}),[]);assert.deepEqual(searchAssets({name:'plant',archetype:'matrix_operation'}),[]);});
test('V2 part sequencing keeps fills behind completed outlines and cursor on active geometry',()=>{const s=compileScene(golden()),plant=s.objects.find(o=>o.id==='plant');const partial=renderIllustration(plant,.03,0),done=renderIllustration(plant,1,0);assert.ok(partial.cursor);assert.ok(Number.isFinite(partial.cursor.angle));assert.equal(done.cursor,undefined);assert.ok(done.svg.includes('fill-opacity="0.13"'));const ps=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];assert.equal(length(ps),20);assert.deepEqual(pointAt(ps,15),{x:10,y:5,angle:90});});
test('V2 timing resolves repeated terms beat-locally and rejects incompatible timing',()=>{const g=golden(),timing=estimatedTiming(g),actions=compileTimeline(g,timing);const last=actions.find(a=>a.id==='combine_water');const first=actions.find(a=>a.id==='draw_water');assert.ok(last.anchorMs>first.anchorMs+10000);assert.ok(actions.every(a=>a.startMs>=0&&a.durationMs>0&&a.startMs+a.durationMs<=timing.durationMs));const bad=structuredClone(timing);bad.words[0].word='wrong';const d1=[];assert.equal(compileTimeline(g,bad,d1).length,actions.length,'a mislabelled word is re-labelled from the narration, not fatal');const bad2=structuredClone(timing);bad2.words[2].startMs=-2;const d2=[];const fixed=compileTimeline(g,bad2,d2);assert.ok(d2.some(d=>/timing repaired/.test(d)),'an out-of-range word is clamped and recorded');assert.ok(fixed.every(a=>a.startMs>=0&&a.durationMs>0),'repaired actions stay inside the audio');assert.throws(()=>compileTimeline(g,{...timing,words:timing.words.slice(1)}),'a word-count mismatch is still fatal');const diagnostics=[];const degraded=compileTimeline(mutate(s=>s.beats[0].actions[0].anchor={text:'nonexistent',occurrence:0}),timing,diagnostics);
assert.ok(diagnostics.some(d=>/spoken anchor "nonexistent" not found/.test(d)),'a missing spoken anchor must be recorded, not fatal');
assert.ok(degraded.every(a=>a.startMs>=0&&a.durationMs>0),'the degraded action still lands inside its beat');});
test('V2 static detection measures union intervals and explicit pauses, not captions',()=>{const g=golden(),t=estimatedTiming(g),actions=compileTimeline(g,t);assert.ok(Math.max(...staticIntervals(g,t,actions).map(g=>g.endMs-g.startMs))<=MAX_STATIC_INTERVAL_MS,`longest static interval must stay within ${MAX_STATIC_INTERVAL_MS}ms of spoken narration`);assert.equal(staticIntervals(g,t,[]).length,1);const paused=structuredClone(g);paused.beats.forEach(b=>b.intentionalPause='Learner reflection');assert.deepEqual(staticIntervals(paused,t,[]),[]);});
test('V2 bounded scene variants preserve finite geometry and serialize deterministically',()=>{for(let i=0;i<20;i++){const g=golden();g.objects[1].label=`Light ${i}`;g.beats[0].actions[0].durationMs=1000+i*200;const s=compileScene(g);for(const o of s.objects)assert.ok([o.x,o.y,o.w,o.h].every(Number.isFinite));for(const t of [0,s.durationMs*.25,s.durationMs*.75,s.durationMs]){const svg=renderSVG(s,t);assert.ok(!/NaN|Infinity/.test(svg));assert.equal(svg,renderSVG(JSON.parse(JSON.stringify(s)),t));}}});
test('V2 can emphasize persistent relations and objects together without redrawing the relation',()=>{const g=golden();g.beats.at(-1).actions.push({id:'pulse_relations',type:'pulse',objectIds:['plant'],relationIds:['light_to_leaf','water_to_roots','co2_to_leaf'],durationMs:2000,leadMs:0,easing:'linear'});const s=compileScene(g),a=s.actions.find(a=>a.id==='pulse_relations');const before=renderSVG(s,a.startMs),during=renderSVG(s,a.startMs+1000);assert.notEqual(before,during);assert.ok(during.includes('stroke-width="4.4"'));assert.equal(during,renderSVG(s,a.startMs+1000));});
test('V2 repairs conflicting preferred support zones without moving its hero',()=>{const g=golden();for(const o of g.objects.filter(o=>o.assetRef&&o.role!=='hero'))o.preferredZone='upper_left';const s=compileScene(g),reference=compileScene(golden());assert.equal(findCollisions(s.objects).length,0);assert.equal(s.objects.find(o=>o.role==='hero').x,reference.objects.find(o=>o.role==='hero').x);assert.ok(s.diagnostics.some(d=>d.includes('repositioned support')));});
test('V2 manual archetypes retain distinct compositions with bounded geometry',()=>{
 for(const name of ['dna-replication','plate-tectonics','caching-rules','mla-compression']){
  const raw=JSON.parse(readFileSync(`examples/semantic/${name}.scene.json`,'utf8')),s=compileScene(raw);
  assert.equal(findCollisions(s.objects).length,0);assert.ok(!/NaN|Infinity/.test(renderSVG(s,s.durationMs)));
  assert.equal(renderSVG(s,s.durationMs),renderSVG(JSON.parse(JSON.stringify(s)),s.durationMs));
  if(raw.archetype==='numbered_steps'){assert.ok(!s.diagnostics.includes('Weak hero salience'));assert.ok(s.objects.every(o=>o.x===200));}
  if(name==='plate-tectonics'){const hero=s.objects.find(o=>o.id==='plates'),mantle=s.objects.find(o=>o.id==='mantle');assert.ok(mantle.x+mantle.w<hero.x+hero.w*.5);assert.ok(mantle.y+mantle.h*.15>hero.y+hero.h*.38);}
  if(name==='mla-compression'){const kv=s.objects.find(o=>o.assetRef==='data.kv.v2');assert.ok(kv);assert.deepEqual(getAsset(kv.assetRef).parts.map(p=>p.id),['k','v']);}
 }
});
test('V2 flow order follows dependency edges and cyclic flows keep every relation',()=>{
 const g=JSON.parse(readFileSync('examples/semantic/http-request.scene.json','utf8'));g.objects.reverse();const s=compileScene(g),x=id=>s.objects.find(o=>o.id===id).x;
 assert.ok(x('client')<x('server')&&x('server')<x('database'));
 g.relations.push({id:'back',from:{objectId:'database',anchor:'output'},to:{objectId:'client',anchor:'input'},relationType:'flows_to',visualForm:'flow'});
 const degraded=compileScene(g);
 assert.equal(degraded.scene.archetype,'flow');
 assert.equal(degraded.scene.relations.length,g.relations.length);
 assert.equal(degraded.scene.relations.find(r=>r.id==='back').visualForm,'flow');
 assert.equal(degraded.scene.relations.find(r=>r.id==='back').layoutFeedback,true);
 assert.ok(degraded.diagnostics.some(d=>d.includes('representation fallback')&&d.includes('cycle')));
});
test('V2 cycles close semantically and remain separate from DAG layout',()=>{
 const g=JSON.parse(readFileSync('examples/semantic/water-cycle.scene.json','utf8')),s=compileScene(g);assert.equal(findCollisions(s.objects).length,0);assert.ok(!s.diagnostics.includes('Weak hero salience'));assert.equal(s.relations.length,4);
 g.relations.pop();g.beats.pop();assert.throws(()=>compileScene(g),/outgoing|close/);
});
test('V2 equation and matrix layouts compile deterministically with bounded geometry',()=>{
 for(const name of ['matrix-multiply','equation-walkthrough']){
  const raw=JSON.parse(readFileSync(`examples/semantic/${name}.scene.json`,'utf8')),s=compileScene(raw);
  assert.equal(findCollisions(s.objects).length,0);assert.ok(!/NaN|Infinity/.test(renderSVG(s,s.durationMs)));
  assert.equal(renderSVG(s,s.durationMs),renderSVG(JSON.parse(JSON.stringify(s)),s.durationMs));
  assert.ok(!s.diagnostics.includes('Narrated static interval exceeds 3500ms'));
 }
 const m=compileScene(JSON.parse(readFileSync('examples/semantic/matrix-multiply.scene.json','utf8')));
 assert.deepEqual([...m.objects].sort((a,b)=>a.x-b.x).map(o=>o.id),['matrix_a','op_multiply','vector_x','op_equals','vector_b']);
 assert.ok(renderSVG(m,m.durationMs).includes('monospace'));
 const e=compileScene(JSON.parse(readFileSync('examples/semantic/equation-walkthrough.scene.json','utf8')));
 assert.deepEqual([...e.objects].sort((a,b)=>a.y-b.y).map(o=>o.id),['line_1','line_2','line_3','line_4']);
});
test('V2 equation and matrix layouts fail closed on invalid inputs',()=>{
 const obj=(id,extra)=>({id,role:'support',children:[],collisionPolicy:'forbid',...extra});
 assert.throws(()=>archetypePlacements({archetype:'matrix_operation',objects:[obj('a',{assetRef:'math.matrix.v2'}),obj('op',{primitiveRef:'equation'})],relations:[]}),/3–6/);
 assert.throws(()=>archetypePlacements({archetype:'matrix_operation',objects:[obj('a',{assetRef:'math.matrix.v2'}),obj('b',{assetRef:'math.vector.v2'}),obj('c',{assetRef:'data.latent.v2'})],relations:[]}),/operator/);
 assert.throws(()=>archetypePlacements({archetype:'equation_walkthrough',objects:[obj('l1',{primitiveRef:'label'})],relations:[]}),/2–6/);
 // Mixed equation and step-label derivation lines are accepted (teacher-voice steps).
 archetypePlacements({archetype:'equation_walkthrough',objects:[obj('l1',{primitiveRef:'equation'}),obj('l2',{primitiveRef:'label'})],relations:[]});
});
test('V2 hierarchy places one root above its descendants and rejects invalid trees',()=>{
 const raw=JSON.parse(readFileSync('examples/semantic/memory-hierarchy.scene.json','utf8')),s=compileScene(raw);
 assert.equal(findCollisions(s.objects).length,0);assert.ok(!/NaN|Infinity/.test(renderSVG(s,s.durationMs)));
 assert.equal(renderSVG(s,s.durationMs),renderSVG(JSON.parse(JSON.stringify(s)),s.durationMs));
 const pos=id=>s.objects.find(o=>o.id===id),cx=o=>o.x+o.w/2;
 assert.ok(pos('memory').y<pos('cache_level').y&&pos('cache_level').y<pos('registers').y);
 assert.ok(Math.abs(cx(pos('memory'))-(cx(pos('cache_level'))+cx(pos('storage_level')))/2)<1);
 const obj=(id,extra)=>({id,role:'label',children:[],collisionPolicy:'forbid',primitiveRef:'label',...extra});
 assert.throws(()=>archetypePlacements({archetype:'hierarchy',objects:[obj('a'),obj('b'),obj('c')],relations:[]}),/exactly one root/);
 assert.throws(()=>archetypePlacements({archetype:'hierarchy',objects:[obj('a'),obj('b'),obj('c')],relations:[{id:'ab',from:{objectId:'a',anchor:'center'},to:{objectId:'b',anchor:'center'},relationType:'contains',visualForm:'arrow'},{id:'ba',from:{objectId:'b',anchor:'center'},to:{objectId:'a',anchor:'center'},relationType:'contains',visualForm:'arrow'}]}),/connected|cycle|root/);
});
test('V2 timeline and trajectory keep declared order and reject invalid input',()=>{
 const t=compileScene(JSON.parse(readFileSync('examples/semantic/roman-timeline.scene.json','utf8')));
 assert.equal(findCollisions(t.objects).length,0);assert.ok(!/NaN|Infinity/.test(renderSVG(t,t.durationMs)));
 assert.equal(renderSVG(t,t.durationMs),renderSVG(JSON.parse(JSON.stringify(t)),t.durationMs));
 assert.deepEqual([...t.objects].sort((a,b)=>a.x-b.x).map(o=>o.id),t.scene.objects.map(o=>o.id));
 assert.ok(renderSVG(t,t.durationMs).includes('stroke-width="3"'));
 const tr=compileScene(JSON.parse(readFileSync('examples/semantic/gradient-steps.scene.json','utf8')));
 assert.equal(findCollisions(tr.objects).length,0);
 const steps=[...tr.objects].sort((a,b)=>a.x-b.x);assert.ok(steps.every((o,i)=>i===0||o.y>steps[i-1].y));
 assert.ok(renderSVG(tr,tr.durationMs).includes('stroke-dasharray="8 8"'));
 const obj=(id,extra)=>({id,role:'label',children:[],collisionPolicy:'forbid',primitiveRef:'label',...extra});
 assert.throws(()=>archetypePlacements({archetype:'timeline',objects:[obj('a')],relations:[]}),/2–6/);
 assert.throws(()=>archetypePlacements({archetype:'trajectory',objects:[obj('a'),obj('b')],relations:[]}),/3–6/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {objectState} from '../dist/src/semantic/renderer/scene-state.js';
import {renderEquation} from '../dist/src/semantic/renderer/primitives.js';
import {ASSETS} from '../dist/src/semantic/assets/registry.js';
const scene=()=>{const s=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const o of s.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(o.id))o.conceptId=o.id;return s;};

test('morph/replace actions are compiled and rendered with a state badge',()=>{
  const s=scene();
  s.beats[1].actions.push({id:'morph_plant',type:'morph',objectIds:['plant'],relationIds:[],durationMs:1200,leadMs:-180,easing:'linear',toState:'activated'});
  const compiled=compileScene(s,undefined,undefined);
  const action=compiled.actions.find(a=>a.type==='morph');
  assert.ok(action,'morph action compiled');
  const mid=objectState(compiled,'plant',action.startMs+action.durationMs/2);
  assert.ok(mid.morph&&mid.morph.progress>0&&mid.morph.progress<1);
  const svg=renderSVG(compiled,action.startMs+action.durationMs/2);
  assert.ok(svg.includes('activated'));
});
test('before state renders dimmed illustration strokes',()=>{
  const s=scene();
  const plant=s.objects.find(o=>o.id==='plant');
  plant.allowedStates=[...plant.allowedStates,'before','after'];
  s.beats[1].actions.push({id:'state_before',type:'replace',objectIds:['plant'],relationIds:[],durationMs:800,leadMs:0,easing:'linear',toState:'before'});
  const compiled=compileScene(s,undefined,undefined);
  const action=compiled.actions.find(a=>a.type==='replace');
  const end=objectState(compiled,'plant',action.startMs+action.durationMs);
  assert.equal(end.state,'before');
  const svg=renderSVG(compiled,action.startMs+action.durationMs);
  assert.ok(svg.includes('stroke-opacity="0.550"'));
});
test('multi-line equation renders one line at a time with active-line wash',()=>{
  const o={id:'eq',label:'derivation',role:'equation',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid',primitiveRef:'equation',x:100,y:100,w:400,h:120,fontSize:24,lines:['y = 2x + 3','y = 2x + 3 - 3','y = 2x'],anchors:{},zIndex:1};
  const first=renderEquation(o,1/3,0);
  assert.ok(first.includes('y = 2x + 3'));
  assert.ok(!first.includes('y = 2x</text>'));
  const mid=renderEquation(o,.5,.5);
  assert.ok(mid.includes('opacity="0.75"'));
  assert.ok(mid.includes('rx="4"'));
  const full=renderEquation(o,1,0);
  assert.ok(full.includes('y = 2x</text>'));
});
test('branch graph layout ranks layered nodes deterministically',()=>{
  const s={version:2,id:'branch-test',title:'Branching',teachingGoal:'t',mentalModel:'m',archetype:'branch',objects:[
   {id:'root',label:'Root',role:'support',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid',primitiveRef:'label'},
   {id:'a',label:'A',role:'support',children:[],state:'neutral',allowedStates:['neutral'],importance:'secondary',collisionPolicy:'forbid',primitiveRef:'label'},
   {id:'b',label:'B',role:'support',children:[],state:'neutral',allowedStates:['neutral'],importance:'secondary',collisionPolicy:'forbid',primitiveRef:'label'},
   {id:'c',label:'C',role:'support',children:[],state:'neutral',allowedStates:['neutral'],importance:'secondary',collisionPolicy:'forbid',primitiveRef:'label'},
  ],relations:[
   {id:'r1',from:{objectId:'root',anchor:'output'},to:{objectId:'a',anchor:'input'},relationType:'flows_to',visualForm:'arrow'},
   {id:'r2',from:{objectId:'root',anchor:'output'},to:{objectId:'b',anchor:'input'},relationType:'flows_to',visualForm:'arrow'},
   {id:'r3',from:{objectId:'a',anchor:'output'},to:{objectId:'c',anchor:'input'},relationType:'flows_to',visualForm:'arrow'},
  ],beats:[{id:'b1',narration:'The root branches into two paths that later converge.',actions:[{id:'x1',type:'reveal',objectIds:['root','a','b','c'],relationIds:[],durationMs:1000,leadMs:0,easing:'linear'}]}],continuity:{keepFromPrevious:[],prepareForNext:[]}};
  const compiled=compileScene(s,undefined,undefined);
  const byId=new Map(compiled.objects.map(o=>[o.id,o]));
  assert.ok(byId.get('root').x<byId.get('a').x&&byId.get('a').x<byId.get('c').x);
  assert.ok(Math.abs(byId.get('a').y-byId.get('b').y)>50,'siblings on distinct rows');
});
test('general repair nudges overlapping supports in non-structural archetypes',()=>{
  // Compose a branch scene from archetype-compatible label objects to exercise the
  // general nudge/scale repair path (structural archetypes use their own repair).
  const s=scene();
  s.archetype='branch';
  const kept=['plant','sunlight','water','carbon_dioxide'];
  s.objects=s.objects.map(o=>{if(!kept.includes(o.id))return o;if(!o.assetRef)return o;const {assetRef,...rest}=o;return {...rest,primitiveRef:'label'};}).filter(o=>kept.includes(o.id));
  s.relations=s.relations.filter(r=>kept.includes(r.from.objectId)&&kept.includes(r.to.objectId)).map(r=>({...r,from:{...r.from,anchor:'input'},to:{...r.to,anchor:'input'}}));
  const relationIds=new Set(s.relations.map(r=>r.id));
  s.beats=s.beats.map(b=>({...b,actions:b.actions.map(a=>({...a,objectIds:a.objectIds.filter(id=>s.objects.some(o=>o.id===id)),relationIds:a.relationIds.filter(id=>relationIds.has(id))})).filter(a=>a.objectIds.length||a.relationIds.length)}));
  const compiled=compileScene(s,undefined,undefined);
  assert.ok(compiled.objects.every(o=>o.x>=0&&o.y>=0));
  assert.ok(compiled.objects.length===4);
});
test('new Phase 15 assets validate and expose anchors',()=>{
  assert.equal(ASSETS.length,43);
  for(const id of ['physics.compressor.v2','physics.condenser.v2','physics.evaporator.v2','economy.price.level.v2']){
    const a=ASSETS.find(x=>x.id===id);
    assert.ok(a,`missing ${id}`);
    assert.ok(a.anchors.input&&a.anchors.output,`${id} lacks flow ports`);
  }
});

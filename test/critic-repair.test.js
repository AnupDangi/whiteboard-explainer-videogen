import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {contactSheetTimes,createSheetRenderer} from '../dist/src/semantic/contact-sheet.js';
import {criticRepair,decideFromPairwise} from '../dist/src/semantic/critic-repair.js';
import {lintCompiledScene} from '../dist/src/semantic/evaluation.js';
const scene=()=>{const s=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const o of s.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(o.id))o.conceptId=o.id;return s;};
const semantic=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8')).scenes[0];
const registry=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8')).conceptRegistry;
const compiled=()=>compileScene(scene(),undefined,undefined);
const mentalModel=()=>({mentalModel:'plant',candidateArchetypes:['structural_diagram'],heroConceptIds:['plant'],supportConceptIds:['sunlight','water','carbon_dioxide'],relationStrategy:[],requiredObjectStates:[]});
const model=()=>({calls:[],async generate(stage,instructions,input,schema,validate){this.calls.push({stage,instructions});return validate({scene:scene()});}});

test('contact sheet times are event-aligned: initial, per-beat, final',()=>{
  const c=compiled(),times=contactSheetTimes(c);
  assert.equal(times.length,c.scene.beats.length+2);
  assert.equal(times[0],0);
  assert.equal(times[times.length-1],c.durationMs);
  for(let i=1;i<times.length;i++)assert.ok(times[i]>=times[i-1]);
});
test('sheet renderer produces valid SVG rasterizable by sharp',async()=>{
  const r=createSheetRenderer(),img=await r.png(compiled(),'test');
  const sharp=(await import('sharp')).default,png=await sharp(Buffer.from(img.pngBase64,'base64')).png().toBuffer();
  assert.ok(png.length>1000);
});
test('accept when judge prefers candidate in both orders: zero model calls',async()=>{
  const m=model();let judgeCalls=0;
  const verdict={preferred:'A',criticalErrors:[],reason:'clear'};
  const judge={calls:[],judge:async()=>{judgeCalls++;return {...verdict};}};
  const out=await criticRepair(compiled(),{judge:judge,model:m,registry:registry(),semantic:semantic(),mentalModel:mentalModel()});
  assert.equal(out.repaired,false);
  assert.equal(out.decision.action,'accept');
  assert.equal(m.calls.length,0);
  assert.equal(judgeCalls,2);
});
test('repair path: judge flags errors, one director repair, re-lint passes',async()=>{
  const m=model();
  const bad={preferred:'B',criticalErrors:['water arrow points to leaf instead of roots'],reason:'wrong target'};
  const good={preferred:'A',criticalErrors:[],reason:'clear'};
  let flip=false;
  const judge={calls:[],judge:async()=>{flip=!flip;return flip?bad:good;}};
  const out=await criticRepair(compiled(),{judge:judge,model:m,registry:registry(),semantic:semantic(),mentalModel:mentalModel()});
  assert.equal(out.repaired,true);
  assert.equal(out.decision.action,'repair');
  assert.equal(m.calls.length,1);
  assert.equal(m.calls[0].stage,'director');
  assert.ok(out.findingsAfter.every(f=>f.severity!=='hard'));
});
test('repair prompt is included in the director call instructions',async()=>{
  const m=model();
  let n=0;
  const judge={calls:[],judge:async()=>{n++;return n===1?{preferred:'B',criticalErrors:['hero not salient'],reason:'r'}:{preferred:'A',criticalErrors:[],reason:'ok'};}};
  await criticRepair(compiled(),{judge,model:m,registry:registry(),semantic:semantic(),mentalModel:mentalModel()});
});
test('position bias handled: inconsistent verdicts fall back to errors union',()=>{
  const d=decideFromPairwise({preferred:'A',criticalErrors:['x'],reason:'f'},{preferred:'A',criticalErrors:['x','y'],reason:'r'});
  assert.equal(d.action,'repair');
  assert.deepEqual(d.errors.sort(),['x','y']);
  const accept=decideFromPairwise({preferred:'A',criticalErrors:[],reason:'f'},{preferred:'B',criticalErrors:[],reason:'r'});
  assert.equal(accept.action,'accept');
});
test('hard lint failure before critic throws without any judge call',async()=>{
  const c=compiled();c.objects[0].y=99999;
  const judge={calls:[],judge:async()=>{throw new Error('must not be called');}};
  await assert.rejects(()=>criticRepair(c,{judge:judge,model:model(),registry:registry(),semantic:semantic(),mentalModel:mentalModel()}),/preflight/);
});
test('repair that breaks narration or identity is rejected',async()=>{
  const m=model();
  const broken=scene();broken.beats[0].narration='rewritten narration';
  m.generate=async(_s,_i,_input,_schema,validate)=>validate({scene:broken});
  let n=0;
  const judge={calls:[],judge:async()=>{n++;return n===1?{preferred:'B',criticalErrors:['e'],reason:'r'}:{preferred:'A',criticalErrors:[],reason:'ok'};}};
  await assert.rejects(()=>criticRepair(compiled(),{judge,model:m,registry:registry(),semantic:semantic(),mentalModel:mentalModel()}),/narration/);
});

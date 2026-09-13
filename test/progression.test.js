import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures} from '../dist/src/explainer/fixtures.js';
import {compileScene,estimateTiming} from '../dist/src/explainer/engine.js';
import {progressionFrames,staticIntervalMs,connectorThroughNode} from '../dist/src/explainer/progression.js';

const compile=(name,index,timing)=>compileScene(fixtures[name].scenes[index],timing);

test('V3-5 progression: 5 frames at 0/25/50/75/100%, deterministic, revealing',()=>{
  const scene=compile('attention',0);
  const frames=progressionFrames(scene);
  assert.deepEqual(frames.map(f=>f.timeMs),[0,Math.round(scene.durationMs*0.25),Math.round(scene.durationMs*0.5),Math.round(scene.durationMs*0.75),scene.durationMs]);
  assert(frames[0].svg.length<frames.at(-1).svg.length,'start frame draws less than end frame');
  assert.deepEqual(frames.map(f=>f.svg),progressionFrames(scene).map(f=>f.svg),'same scene → same bytes');
  const more=compile('attention',0,estimateTiming(scene.narration,200));
  assert.notDeepEqual(frames.map(f=>f.svg),progressionFrames(more).map(f=>f.svg),'different timing → different progression');
});
test('V3-5 static interval: clustered anchors leave a narrated dead zone; spread fixes it',()=>{
  const words30=Array.from({length:30},(_,i)=>`term${i}`).join(' ');
  const base={id:'s',title:'T',layout:'flow',edges:[],note:''};
  const clustered={...base,narration:words30,nodes:[0,1,2].map(i=>({id:`n${i}`,label:`Item ${i}`,wordIndex:0}))};
  assert(staticIntervalMs(compileScene(clustered))>3500,'all anchors at word 0 leave a long narrated stretch with no change');
  const paced={...base,narration:words30,nodes:[0,1,2,3].map(i=>({id:`n${i}`,label:`Item ${i}`,wordIndex:i*9}))};
  assert(staticIntervalMs(compileScene(paced))<=3500,'anchors paced through the narration stay under the limit');
});
test('V3-5 connector lint: impossible route flagged, clean scene silent',()=>{
  const clean=compileScene(fixtures.attention.scenes[0]);
  assert.deepEqual(connectorThroughNode(clean),[]);
  // A full wall of stacked blockers between the endpoints: no bow candidate can clear
  // it, so the fallback route crosses — the lint must surface that residual defect.
  const trapped=compileScene(fixtures.attention.scenes[0]);
  const wall=[0,1,2,3,4,5,6,7].map(i=>({...trapped.nodes[0],id:`wall${i}`,x:435,y:110+i*42,w:44,h:38}));
  const ring={...trapped,nodes:[...trapped.nodes,...wall]};
  const hits=connectorThroughNode(ring);
  assert(hits.some(h=>h.through.startsWith('wall')),'solid wall of obstacles forces a crossing');
});

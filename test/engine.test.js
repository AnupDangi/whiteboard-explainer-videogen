import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,compileScene,estimateTiming,renderSVG,sceneState,locateScene,durationOf,advancePlayback,wrapText,preflightScene} from '../dist/src/engine.js';
import {renderIcon,hasIcon} from '../dist/src/icons.js';
import {fixtures} from '../dist/src/fixtures.js';
const copy=()=>structuredClone(fixtures.attention);
test('H04/H22 rejects invalid references, anchors, IDs and primitive layouts',()=>{
  for(const mutate of [p=>p.scenes[0].edges[0].to='missing',p=>p.scenes[0].nodes[0].wordIndex=999,p=>p.scenes[0].nodes[1].id='n0',p=>p.scenes[0].id='../file',p=>p.scenes[0].layout='eval']){
    const p=copy();mutate(p);assert.throws(()=>validatePlan(p));
  }
  const p=copy();p.scenes[0].code='dangerous';assert.equal(validatePlan(p).scenes[0].code,undefined);
});
test('H05/H13/H17 frame is deterministic after arbitrary seeking; prior geometry stable',()=>{
  const scene=compileScene(copy().scenes[0]);const before=renderSVG(scene,7000);
  for(const t of [0,90000,2500,1,300])renderSVG(scene,t);
  assert.equal(renderSVG(scene,7000),before);
  const a=sceneState(scene,1000).nodes[0],b=sceneState(scene,90000).nodes[0];
  assert.deepEqual([a.x,a.y,a.w,a.h],[b.x,b.y,b.w,b.h]);
  const mid=scene.nodes[0].startMs+scene.nodes[0].drawMs/2;
  assert.equal(sceneState(scene,mid).nodes[0].progress,.5);
});
test('H07 supported layouts keep node rectangles disjoint and inside board',()=>{
  for(const layout of ['flow','branch','compare','hierarchy','timeline','radial','convergence'])for(let count=2;count<=6;count++){
    const s=copy().scenes[0];s.layout=layout;s.nodes=Array.from({length:count},(_,i)=>({id:`a${i}`,label:`Item ${i}`,wordIndex:i}));s.edges=[];
    const {nodes}=compileScene(s);
    for(const a of nodes){assert(a.x>=0&&a.y>=150&&a.x+a.w<=1280&&a.y+a.h<600);
      for(const b of nodes)if(a!==b)assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`${layout} overlaps`);}
  }
});
test('H09 connectors attach to boundaries of referenced nodes',()=>{
  for(const fixture of Object.values(fixtures))for(const source of fixture.scenes){const s=compileScene(source);
    const onBoundary=(x,y,n)=>(x===n.x||x===n.x+n.w)&&y>=n.y&&y<=n.y+n.h||(y===n.y||y===n.y+n.h)&&x>=n.x&&x<=n.x+n.w;
    for(const e of s.edges){assert(onBoundary(e.x1,e.y1,s.nodes.find(n=>n.id===e.from)));assert(onBoundary(e.x2,e.y2,s.nodes.find(n=>n.id===e.to)));}
  }
});
test('H02/H16 timing changes scene duration and preserves final events',()=>{
  const s=copy().scenes[0];const fast=compileScene(s,estimateTiming(s.narration,180)),slow=compileScene(s,estimateTiming(s.narration,100));
  assert(slow.durationMs>fast.durationMs);
  for(const c of [fast,slow]){assert(c.durationMs>c.timing.durationMs);for(const e of [...c.nodes,...c.edges])assert(e.startMs+e.drawMs<c.durationMs);}
});
test('H17 exact scene boundary selects next scene and global end clamps',()=>{
  const scenes=copy().scenes.map(s=>compileScene(s));assert.equal(locateScene(scenes,scenes[0].durationMs).index,1);
  assert.equal(locateScene(scenes,1e9).localMs,scenes.at(-1).durationMs);assert.equal(locateScene([],0),null);
  assert.equal(durationOf(scenes),scenes.reduce((sum,s)=>sum+s.durationMs,0));
});
test('H21 buffer clamps and resumes without jumping over unavailable time',()=>{
  assert.deepEqual(advancePlayback(900,300,1000,false),{timeMs:1000,buffering:true,ended:false});
  assert.deepEqual(advancePlayback(1000,100,2000,false),{timeMs:1100,buffering:false,ended:false});
  assert.deepEqual(advancePlayback(1900,200,2000,true),{timeMs:2000,buffering:false,ended:true});
});
test('preflightScene passes real fixtures and catches an induced cross-node overlap',()=>{
  for(const fixture of Object.values(fixtures))for(const source of fixture.scenes)preflightScene(compileScene(source));
  const s=compileScene(copy().scenes[0]);
  const overlapped={...s,nodes:s.nodes.map((n,i)=>i===1?{...n,x:s.nodes[0].x,y:s.nodes[0].y}:n)};
  assert.throws(()=>preflightScene(overlapped),/overlap/);
});
test('SceneGraph v2: node kind renders an icon and unknown kinds are rejected',()=>{
  const p=copy();p.scenes[0].nodes[0].kind='key';
  const scene=compileScene(p.scenes[0]);
  const svg=renderSVG(scene,scene.nodes[0].startMs+scene.nodes[0].drawMs);
  assert(svg.includes('<circle')||svg.includes('<line'),'icon markup present for a kind that renders one');
  const bad=copy();bad.scenes[0].nodes[0].kind='not-a-real-kind';assert.throws(()=>validatePlan(bad));
  const generic=copy();generic.scenes[0].nodes[0].kind='generic';assert.equal(validatePlan(generic).scenes[0].nodes[0].kind,undefined);
});
test('Rich illustrations: multi-part figures draw in outline→detail→fill stages and reject bad combos',()=>{
  const illustrated=fixtures.illustrations.scenes[0];
  const scene=compileScene(illustrated);
  const node=scene.nodes.find(n=>n.shape==='illustration');
  assert(node,'fixture node compiled with illustration shape');
  assert(node.drawMs>900,'illustration nodes get more draw time than a plain box');
  const early=renderSVG(scene,node.startMs+node.drawMs*0.1);
  const mid=renderSVG(scene,node.startMs+node.drawMs*0.5);
  const late=renderSVG(scene,node.startMs+node.drawMs);
  assert(early.includes('<circle')||early.includes('<path'),'outline stroke present early');
  assert(!early.includes('fill-opacity'),'no fill yet at 10% progress');
  assert(mid.includes('stroke-dasharray'),'mid-draw still shows a partial stroke reveal');
  assert(late.includes('fill-opacity'),'fill wash present once the figure completes');
  const boxScene=compileScene(fixtures.attention.scenes[0]);
  const withBox=renderSVG(boxScene,boxScene.nodes[0].startMs+boxScene.nodes[0].drawMs);
  assert(withBox.includes('rx="10"'),'plain nodes still render the rounded-rect box');
  for(const t of [0,node.startMs,node.startMs+node.drawMs/2,node.startMs+node.drawMs,scene.durationMs]) renderSVG(scene,t);
  preflightScene(scene);
  const bad=structuredClone(illustrated);bad.nodes[0].shape='illustration';bad.nodes[0].kind='key';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[bad]}),/[Ii]llustration/);
  const badShape=structuredClone(illustrated);badShape.nodes[0].shape='sparkle';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badShape]}),/shape/);
});
test('H22 renderer escapes content and handles long unbroken labels',()=>{
  const s=copy().scenes[0];s.title='<script>alert("x")</script>';s.nodes[0].label='A & B';
  const svg=renderSVG(compileScene(s),90000);assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));assert(svg.includes('A &amp; B'));
  assert(wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZ',60,20).length>1);
});
test('Icon shape: pasted icon with label beside it, no box border',()=>{
  const scene=compileScene(fixtures.icons.scenes[0]);
  const node=scene.nodes.find(n=>n.shape==='icon');
  assert(node,'icons fixture node compiled with icon shape');
  const done=renderSVG(scene,node.startMs+node.drawMs);
  assert(done.includes('text-anchor="start"'),'icon label is beside the icon (left-anchored), not centered in a box');
  // Icon branch renders no rounded-rect box: the only rects are page background + subtitle bar.
  assert.equal((done.match(/rx="10"/g)||[]).length,0,'icon nodes render no box rect');
  const mid=renderSVG(scene,node.startMs+node.drawMs*0.2);
  assert(mid.includes('<g opacity='),'icon fades/scales in rather than stroke-drawing a box');
  preflightScene(scene);
  const bad=structuredClone(fixtures.icons.scenes[0]);bad.nodes[0].shape='icon';bad.nodes[0].kind='generic';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[bad]}),/[Ii]con/);
});
test('Wave A shapes: circle, square, bullet, number render as distinct primitives',()=>{
  const scene=compileScene(fixtures.shapes.scenes[0]);
  for(const shape of ['circle','square','bullet','number'])assert(scene.nodes.some(n=>n.shape===shape),`${shape} node compiled`);
  // Completed frame: circle→1 ellipse, number badge→1 ellipse, square→rx="0" rect,
  // bullet→none. Background + subtitle bar add no ellipse/rx="10".
  const done=renderSVG(scene,scene.durationMs);
  assert(done.includes('<ellipse'),'circle renders an ellipse container');
  assert(done.includes('rx="0"'),'square renders sharp corners');
  assert(done.includes('•'),'bullet renders point markers');
  assert(done.includes('<circle'),'number renders a round badge');
  assert.equal((done.match(/<ellipse/g)||[]).length,1,'circle container draws the only ellipse');
  assert.equal((done.match(/<circle/g)||[]).length,1,'number badge draws the only circle');
  assert.equal((done.match(/rx="10"/g)||[]).length,0,'no rounded box anywhere in the scene');
  preflightScene(scene);
  const badShape=structuredClone(fixtures.shapes.scenes[0]);badShape.nodes[0].shape='star';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badShape]}),/shape/);
});
test('Attract and repel are distinct kinds with mirrored glyphs',()=>{  const scene=compileScene(fixtures.shapes.scenes[1]);
  const kinds=scene.nodes.filter(n=>n.shape!=='annotation').map(n=>n.kind);
  assert.deepEqual(kinds,['attract','repel']);
  for(const kind of ['attract','repel','note','tool','cycle','light','temperature','molecule'])assert(hasIcon(kind),`${kind} has an icon`);
  const a=renderIcon('attract',100,100,20,'#000'),r=renderIcon('repel',100,100,20,'#000');
  assert(a.length>0&&r.length>0&&a!==r,'attract and repel render different markup');
  preflightScene(scene);
  assert(renderSVG(scene,scene.durationMs).includes('<path'),'icon glyphs present in final frame');
});
test('Annotation shape: compiler-placed caption beside its target, no container',()=>{  const scene=compileScene(fixtures.shapes.scenes[2]);
  const anns=scene.nodes.filter(n=>n.shape==='annotation');
  assert.equal(anns.length,2);
  const target=scene.nodes.find(n=>n.id===anns[0].attachTo);
  assert(target,'annotation references a real target');
  assert(anns[0].y>=target.y+target.h,'default below placement sits under the target');
  const done=renderSVG(scene,scene.durationMs);
  assert(done.includes('what am I looking for?'),'annotation text drawn');
  assert(done.includes('font-style="italic"'),'annotations render distinctly');
  preflightScene(scene);
  const badTarget=structuredClone(fixtures.shapes.scenes[2]);badTarget.nodes[2].attachTo='missing';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badTarget]}),/attachTo/);
  const badSelf=structuredClone(fixtures.shapes.scenes[2]);badSelf.nodes[2].attachTo='n2';
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badSelf]}),/attachTo/);
  const badLong=structuredClone(fixtures.shapes.scenes[2]);badLong.nodes[2].label='x'.repeat(81);
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badLong]}),/80/);
});
test('Edge labels read at the arrow midpoint; emphasis draws a highlight wash',()=>{
  const labeledScene=copy().scenes[0];labeledScene.edges[0].label='heats';
  const scene=compileScene(labeledScene);
  const done=renderSVG(scene,scene.durationMs);
  assert(done.includes('heats'),'edge label drawn');
  assert(done.includes('paint-order="stroke"'),'label halo keeps it legible');
  const unlabeled=compileScene(copy().scenes[0]);
  assert(!renderSVG(unlabeled,unlabeled.durationMs).includes('paint-order'),'unlabeled edges draw nothing extra');
  const badScene=copy().scenes[0];badScene.edges[0].label='x'.repeat(25);
  assert.throws(()=>validatePlan({version:1,title:'t',scenes:[badScene]}),/edge label/i);
  const emphScene=copy().scenes[0];emphScene.nodes[0].emphasis=true;
  const emphSvg=renderSVG(compileScene(emphScene),90000);
  assert(emphSvg.includes('#f2c94c'),'emphasis node gets a highlight wash');
  const plainSvg=renderSVG(compileScene(copy().scenes[0]),90000);
  assert(!plainSvg.includes('#f2c94c'),'no wash without emphasis');
});
test('Compile is idempotent: recompiling compiled scenes reproduces geometry',()=>{
  // Export recompiles job.json scenes; any divergence breaks MP4 export outright.
  for(const fixture of Object.values(fixtures)){
    for(const source of fixture.scenes){
      const once=compileScene(structuredClone(source));
      const twice=compileScene(JSON.parse(JSON.stringify(once)));
      assert.deepEqual(twice.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h]),once.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h]));
    }
  }
});

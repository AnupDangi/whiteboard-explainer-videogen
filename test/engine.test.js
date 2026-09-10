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
test('Phase 7: visualIntent is validated and preserved as planning metadata',()=>{
  const withIntent=copy();withIntent.scenes[0].nodes[0].visualIntent='arrow from query to each key, comparison';
  assert.equal(validatePlan(withIntent).scenes[0].nodes[0].visualIntent,'arrow from query to each key, comparison');
  const tooLong=copy();tooLong.scenes[0].nodes[0].visualIntent='x'.repeat(81);
  assert.throws(()=>validatePlan(tooLong),/visualIntent/);
  const empty=copy();empty.scenes[0].nodes[0].visualIntent='   ';
  assert.throws(()=>validatePlan(empty),/visualIntent/);
  // Older fixtures without visualIntent still validate (backward compatible, absent from output).
  const without=copy();assert.equal(validatePlan(without).scenes[0].nodes[0].visualIntent,undefined);
});
test('Phase 11: edges route as a curve, not a straight line, and the label clears the line',()=>{
  const p=copy();p.scenes[0].edges[0]={...p.scenes[0].edges[0],label:'becomes'};
  const scene=compileScene(p.scenes[0]);
  const edge=scene.edges[0];
  const done=renderSVG(scene,edge.startMs+edge.drawMs);
  assert.match(done,/<path d="M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+"/,'edge path uses a quadratic bezier (Q), not a straight line (L)');
  // Label position must not sit on the straight line between endpoints (i.e. it must have
  // been nudged off-axis by the curve's bow) — this is the fix for the live-verified bug
  // where a short connector's label rendered clipped behind the destination shape.
  const straightMidX=(edge.x1+edge.x2)/2,straightMidY=(edge.y1+edge.y2)/2;
  const textTags=[...done.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="middle" font-size="14"/g)];
  assert(textTags.length>0,'edge label text was rendered');
  const [,lx,ly]=textTags[0];
  const distFromStraightMid=Math.hypot(Number(lx)-straightMidX,Number(ly)-straightMidY);
  assert(distFromStraightMid>5,'label sits off the straight connector line, not on top of it');
});
test('wrapText breaks hyphenated words at hyphens, never mid-word',()=>{
  const lines=wrapText('one-million-token x',150,20);
  assert(lines[0].endsWith('-'),'first line ends at a hyphen, not inside "token"');
  assert.equal(lines.join(' ').replace(/- /g,'-'),'one-million-token x');
  assert(wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZ',60,20).length>1);
});
test('edge labels paint above node boxes, never underneath',()=>{
  const p=copy();p.scenes[0].edges[0]={...p.scenes[0].edges[0],label:'deploys'};
  const done=renderSVG(compileScene(p.scenes[0]),90000);
  assert(done.includes('deploys'),'edge label drawn');
  assert(done.indexOf('deploys')>done.lastIndexOf('rx="10"'),'label markup sits after the last node box');
});
test('V3-3 routeEdge avoids intermediate nodes, flipping and growing the bow',async()=>{
  const {routeEdge}=await import('../dist/src/engine.js');
  const e={x1:100,y1:300,x2:700,y2:300};
  const obstacle={x:330,y:260,w:160,h:80};
  // Base upward bow would pass straight through the obstacle.
  const base={cx:(e.x1+e.x2)/2,cy:300-Math.max(16,Math.min(34,600*0.3))};
  assert(base.cy>obstacle.y-8&&base.cy<obstacle.y+obstacle.h+8,'sanity: base bow intersects obstacle');
  const route=routeEdge(e,[obstacle]);
  for(let k=0;k<=12;k++){const t=k/12,mt=1-t;
    const x=mt*mt*e.x1+2*mt*t*route.cx+t*t*e.x2,y=mt*mt*e.y1+2*mt*t*route.cy+t*t*e.y2;
    assert(!(x>obstacle.x-8&&x<obstacle.x+obstacle.w+8&&y>obstacle.y-8&&y<obstacle.y+obstacle.h+8),`sample ${k} at ${x},${y} inside obstacle`);
  }
  const noObstacle=routeEdge(e,[]);
  assert.equal(noObstacle.cy,base.cy,'unobstructed edge keeps the plain upward bow');
});
test('V3-3 icon endpoints anchor to the glyph, not the invisible rect',()=>{
  const scene=compileScene(fixtures.icons.scenes[0]);
  const e=scene.edges[0],a=scene.nodes[0],b=scene.nodes[1];
  assert.equal(e.x1,a.x+2*Math.min(38,a.h*0.4)*(a.emphasis?1.25:1)+8,'from-endpoint sits at the glyph circle edge, not the layout rect border');
  assert(e.x2<e.x1||e.x2>b.x,'endpoint ordering sane');
});
test('V3-3 EXPLAIN_SKETCH renders wobbly strokes + hachure, deterministic per node',async()=>{
  const scene=compileScene(copy().scenes[0]);
  process.env.EXPLAIN_SKETCH='1';
  try{
    const done=renderSVG(scene,scene.durationMs);
    assert(done.includes('stroke-linejoin="round" stroke-dasharray'),'sketch double stroke present');
    assert((done.match(/stroke-width="1.3"/g)||[]).length>=3,'hachure lines drawn');
    assert.equal(renderSVG(scene,scene.durationMs),done,'same input+time yields identical sketch bytes');
    assert(!done.includes('stroke-dasharray="1240"'),'clean rect stroke replaced');
  }finally{delete process.env.EXPLAIN_SKETCH;}
  const clean=renderSVG(scene,scene.durationMs);
  assert(clean.includes('rx="10"'),'without flag the clean style is unchanged');
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
    // V3-3: icon nodes are containerless — the boundary is the glyph circle's edge
    // (center at x+r+8, y+h/2), not the invisible layout rect.
    const onBoundary=(x,y,n)=>{
      if(n.shape==='icon'){const r=Math.min(38,n.h*0.4)*(n.emphasis?1.25:1);return Math.abs(Math.hypot(x-(n.x+r+8),y-(n.y+n.h/2))-r)<0.01;}
      return (x===n.x||x===n.x+n.w)&&y>=n.y&&y<=n.y+n.h||(y===n.y||y===n.y+n.h)&&x>=n.x&&x<=n.x+n.w;
    };
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
test('Phase 8: long labels on a crowded 6-node scene still compile to disjoint, in-bounds geometry',()=>{
  const LONG_LABELS=[
    'Distributed cache invalidation protocol','Asynchronous request queue backlog',
    'Cross-region replication latency budget','Session token rotation policy',
    'Rate limiter token bucket refill','Structured logging correlation identifier',
  ];
  for(const layout of ['flow','branch','compare','hierarchy','timeline','radial','convergence']){
    const s=copy().scenes[0];s.layout=layout;
    s.nodes=LONG_LABELS.map((label,i)=>({id:`n${i}`,label,wordIndex:i,emphasis:i===0}));
    s.edges=[];
    const {nodes}=compileScene(s);
    for(const a of nodes){
      assert(a.x>=0&&a.y>=150&&a.x+a.w<=1280&&a.y+a.h<=600,`${layout}: ${a.id} escapes the safe region`);
      for(const b of nodes)if(a!==b)assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`${layout}: ${a.id} overlaps ${b.id}`);
    }
  }
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

test('A2: caption holds the last spoken phrase through a mid-narration gap',()=>{
  // Regression: the "hold" branch used to index from sceneState().activeWord, which is -1
  // for every gap by definition, so it always resolved to an empty window and the caption
  // blanked out on every inter-word pause — not just on the long tail after the last word.
  const words=[
    {word:'alpha',   startMs:0,    endMs:250},
    {word:'bravo',   startMs:250,  endMs:500},
    {word:'charlie', startMs:500,  endMs:750},
    {word:'delta',   startMs:750,  endMs:1000},  // word A: last word before the gap
    {word:'echo',    startMs:1800, endMs:2100},  // word B: 800 ms later
    {word:'foxtrot', startMs:2100, endMs:2400},
  ];
  const timing={kind:'estimated',words,durationMs:2400};
  const source={id:'gap',title:'Gap scene',narration:words.map(w=>w.word).join(' '),layout:'flow',
    nodes:[{id:'n0',label:'First idea',wordIndex:0},{id:'n1',label:'Second idea',wordIndex:4}],
    edges:[{from:'n0',to:'n1'}]};
  const scene=compileScene(structuredClone(source),timing);
  const caption=svg=>[...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m=>m[1].trim()).filter(Boolean);

  // Inside the 800 ms mid-narration gap: no word is active, but the phrase must be held.
  assert.equal(sceneState(scene,1400).activeWord,-1,'time 1400 sits between words');
  const held=caption(renderSVG(scene,1400));
  assert(held.length>0,'caption is held (non-empty) during a mid-narration gap');
  assert(held.join(' ').includes('delta'),'held caption contains the last spoken word');
  assert(!held.join(' ').includes('[object Object]'),'caption renders word text, not object stringification');
  assert(!held.join(' ').includes('echo'),'held caption does not leak words not yet spoken');

  // Sanity: a word that IS active still renders, and the long tail still blanks out.
  assert(caption(renderSVG(scene,900)).join(' ').includes('delta'),'active word renders');
  assert.equal(caption(renderSVG(scene,2400)).length,0,'caption hides after the final word ends');
  // Before the very first word there is nothing to hold, so the caption stays empty.
  const late={...timing,words:words.map(w=>({...w,startMs:w.startMs+400,endMs:w.endMs+400})),durationMs:2800};
  const lateScene=compileScene(structuredClone(source),late);
  assert.equal(sceneState(lateScene,200).activeWord,-1,'time 200 is before the first word');
  assert.equal(caption(renderSVG(lateScene,200)).length,0,'no caption before the first word completes');
});

import type {Plan,Scene,Timing,CompiledScene,CompiledNode,CompiledEdge} from './types.js';
import {NODE_KINDS,LAYOUTS} from './vocabulary.js';
import {renderIcon,hasIcon} from './icons.js';
import {renderIllustration,hasIllustration} from './illustrations.js';
import {KIND_ACCENT,STROKE as STROKE_TOKENS,SEMANTIC_COLORS} from './style.js';
/** Pure, browser-compatible scene compiler. No generated code is evaluated. */
export const WIDTH = 1280;
export const HEIGHT = 720;
// Canvas safe regions: no layout may place content above SAFE_TOP (title band) or below
// SAFE_BOTTOM (buffer above the subtitle bar, which starts at y=640).
export const SAFE_TOP = 150;
export const SAFE_BOTTOM = 600;
const COLORS = ['#d9edf4', '#e6dff5', '#f9ebbd', '#dbecdd', '#f6ded4'];
// Semantic color system: same concept gets the same color across scenes (V2 §25).
// Fallback to flat palette cycle for generic nodes or when kind has no semantic color.
const fail = (message:string):never => { throw new Error(message); };
const string = (value:unknown, max:number, name:string) => typeof value === 'string' && value.trim() && value.length <= max || fail(`Invalid ${name}: expected 1–${max} characters; received ${typeof value === 'string' ? value.length : typeof value}`);

export function validatePlan(input: unknown): Plan {
  const candidate = input as Plan;
  return validateCandidate(candidate);
}
function validateCandidate(input: Plan): Plan {
  if (!input || input.version !== 1) fail('Expected version 1');
  string(input.title, 90, 'title');
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 120) fail('Expected 1–120 scenes');
  const ids = new Set();
  for (const scene of input.scenes) {
    string(scene.id, 40, 'scene id');
    if (!/^[a-zA-Z0-9_-]+$/.test(scene.id) || ids.has(scene.id)) fail('Invalid or duplicate scene id');
    ids.add(scene.id);
    string(scene.title, 70, 'scene title'); string(scene.narration, 1800, 'narration');
    if (!(LAYOUTS as readonly string[]).includes(scene.layout)) fail('Unknown layout');
    if (!Array.isArray(scene.nodes) || scene.nodes.length < 2 || scene.nodes.length > 6) fail('Expected 2–6 nodes');
    const nodeIds = new Set();
    const words = scene.narration.trim().split(/\s+/);
    for (const node of scene.nodes) {
      string(node.id, 40, 'node id'); string(node.label, node.shape==='bullet'?160:node.shape==='annotation'?80:64, 'node label');
      if (!/^[a-zA-Z0-9_-]+$/.test(node.id) || nodeIds.has(node.id)) fail('Invalid or duplicate node id');
      nodeIds.add(node.id);
      if (!Number.isInteger(node.wordIndex) || node.wordIndex < 0 || node.wordIndex >= words.length) fail('wordIndex outside narration');
      // kind is optional here (older fixtures predate it); the LLM-facing schema requires it.
      if (node.kind !== undefined && !(NODE_KINDS as readonly string[]).includes(node.kind)) fail('Unknown node kind');
      if (node.emphasis !== undefined && typeof node.emphasis !== 'boolean') fail('Invalid emphasis flag');
      if (node.shape !== undefined && !['box','illustration','icon','circle','square','bullet','number','annotation'].includes(node.shape)) fail('Invalid node shape');
      if (node.shape === 'illustration' && !hasIllustration(node.kind)) fail(`Illustration shape requires a kind with a reusable illustration (node ${node.id})`);
      if (node.shape === 'icon' && !hasIcon(node.kind)) fail(`Icon shape requires a kind with an icon (node ${node.id})`);
      // Annotations anchor relatively (V2 §24): attachTo must be a different, non-annotation
      // node in the same scene; the compiler resolves geometry from the target's final rect.
      if (node.shape === 'annotation') {
        const target = (scene.nodes as typeof scene.nodes).find(n => n.id === node.attachTo);
        if (!target || target.id === node.id || target.shape === 'annotation') fail(`Annotation ${node.id} needs a valid non-annotation attachTo node`);
        if (!['below','above','left','right'].includes(node.position as string)) fail(`Annotation ${node.id} needs a valid position`);
      }
      // keyPoint is planning metadata (which chapter key point this node visualizes),
      // not render data — validated here, preserved below, ignored by the renderer.
      if (node.keyPoint !== undefined && (typeof node.keyPoint !== 'string' || !node.keyPoint.trim() || node.keyPoint.length > 60)) fail(`Invalid keyPoint ${JSON.stringify(String(node.keyPoint)).slice(0,80)} (node ${node.id}): copy EXACTLY one chapter key point, 1-60 chars`);
      // visualIntent is the Semantic Storyboard link (V2 §8): what this node should visually
      // show, shared upstream of both narration and the Visual Director's kind/shape choice.
      // Planning metadata like keyPoint — validated, preserved, never rendered directly.
      if (node.visualIntent !== undefined && (typeof node.visualIntent !== 'string' || !node.visualIntent.trim() || node.visualIntent.length > 80)) fail(`Invalid visualIntent (node ${node.id}): 1-80 chars`);
    }
    if (!Array.isArray(scene.edges) || scene.edges.length > 10) fail('Invalid edges');
    for (const e of scene.edges) if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) fail('Dangling or self connector');
    for (const e of scene.edges) if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 24)) fail('Invalid edge label');
    if (scene.note !== undefined && scene.note !== null && String(scene.note).trim() !== '') string(String(scene.note), 170, 'note');
  }
  // Whitelist all data crossing into the renderer; discard unknown provider fields.
  return {version: 1, title: input.title, scenes: input.scenes.map(s => ({
    id: s.id, title: s.title, narration: s.narration, layout: s.layout,
    nodes: s.nodes.map(n => ({id:n.id,label:n.label,wordIndex:n.wordIndex,...(n.kind&&n.kind!=='generic'?{kind:n.kind}:{}),...(n.emphasis?{emphasis:true}:{}),...(n.shape&&n.shape!=='box'?{shape:n.shape}:{}),...(typeof n.keyPoint==='string'&&n.keyPoint?{keyPoint:n.keyPoint}:{}),...(typeof n.visualIntent==='string'&&n.visualIntent?{visualIntent:n.visualIntent}:{}),...(n.shape==='annotation'?{attachTo:n.attachTo,position:n.position}:{})})),
    edges:s.edges.map(e=>({from:e.from,to:e.to,...(typeof e.label==='string'&&e.label?{label:e.label}:{})})), note:s.note || ''
  }))};
}

/** Uniform timing is explicitly an estimate, never forced alignment. */
export function estimateTiming(text:string, wordsPerMinute = 145) {
  const words = text.trim().split(/\s+/);
  const ms = 60000 / wordsPerMinute;
  return {kind:'estimated', words:words.map((word,i)=>({word,startMs: i*ms,endMs:(i+1)*ms})), durationMs:words.length*ms};
}

// Per-character-class width ratios (of font size) — a materially closer isomorphic stand-in
// for DejaVu Sans than a single flat constant, without a font-metrics dependency. A full
// glyph-accurate measurement (opentype.js or canvas measureText) remains a future upgrade.
const NARROW_CHARS = new Set('iIlj.,;:\'`|!ft-'.split(''));
const WIDE_CHARS = new Set('mwMW@%'.split(''));
function charWidthRatio(ch:string):number {
  if (ch === ' ') return 0.28;
  if (NARROW_CHARS.has(ch)) return 0.32;
  if (WIDE_CHARS.has(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.5;
}
export function measureText(text:string, fontSize:number):number {
  let total = 0; for (const ch of text) total += charWidthRatio(ch);
  return total * fontSize;
}
export function wrapText(text:string, maxWidth:number, fontSize:number, measure = measureText) {
  const words = text.split(/\s+/); const lines=[]; let line='';
  for (const word of words) {
    if (measure(word,fontSize) > maxWidth) {
      if (line) {lines.push(line); line='';}
      let part='';
      for (const c of word) { if (measure(part+c,fontSize)>maxWidth && part) {lines.push(part);part='';} part+=c; }
      line=part;
    } else if (line && measure(`${line} ${word}`,fontSize)>maxWidth) {lines.push(line);line=word;}
    else line += `${line?' ':''}${word}`;
  }
  if(line) lines.push(line);
  return lines;
}

type Geometry = {x:number;y:number;w:number;h:number};
/** One geometry function per layout family. Each must keep every node inside
 *  [0,WIDTH] x [SAFE_TOP,SAFE_BOTTOM] and disjoint from its siblings for counts 2–6. */
const LAYOUT_GEOMETRY: Record<string,(i:number,count:number)=>Geometry> = {
  branch: (i,count) => i===0
    ? {x:125,y:320,w:300,h:90}
    : {x:790,y:175+(i-1)*(370/Math.max(1,count-1)),w:300,h:Math.min(90,310/(count-1))},
  compare: (i) => ({x:110+(i%2)*590,y:190+Math.floor(i/2)*120,w:470,h:96}),
  flow: (i,count) => {
    const columns=count<=3?count:3;
    return {x:(WIDTH-columns*300-(columns-1)*65)/2+(i%columns)*365,y:count<=3?285:205+Math.floor(i/3)*185,w:300,h:110};
  },
  // Root at top, remaining nodes spread evenly in a row beneath it.
  hierarchy: (i,count) => {
    if(i===0)return {x:(WIDTH-260)/2,y:170,w:260,h:90};
    const childCount=count-1,spacing=(WIDTH-80)/childCount,w=Math.min(260,spacing-20);
    return {x:40+spacing*(i-1)+(spacing-w)/2,y:430,w,h:90};
  },
  // Left-to-right sequence, evenly spaced, vertically centered in the safe band.
  timeline: (i,count) => {
    const w=Math.min(280,Math.floor((WIDTH-80-(count-1)*40)/count)),totalWidth=count*w+(count-1)*40;
    return {x:(WIDTH-totalWidth)/2+i*(w+40),y:(SAFE_TOP+SAFE_BOTTOM-110)/2,w,h:110};
  },
  // A central concept with satellites split across a row above and a row below it.
  radial: (i,count) => {
    if(i===0)return {x:(WIDTH-240)/2,y:330,w:240,h:90};
    const satelliteIndex=i-1,total=count-1,topCount=Math.ceil(total/2),inTop=satelliteIndex<topCount;
    const rowIndex=inTop?satelliteIndex:satelliteIndex-topCount,rowCount=inTop?topCount:total-topCount;
    const spacing=(WIDTH-80)/rowCount,w=Math.min(240,spacing-20);
    return {x:40+spacing*rowIndex+(spacing-w)/2,y:inTop?170:500,w,h:80};
  },
  // Sources fan in from the left toward a single result on the right (mirrors 'branch').
  convergence: (i,count) => {
    const sourceCount=count-1;
    return i===count-1
      ? {x:790,y:320,w:300,h:90}
      : {x:125,y:175+i*(370/Math.max(1,sourceCount)),w:300,h:Math.min(90,310/Math.max(1,sourceCount))};
  },
};
const disjoint=(a:Geometry,b:Geometry)=>a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y;
/** Icon radius adapts to content context: the emphasized node (the scene's most important
 *  key point) gets a 25% larger pasted icon. Compile-time reserve and renderer use this
 *  same formula so label wrapping always matches the drawn glyph — never hardcoded. */
const iconRadius=(h:number,emphasis:boolean)=>Math.min(38,h*0.4)*(emphasis?1.25:1);
/** Illustration nodes carry real visual weight (a drawn figure, not a label), so — unlike a
 *  plain box — they opportunistically claim unused space around their laid-out slot: taller
 *  first (most layouts leave the safe band mostly empty vertically), then wider. Each attempt
 *  is checked against every other node's current (possibly already-grown) rectangle, so this
 *  can only shrink back to the untouched base geometry, never introduce an overlap. */
function growIllustrationBox(base:Geometry, others:Geometry[]):Geometry {
  let g={...base};
  for (const scale of [3.4,2.8,2.2,1.8,1.5,1.2,1]) {
    const h=base.h*scale, y=base.y-(h-base.h)/2;
    if (y<SAFE_TOP||y+h>SAFE_BOTTOM) continue;
    const rect={x:g.x,y,w:g.w,h};
    if (others.every(o=>disjoint(rect,o))) { g=rect; break; }
  }
  for (const scale of [2,1.7,1.4,1.2,1.05,1]) {
    const w=base.w*scale, x=base.x-(w-base.w)/2;
    if (x<0||x+w>WIDTH) continue;
    const rect={x,y:g.y,w,h:g.h};
    if (others.every(o=>disjoint(rect,o))) { g=rect; break; }
  }
  return g;
}
export function compileScene(scene: Scene, timing: Timing = estimateTiming(scene.narration)) {
  if (!timing.words?.length || !Number.isFinite(timing.durationMs) || timing.durationMs <= 0) fail('Invalid timing');
  // Annotations are positioned post-layout from their targets, so they take no layout
  // slot and must not shift siblings: layouts see only the non-annotation count. This
  // also keeps compile idempotent (recompiling compiled scenes, which carry placed
  // ghosts, reproduces identical geometry for export).
  const layoutIdx=new Map<number,number>();let layoutCount=0;
  scene.nodes.forEach((node,i)=>{if(node.shape!=='annotation')layoutIdx.set(i,layoutCount++);});
  const count=layoutCount;
  const geometry=LAYOUT_GEOMETRY[scene.layout]||LAYOUT_GEOMETRY.flow;
  const baseGeoms=scene.nodes.map((_,i)=>layoutIdx.has(i)?geometry(layoutIdx.get(i)!,count):{x:0,y:SAFE_TOP,w:100,h:40});
  const finalGeoms=baseGeoms.map(g=>({...g}));
  // Phase 8 overlap prevention: measure actual (wrapped) text and grow nodes taller when
  // their label needs more lines than the base slot allows, then gently push apart any that
  // still collide. Grows HEIGHT only, never width: wrapText already wraps the label to fit
  // the slot's own width, so its wrapped lines are — by construction — no wider than that
  // slot. Growing width from the label's *unwrapped* length (a prior bug here) ignored that
  // wrapping had already happened and forced boxes wider than their grid column, which no
  // amount of push-apart could recover in a multi-column layout.
  const textExpand=(geom:Geometry,label:string,shape:string,emphasis:boolean):Geometry=>{
    const maxWidth=shape==='icon'?geom.w-60:shape==='bullet'?geom.w-40:geom.w-36;
    // Font size buckets on h<70 (small slot -> smaller font), same rule the final render
    // step uses. Growing h can cross that threshold and change the font size, which changes
    // how many lines are needed — so converge to a fixed point instead of computing once
    // against the pre-growth font size (a prior bug: could grow into a self-inconsistent
    // height that still overflowed once the final step recomputed a bigger font for it).
    let h=geom.h;
    for(let iter=0;iter<4;iter++){
      const fontSize=shape==='number'?(h<70?20:28):(h<70?20:25);
      const lines=wrapText(label,Math.max(40,maxWidth),fontSize);
      const neededH=Math.max(geom.h,lines.length*fontSize*1.18+24);
      if(Math.abs(neededH-h)<0.5){h=neededH;break;}
      h=neededH;
    }
    return {...geom,h:Math.min(h,SAFE_BOTTOM-geom.y-10)};
  };
  scene.nodes.forEach((node,i)=>{
    if(node.shape==='annotation'||node.shape==='illustration')return;
    finalGeoms[i]=textExpand(finalGeoms[i],node.label||'',node.shape||'box',!!node.emphasis);
  });
  // Overlap resolution: textExpand only ever grows HEIGHT (never width — see its comment),
  // and every base layout geometry is already mutually disjoint at every supported node count
  // (locked in by the H07 test). So any overlap that appears here is strictly a same-column
  // vertical conflict introduced by that height growth — never a fresh horizontal conflict.
  // Sweep top-to-bottom (by original y): for each node, push it down only as far as any
  // already-placed node it actually shares X-range with requires (max of their bottoms) —
  // never further. This is provably correct in one pass (processing in Y order means every
  // constraint a later node needs has already been resolved on the earlier node), and unlike
  // grouping-by-transitive-X-overlap-into-one-linear-family (a first attempt), it does not
  // wrongly serialize two siblings that both overlap a common wide node above them (e.g. two
  // hierarchy children on either side of the root) but don't overlap *each other* — that
  // version pushed the second sibling down against the first even though nothing above it
  // required that, corrupting an otherwise-fine layout that never needed touching.
  {
    const xOverlap=(a:Geometry,b:Geometry)=>a.x<b.x+b.w&&b.x<a.x+a.w;
    const order=finalGeoms.map((_,i)=>i).sort((i,j)=>finalGeoms[i].y-finalGeoms[j].y);
    const placed:number[]=[];
    for(const i of order){
      const g=finalGeoms[i];
      let requiredY=g.y;
      for(const j of placed){const o=finalGeoms[j];if(xOverlap(g,o))requiredY=Math.max(requiredY,o.y+o.h);}
      g.y=requiredY;
      placed.push(i);
    }
  }
  scene.nodes.forEach((node,i)=>{
    if (node.shape!=='illustration') return;
    // Annotation layout slots are meaningless (annotations are repositioned post-growth),
    // so they must never block growth — otherwise recompile(export) of compiled scenes
    // (which carry placed ghosts) would grow differently than the job-time compile.
    finalGeoms[i]=growIllustrationBox(baseGeoms[i],finalGeoms.filter((_,j)=>j!==i&&scene.nodes[j].shape!=='annotation'));
  });
  // Annotations ignore their laid-out slot: the compiler positions a small caption box
  // adjacent to the attachTo target's FINAL rect (post-growth), trying
  // below/right/left/above in order. First fit wins; none fitting fails into repair.
  // Placed annotations accumulate so later ones avoid earlier ones (stale layout slots
  // of not-yet-placed annotations are ignored, never treated as obstacles).
  const placedAnnotations:Geometry[]=[];
  const placeAnnotation=(node:Scene['nodes'][number]):Geometry=>{
    const targetIdx=scene.nodes.findIndex(n=>n.id===node.attachTo);
    const t=finalGeoms[targetIdx];
    const w=Math.min(280,Math.max(140,t.w*0.8));
    const lines=wrapText(node.label,w-12,16);
    if(lines.length>3)fail(`Annotation ${node.id} too long for its caption box`);
    const h=lines.length*16*1.18+14;
    const clampX=(x:number)=>Math.max(0,Math.min(WIDTH-w,x));
    const candidates:Geometry[]=[
      {x:clampX(t.x),y:t.y+t.h+10,w,h},
      {x:Math.min(WIDTH-w,t.x+t.w+12),y:t.y+(t.h-h)/2,w,h},
      {x:Math.max(0,t.x-12-w),y:t.y+(t.h-h)/2,w,h},
      {x:clampX(t.x),y:t.y-10-h,w,h},
    ];
    const others=[...finalGeoms.filter((_,j)=>scene.nodes[j].shape!=='annotation'),...placedAnnotations];
    for(const rect of candidates){
      if(rect.y<SAFE_TOP||rect.y+rect.h>SAFE_BOTTOM)continue;
      if(others.every(o=>disjoint(rect,o))){placedAnnotations.push(rect);return rect;}
    }
    return fail(`Annotation ${node.id} has no room near ${node.attachTo}`);
  };
  scene.nodes.forEach((node,i)=>{ if(node.shape==='annotation')finalGeoms[i]=placeAnnotation(node); });
  // The scene note is otherwise dead weight (never drawn): promote short notes on roomy
  // scenes to a real marginalia annotation on the first node — unless the director already
  // placed one. Crowded scenes (5-6 nodes) are left alone per the density budget.
  const renderNodes=[...scene.nodes];
  if(scene.note&&scene.note.trim()&&scene.nodes.length<=4&&!scene.nodes.some(n=>n.shape==='annotation'||n.id===`${scene.id}-note`)){
    const target=scene.nodes.find(n=>n.shape!=='annotation');
    const ghost={id:`${scene.id}-note`,label:scene.note.trim(),wordIndex:target?target.wordIndex:0,shape:'annotation' as const,attachTo:target?target.id:'',position:'below' as const};
    if(target&&wrapText(ghost.label,268,16).length<=3){
      try{finalGeoms.push(placeAnnotation(ghost as Scene['nodes'][number]));renderNodes.push(ghost as Scene['nodes'][number]);}catch{/* no room: note stays undrawn, status quo */}
    }
  }
  const nodes=renderNodes.map((node,i)=>{
    const {x,y,w,h}=finalGeoms[i];
    // Illustration nodes reserve a short caption strip below the figure instead of centering
    // the label across the full box, and take longer to draw (more strokes/fills per figure).
    const isIllustration=node.shape==='illustration';
    // Icon shape: a real pasted icon beside its label, no box border/fill — reserve room for
    // the icon (same radius formula the renderer uses) on the label's left instead of the
    // illustration's bottom caption strip or the box's full-width centered text.
    const isIcon=node.shape==='icon';
    const iconReserve=isIcon?iconRadius(h,!!node.emphasis)*2+28:0;
    // Bullet nodes read as key-point lists: split the label into short points ('. ' or '|'
    // separated, at most 5), reserve a marker column, allow longer labels than boxes.
    const isBullet=node.shape==='bullet';
    const bulletReserve=isBullet?26:0;
    // Number nodes are round count badges: big text inside a circle, chord-limited width.
    const isNumber=node.shape==='number';
    // Annotations reuse their placed caption box: same formula as placement (w-12 at 16px)
    // so the wrapped lines always match the reserved rect.
    const isAnnotation=node.shape==='annotation';
    let fontSize=isIllustration?16:isAnnotation?16:isNumber?(h<70?20:28):(h<70?20:25);
    const maxWidth=isIllustration?w-24:isAnnotation?w-12:isIcon?w-iconReserve-16:isBullet?w-bulletReserve-16:isNumber?(Math.min(w,h)-8)*0.9:w-36;
    let lines=isBullet
      ?(()=>{const points=node.label.split(/\s*[|•]\s*|\.\s+/).map(s=>s.trim()).filter(Boolean);
        if(points.length>5)fail(`Too many bullet points ${node.id}`);
        return points.flatMap(p=>{const wrapped=wrapText(p,Math.max(40,maxWidth-18),fontSize);return ['• '+wrapped[0],...wrapped.slice(1)];});})()
      :wrapText(node.label,maxWidth,fontSize);
    const labelBudget=isIllustration?24:isNumber?h*0.7:h-12;
    // Phase 8: shrink type to fit before failing — a slot with little vertical room left
    // (e.g. a radial layout's satellite row) may still not have enough height even after
    // textExpand's growth, and a real label must show rather than blow up the whole scene.
    // Illustrations/annotations keep their fixed caption size; every other shape shrinks
    // down to the preflight-enforced 14px floor. Bullet re-splits its points at each size
    // since the point count itself is size-independent but wrapping per point is not.
    if(!isIllustration&&!isAnnotation)while(lines.length*fontSize*1.18>labelBudget&&fontSize>14){
      fontSize-=2;
      lines=isBullet
        ?(()=>{const points=node.label.split(/\s*[|•]\s*|\.\s+/).map(s=>s.trim()).filter(Boolean);
          return points.flatMap(p=>{const wrapped=wrapText(p,Math.max(40,maxWidth-18),fontSize);return ['• '+wrapped[0],...wrapped.slice(1)];});})()
        :wrapText(node.label,maxWidth,fontSize);
    }
    if(lines.length*fontSize*1.18>labelBudget) fail(`Label overflows ${node.id}`);
    const anchor=timing.words[node.wordIndex];
    if(!anchor) fail(`Missing speech anchor ${node.wordIndex}`);
    const semanticColor=node.kind?SEMANTIC_COLORS[node.kind]:undefined; const baseColor=semanticColor||COLORS[i%COLORS.length]; const fillOpacity=node.shape==='icon'||node.shape==='annotation'?0:0.25; return {...node,x,y,w,h,fontSize,lines,color:baseColor,fillOpacity,startMs:Math.max(0,anchor.startMs-80),drawMs:isIllustration?1700:900};
  });
  const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
  const edges=scene.edges.map(e=>{
    const a=byId[e.from],b=byId[e.to]; const dx=b.x-a.x,dy=b.y-a.y;
    let x1,y1,x2,y2;
    if(Math.abs(dx)>Math.abs(dy)) {
      x1=a.x+(dx>0?a.w:0);y1=a.y+a.h/2;x2=b.x+(dx>0?0:b.w);y2=b.y+b.h/2;
    } else {x1=a.x+a.w/2;y1=a.y+(dy>0?a.h:0);x2=b.x+b.w/2;y2=b.y+(dy>0?0:b.h);}
    return {...e,x1,y1,x2,y2,startMs:Math.max(a.startMs,b.startMs)+700,drawMs:650};
  });
  const eventEnd=Math.max(...nodes.map(n=>n.startMs+n.drawMs),...edges.map(e=>e.startMs+e.drawMs));
  return {...scene,nodes,edges,timing,audioUrl:undefined as string|undefined,durationMs:Math.ceil(Math.max(timing.durationMs,eventEnd)+650)};
}

/** Deterministic checks beyond compileScene's per-node bounds: cross-node overlap, safe
 *  region containment, and final-event timing. Throws (never repairs itself) so callers
 *  can feed the message into the existing planner repair-retry loop. */
export function preflightScene(scene:CompiledScene):CompiledScene {
  for (const n of scene.nodes) {
    if (n.x < 0 || n.y < SAFE_TOP || n.x + n.w > WIDTH || n.y + n.h > SAFE_BOTTOM) fail(`Node ${n.id} falls outside the safe drawing region`);
    if (n.fontSize < 14) fail(`Node ${n.id} label font size below the minimum`);
  }
  for (let i = 0; i < scene.nodes.length; i++) for (let j = i + 1; j < scene.nodes.length; j++) {
    const a = scene.nodes[i], b = scene.nodes[j];
    const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    if (!disjoint) fail(`Nodes ${a.id} and ${b.id} overlap`);
  }
  const finalEventEnd = Math.max(...scene.nodes.map(n=>n.startMs+n.drawMs), ...scene.edges.map(e=>e.startMs+e.drawMs));
  if (finalEventEnd > scene.durationMs) fail('Final visual event falls outside the scene duration');
  return scene;
}
export const progressAt = (t:number,start:number,duration:number) => Math.max(0,Math.min(1,(t-start)/duration));
export function sceneState(scene:CompiledScene,timeMs:number) {
  const t=Math.max(0,Math.min(timeMs,scene.durationMs));
  return {title:scene.title,note:scene.note,
    nodes:scene.nodes.map(n=>({...n,progress:progressAt(t,n.startMs,n.drawMs)})),
    edges:scene.edges.map(e=>({...e,progress:progressAt(t,e.startMs,e.drawMs)})),
    activeWord:scene.timing.words.findIndex(w=>t>=w.startMs&&t<w.endMs)};
}
export function locateScene(scenes:CompiledScene[],timeMs:number) {
  let offset=0;
  for(let i=0;i<scenes.length;i++) {
    if(timeMs<offset+scenes[i].durationMs || i===scenes.length-1) return {scene:scenes[i],index:i,offsetMs:offset,localMs:Math.min(scenes[i].durationMs,Math.max(0,timeMs-offset))};
    offset+=scenes[i].durationMs;
  }
  return null;
}
export const durationOf = (scenes:{durationMs:number}[]) => scenes.reduce((n,s)=>n+s.durationMs,0);

/** Clamp to prepared media; the clock must never run into absent content. */
export function advancePlayback(timeMs:number,deltaMs:number,availableMs:number,complete:boolean) {
  const next=Math.min(availableMs,Math.max(0,timeMs+deltaMs));
  return {timeMs:next,buffering:!complete&&next>=availableMs,ended:complete&&next>=availableMs};
}

const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]||c));
/** SVG is also the offline rasterizer input. No browser wall-clock capture. */
/** Point + heading at fraction t along a rectangle's perimeter, walking clockwise from the
 *  top-left corner. Ignores corner rounding (the pencil is a small decorative element; exact
 *  fidelity there isn't worth the complexity) but matches the box stroke-reveal's own
 *  `2*(w+h)` total length, so the two stay visually in sync. */
function pointOnRectPerimeter(x:number,y:number,w:number,h:number,t:number) {
  const total=2*(w+h);
  let d=Math.max(0,Math.min(1,t))*total;
  if(d<=w)return {x:x+d,y,angle:0};
  d-=w;
  if(d<=h)return {x:x+w,y:y+d,angle:Math.PI/2};
  d-=h;
  if(d<=w)return {x:x+w-d,y:y+h,angle:Math.PI};
  d-=w;
  return {x,y:y+h-d,angle:-Math.PI/2};
}
/** Point + heading at fraction t around an ellipse (decorative pencil walk; exact
 *  arc-length parametrization is overkill — angle order is what the eye follows). */
function pointOnEllipsePerimeter(cx:number,cy:number,rx:number,ry:number,t:number) {
  const a=Math.max(0,Math.min(1,t))*Math.PI*2-Math.PI/2;
  return {x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a),angle:Math.atan2(ry*Math.cos(a),-rx*Math.sin(a))};
}
/** Phase 9: emphasis wash as two slightly offset, slightly rotated translucent rects instead
 *  of one flat one — reads as an imperfect hand-drawn marker stroke rather than a CSS
 *  highlight. Same total ink (opacities chosen so the overlap doesn't read visibly darker). */
function renderHighlightRect(x:number,y:number,w:number,h:number,rx:number,opacity:number) {
  const cx=x+w/2,cy=y+h/2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#f2c94c" fill-opacity="${opacity*0.6}"/>`+
    `<rect x="${x+2}" y="${y-1.5}" width="${w-3}" height="${h}" rx="${rx}" fill="#f2c94c" fill-opacity="${opacity*0.45}" transform="rotate(-1.1 ${cx} ${cy})"/>`;
}
function renderHighlightEllipse(cx:number,cy:number,rx:number,ry:number,opacity:number) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#f2c94c" fill-opacity="${opacity*0.6}"/>`+
    `<ellipse cx="${cx+1.5}" cy="${cy-1}" rx="${rx*0.94}" ry="${ry*0.94}" fill="#f2c94c" fill-opacity="${opacity*0.45}"/>`;
}
/** A small pencil cursor whose tip sits exactly at (x,y), rotated to face the direction of
 *  travel. Renderer-only decoration: it never decides content, only follows already-resolved
 *  path/perimeter progress. */
function renderPencil(x:number,y:number,angle:number) {
  const deg=angle*180/Math.PI;
  return `<g transform="translate(${x} ${y}) rotate(${deg})" opacity="0.92"><path d="M -26 -3.2 L -7 -3.2 L 0 0 L -7 3.2 L -26 3.2 Z" fill="#f2c94c" stroke="#182d33" stroke-width="1.1" stroke-linejoin="round"/><line x1="-26" y1="-3.2" x2="-26" y2="3.2" stroke="#182d33" stroke-width="1.1"/><circle cx="0" cy="0" r="1.3" fill="#182d33"/></g>`;
}
export function renderSVG(scene:CompiledScene,timeMs:number) {
  const s=sceneState(scene,timeMs);
  const titleProgress=progressAt(timeMs,0,700);
  const transitionFade=timeMs<300?progressAt(timeMs,0,300):1;
  const texts=(lines:string[],x:number,y:number,size:number)=>lines.map((line,i)=>`<text x="${x}" y="${y+i*size*1.18}" text-anchor="middle" font-size="${size}">${esc(line)}</text>`).join('');
  const textsLeft=(lines:string[],x:number,y:number,size:number)=>lines.map((line,i)=>`<text x="${x}" y="${y+i*size*1.18}" text-anchor="start" font-size="${size}">${esc(line)}</text>`).join('');
  const captionStart=Math.max(0,s.activeWord-6);
  const caption=scene.timing.words.slice(captionStart,captionStart+14);
  // Phase 9: a faint dot-grid texture so the board reads as a physical whiteboard rather
  // than a flat fill (V2 §9/§11 "rich visuals... belong on one whiteboard"). Subtle enough
  // to never compete with content — a fixed pattern def, not re-generated per frame's data.
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><pattern id="board-grain" width="26" height="26" patternUnits="userSpaceOnUse"><rect x="0.2" y="0.2" width="1.6" height="1.6" rx="0.8" fill="#e7e1cf"/></pattern></defs><rect width="1280" height="720" fill="#fffef9"/><rect width="1280" height="720" fill="url(#board-grain)" opacity="0.55"/><g font-family="DejaVu Sans, sans-serif" fill="#182d33" opacity="${transitionFade}"><text x="60" y="49" font-size="14" letter-spacing="3">EXPLAIN / CANVAS LAB</text><g opacity="${titleProgress}">${texts(wrapText(s.title,1140,38),640,113,38)}</g>`;
  // Pencil follows whichever single node or edge is actively mid-stroke (0<progress<1); a
  // scene at rest (everything settled at 0 or 1) shows no pencil at all.
  let pencil:{x:number;y:number;angle:number}|null=null;
  for(const e of s.edges) {
    if(e.progress<=0)continue;
    // Phase 11: gentle quadratic-bezier routing instead of a dead-straight line (V2 §19
    // "support curved routing"). The control point bows perpendicular to the straight
    // connector, always toward -y ("up" on screen) for a consistent, deterministic hand-
    // drawn arc rather than a random wobble. This also fixes a live-verified bug: on a
    // short connector between close nodes, the label used to sit at the raw straight-line
    // midpoint and could render clipped behind the destination shape — the curve's bow
    // (plus a further outward nudge below) pushes the label clear of both endpoints.
    const dx=e.x2-e.x1,dy=e.y2-e.y1,dist=Math.hypot(dx,dy)||1;
    // Short connectors between close nodes need proportionally MORE bow, not less, to give
    // the label any clearance at all — a fixed floor was too flat for the tightest gaps.
    const bow=Math.max(16,Math.min(34,dist*0.3));
    let px=-dy/dist,py=dx/dist; if(py>0){px=-px;py=-py;} // pick the "-y" (upward) normal
    const midX=(e.x1+e.x2)/2,midY=(e.y1+e.y2)/2;
    const cx=midX+px*bow,cy=midY+py*bow;
    const bezierPoint=(t:number)=>{
      const mt=1-t;
      return {x:mt*mt*e.x1+2*mt*t*cx+t*t*e.x2,y:mt*mt*e.y1+2*mt*t*cy+t*t*e.y2};
    };
    const bezierTangentAngle=(t:number)=>{
      const mt=1-t;
      const tx=2*mt*(cx-e.x1)+2*t*(e.x2-cx),ty=2*mt*(cy-e.y1)+2*t*(e.y2-cy);
      return Math.atan2(ty,tx);
    };
    // Arc length via sampling — the curve is gentle (bow is small relative to dist) so a
    // coarse sample is already accurate enough for a dash-offset reveal.
    let arcLen=0,prev=bezierPoint(0);
    const SAMPLES=16;
    for(let k=1;k<=SAMPLES;k++){const pt=bezierPoint(k/SAMPLES);arcLen+=Math.hypot(pt.x-prev.x,pt.y-prev.y);prev=pt;}
    svg+=`<path d="M ${e.x1} ${e.y1} Q ${cx} ${cy} ${e.x2} ${e.y2}" fill="none" stroke="#3a5a52" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${arcLen}" stroke-dashoffset="${arcLen*(1-e.progress)}"/>`;
    const tip=bezierPoint(e.progress),angle=bezierTangentAngle(e.progress);
    if(e.progress===1) {const x=tip.x,y=tip.y;svg+=`<path d="M ${x-14*Math.cos(angle-.4)} ${y-14*Math.sin(angle-.4)} L ${x} ${y} L ${x-14*Math.cos(angle+.4)} ${y-14*Math.sin(angle+.4)}" fill="none" stroke="#3a5a52" stroke-width="3.2" stroke-linecap="round"/>`;}
    else if(!pencil)pencil={x:tip.x,y:tip.y,angle};
    // Named relationships read near the curve's own midpoint, nudged further outward along
    // the same bow direction so the label clears both the curve and the endpoint shapes.
    if(e.label&&e.progress>.7){const mid=bezierPoint(0.5);svg+=`<g opacity="${Math.min(1,(e.progress-.7)/.3)}"><text x="${mid.x+px*14}" y="${mid.y+py*14}" text-anchor="middle" font-size="14" paint-order="stroke" stroke="#fffef9" stroke-width="3">${esc(e.label)}</text></g>`;}
  }
  for(const n of s.nodes) {
    if(n.progress<=0)continue;
    const stroke=n.kind&&KIND_ACCENT[n.kind]||'#243a41';
    if(n.shape==='illustration') {
      const labelH=24;
      svg+=renderIllustration(n.kind,n.x,n.y,n.w,n.h-labelH,n.progress,stroke,n.color);
      if(n.progress>.55)svg+=`<g opacity="${Math.min(1,(n.progress-.55)/.45)}">${texts(n.lines,n.x+n.w/2,n.y+n.h-labelH+17,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='icon') {
      // A pasted icon beside its label — no box border or fill. Drawing grammar's "icon:
      // quick scale-in" mode (§20): the icon pops in with a brief scale+fade rather than the
      // box's slower stroke-dash reveal, then the label reads on immediately after.
      const r=iconRadius(n.h,!!n.emphasis);
      const cx=n.x+r+8,cy=n.y+n.h/2;
      const iconT=Math.min(1,n.progress/0.35);
      const scale=0.6+0.4*iconT;
      svg+=`<g opacity="${iconT}" transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">${renderIcon(n.kind,cx,cy,r,stroke)}</g>`;
      if(n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.5)}">${textsLeft(n.lines,n.x+r*2+22,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='annotation') {
      // Floating caption beside its target: small text, no container, quick fade.
      // No icon glyph — annotations explain, they don't symbolize.
      if(n.progress>.3)svg+=`<g opacity="${Math.min(1,(n.progress-.3)/.5)}" font-style="italic">${textsLeft(n.lines,n.x+6,n.y+20,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='circle'||n.shape==='square') {
      // Round or sharp-cornered containers drawn stroke-by-stroke like a box. Circles carry
      // no corner glyph (nothing to hang it on); squares keep it. Same drawMs as boxes.
      const cx=n.x+n.w/2,cy=n.y+n.h/2,rx=n.w/2,ry=n.h/2;
      const isC=n.shape==='circle';
      const perimeter=isC?Math.PI*(3*(rx+ry)-Math.sqrt((3*rx+ry)*(rx+3*ry))):2*(n.w+n.h);
      const strokeWidth=n.emphasis?STROKE_TOKENS.emphasis:STROKE_TOKENS.border;
      const open=isC?`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`:`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="0"`;
      svg+=`${open} fill="${n.color}" fill-opacity="${n.fillOpacity?Math.max(0,(n.progress-.35)/.65):0}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter*(1-n.progress)}"/>`;
      // Emphasis wash: marker-like highlight sweep behind the label for the result node.
      if(n.emphasis&&n.progress>.55)svg+=isC
        ?renderHighlightEllipse(cx,cy,rx*0.78,ry*0.42,0.4*Math.min(1,(n.progress-.55)/.45))
        :renderHighlightRect(n.x+10,n.y+n.h*0.3,n.w-20,n.h*0.4,8,0.4*Math.min(1,(n.progress-.55)/.45));
      if(!isC&&n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.3)}">${renderIcon(n.kind,n.x+22,n.y+22,15,stroke)}</g>`;
      if(n.progress>.45)svg+=`<g opacity="${(n.progress-.45)/.55}">${texts(n.lines,n.x+n.w/2,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=isC?pointOnEllipsePerimeter(cx,cy,rx,ry,n.progress):pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='bullet') {
      // Key-point list, no container: fast fade-in of left-aligned bulleted lines.
      if(n.progress>.25)svg+=`<g opacity="${Math.min(1,(n.progress-.25)/.5)}">${textsLeft(n.lines,n.x+8,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='number') {
      // Round count badge with the quantity rendered big; pops in like an icon.
      const r=Math.min(n.w,n.h)/2-4,cx=n.x+n.w/2,cy=n.y+n.h/2;
      const popT=Math.min(1,n.progress/0.35);
      const scale=0.6+0.4*popT;
      svg+=`<g opacity="${popT}" transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${n.color}" stroke="${stroke}" stroke-width="${n.emphasis?STROKE_TOKENS.emphasis:STROKE_TOKENS.border}"/></g>`;
      if(n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.5)}">${texts(n.lines,cx,cy-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnEllipsePerimeter(cx,cy,r,r,n.progress);
      continue;
    }
    const perimeter=2*(n.w+n.h);
    const strokeWidth=n.emphasis?STROKE_TOKENS.emphasis:STROKE_TOKENS.border;
    svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${n.color}" fill-opacity="${n.fillOpacity?Math.max(0,(n.progress-.35)/.65):0}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter*(1-n.progress)}"/>`;
    if(n.emphasis&&n.progress>.55)svg+=renderHighlightRect(n.x+10,n.y+n.h*0.3,n.w-20,n.h*0.4,8,0.4*Math.min(1,(n.progress-.55)/.45));
    if(n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.3)}">${renderIcon(n.kind,n.x+22,n.y+22,15,stroke)}</g>`;
    if(n.progress>.45)svg+=`<g opacity="${(n.progress-.45)/.55}">${texts(n.lines,n.x+n.w/2,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
    if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
  }
  if(pencil){
    const localEventEnd=Math.max(...scene.nodes.map(n=>n.startMs+n.drawMs),...scene.edges.map(e=>e.startMs+e.drawMs));
    const pencilFade=progressAt(timeMs,Math.max(0,localEventEnd-400),400);
    svg+=`<g opacity="${0.6+0.4*pencilFade}">${renderPencil(pencil.x,pencil.y,pencil.angle)}</g>`;
  }
  svg+=`<g opacity="${titleProgress}"><rect x="70" y="640" width="1140" height="58" rx="8" fill="#f4f1e6" stroke="#d8d2c0"/><text x="90" y="676" font-size="22" xml:space="preserve">`;
  caption.forEach((word,i)=>{const spoken=captionStart+i===s.activeWord;svg+=`<tspan fill="${spoken?'#1a4d3a':'#2b3d38'}" font-weight="${spoken?'700':'400'}">${esc(word.word)} </tspan>`;});
  svg+='</text></g>';
  return svg+'</g></svg>';
}

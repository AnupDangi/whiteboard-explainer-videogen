import type {Plan,Scene,Timing,CompiledScene,CompiledNode,CompiledEdge} from '../types/engine.js';
import {NODE_KINDS,LAYOUTS} from '../domain/vocabulary.js';
import {NODE_SHAPES,SCENE_TEMPLATES} from '../domain/registry.js';
import {renderIcon,hasIcon} from '../domain/icons.js';
import {renderIllustration,hasIllustration} from '../domain/illustrations.js';
import {renderTemplate} from '../domain/templates.js';
import {KIND_ACCENT,STROKE as STROKE_TOKENS,SEMANTIC_COLORS} from '../domain/style.js';
import {segmentWords} from '../core/language.js';
/** Pure, browser-compatible scene compiler. No generated code is evaluated. */
const WIDTH = 1280;
const HEIGHT = 720;
// Canvas safe regions: no layout may place content above SAFE_TOP (title band) or below
// SAFE_BOTTOM (buffer above the subtitle bar, which starts at y=640).
const SAFE_TOP = 150;
const SAFE_BOTTOM = 600;
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
    // V3-2 beats (optional): exact ordered partition of the narration. Old plans
    // without beats still validate — anchor resolution falls back to global search.
    const normSpace=(t:string)=>t.replace(/\s+/g,' ').trim();
    let beatIds:Set<string>|null=null;
    if (scene.beats !== undefined) {
      if (!Array.isArray(scene.beats) || scene.beats.length < 2 || scene.beats.length > 4) fail('Expected 2–4 beats');
      beatIds = new Set();
      for (const b of scene.beats) {
        if (!b || typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(b.id) || beatIds.has(b.id)) fail('Invalid or duplicate beat id');
        beatIds.add(b.id);
        string(b.narration, 600, 'beat narration');
      }
      if (scene.beats.map(b=>normSpace(b.narration)).join(' ') !== normSpace(scene.narration)) fail('Beats must partition the scene narration exactly, in order');
    }
    if (!Array.isArray(scene.nodes) || scene.nodes.length < 2 || scene.nodes.length > 6) fail('Expected 2–6 nodes');
    const nodeIds = new Set();
    const words = scene.narration.trim().split(/\s+/);
    for (const node of scene.nodes) {
      string(node.id, 40, 'node id'); string(node.label, node.shape==='bullet'?160:node.shape==='annotation'?80:node.shape==='equation'?900:64, 'node label');
      if (!/^[a-zA-Z0-9_-]+$/.test(node.id) || nodeIds.has(node.id)) fail('Invalid or duplicate node id');
      nodeIds.add(node.id);
      if (!Number.isInteger(node.wordIndex) || node.wordIndex < 0 || node.wordIndex >= words.length) fail('wordIndex outside narration');
      // kind is optional here (older fixtures predate it); the LLM-facing schema requires it.
      if (node.kind !== undefined && !(NODE_KINDS as readonly string[]).includes(node.kind)) fail('Unknown node kind');
      if (node.emphasis !== undefined && typeof node.emphasis !== 'boolean') fail('Invalid emphasis flag');
      if (node.shape !== undefined && !(NODE_SHAPES as readonly string[]).includes(node.shape)) fail('Invalid node shape');
      if (node.shape === 'illustration' && !hasIllustration(node.kind)) fail(`Illustration shape requires a kind with a reusable illustration (node ${node.id})`);
      if (node.shape === 'icon' && !hasIcon(node.kind)) fail(`Icon shape requires a kind with an icon (node ${node.id})`);
      if (node.shape === 'image' && (typeof node.imageData !== 'string' || !node.imageData.startsWith('data:image/'))) fail(`Image shape requires imageData (a data URI) (node ${node.id})`);
      if (node.shape === 'equation' && (!Array.isArray(node.equationSteps)||node.equationSteps.length<1||node.equationSteps.length>12||!node.equationSteps.every(step=>typeof step==='string'&&step.trim().length>0&&step.length<=900))) fail(`Equation shape requires 1–12 readable equation steps (node ${node.id})`);
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
      if (node.visualIntent !== undefined && (typeof node.visualIntent !== 'string' || !node.visualIntent.trim() || node.visualIntent.length > 120)) fail(`Invalid visualIntent (node ${node.id}): 1-120 chars`);
      // beatId pins the node to one beat (anchors resolve inside it); conceptId is
      // the cross-scene identity (same conceptId = same thing, every scene).
      if (node.beatId !== undefined && (typeof node.beatId !== 'string' || !(beatIds as Set<string> | null)?.has(node.beatId))) fail(`Node ${node.id} references an unknown beat`);
      if (node.conceptId !== undefined && (typeof node.conceptId !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(node.conceptId))) fail(`Invalid conceptId (node ${node.id})`);
      // LD6: provenance ids ride on the node for grounding evaluation (1-4 chunk refs).
      if (node.evidenceIds !== undefined && (!Array.isArray(node.evidenceIds) || node.evidenceIds.length < 1 || node.evidenceIds.length > 4 || !node.evidenceIds.every(id => typeof id === 'string' && /^p\d+:c\d+$/.test(id)))) fail(`Invalid evidenceIds (node ${node.id}): expected 1-4 chunk ids like "p3:c2"`);
    }
    // V3-4 domain template (optional): the canonical composition replaces ad-hoc boxes.
    if (scene.template !== undefined && !(SCENE_TEMPLATES as readonly string[]).includes(scene.template as string)) fail('Unknown scene template');
    if (!Array.isArray(scene.edges) || scene.edges.length > 10) fail('Invalid edges');
    for (const e of scene.edges) if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) fail('Dangling or self connector');
    for (const e of scene.edges) if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 24)) fail('Invalid edge label');
    if (scene.note !== undefined && scene.note !== null && String(scene.note).trim() !== '') string(String(scene.note), 170, 'note');
  }
  // Whitelist all data crossing into the renderer; discard unknown provider fields.
  return {version: 1, title: input.title, scenes: input.scenes.map(s => ({
    id: s.id, title: s.title, narration: s.narration, layout: s.layout,
    ...(s.template?{template:s.template as Scene['template']}:{}),
    nodes: s.nodes.map(n => ({id:n.id,label:n.label,wordIndex:n.wordIndex,...(n.kind&&n.kind!=='generic'?{kind:n.kind}:{}),...(n.emphasis?{emphasis:true}:{}),...(n.shape&&n.shape!=='box'?{shape:n.shape}:{}),...(n.shape==='equation'&&Array.isArray(n.equationSteps)?{equationSteps:[...n.equationSteps]}:{}),...(n.shape==='image'&&typeof n.imageData==='string'?{imageData:n.imageData}:{}),...(typeof n.keyPoint==='string'&&n.keyPoint?{keyPoint:n.keyPoint}:{}),...(typeof n.visualIntent==='string'&&n.visualIntent?{visualIntent:n.visualIntent}:{}),...(typeof (n as {beatId?:unknown}).beatId==='string'?{beatId:n.beatId}:{}),...(typeof (n as {conceptId?:unknown}).conceptId==='string'?{conceptId:n.conceptId}:{}),...(Array.isArray((n as {evidenceIds?:unknown}).evidenceIds)?{evidenceIds:(n as {evidenceIds:string[]}).evidenceIds}:{}),...(n.shape==='annotation'?{attachTo:n.attachTo,position:n.position}:{})})),
    ...(s.beats?{beats:s.beats.map(b=>({id:b.id,narration:b.narration}))}:{}),
    edges:s.edges.map(e=>({from:e.from,to:e.to,...(typeof e.label==='string'&&e.label?{label:e.label}:{})})), note:s.note || ''
  }))};
}

/** Uniform timing is explicitly an estimate, never forced alignment. */
export function estimateTiming(text:string, wordsPerMinute = 145) {
  const words = segmentWords(text);
  if(!words.length)throw new Error('Cannot estimate timing for empty narration');
  const ms = 60000 / wordsPerMinute;
  return {kind:'estimated', words:words.map((word,i)=>({word,startMs: i*ms,endMs:(i+1)*ms})), durationMs:words.length*ms};
}

// Phase 11: per-glyph width ratios (of font size), sourced from the standard published
// Helvetica AFM advance widths (Adobe's font metrics, /1000 em units — widely-documented,
// stable reference data, not a synthesized estimate). DejaVu Sans isn't byte-identical to
// Helvetica, but this table's per-character granularity is materially closer than the prior
// 5-bucket category heuristic (narrow/wide/upper/digit/default), while staying fully
// synchronous and dependency-free — real glyph-accurate measurement (opentype.js in Node +
// canvas measureText in the browser, kept in sync) needs `compileScene` to become async
// (it's called synchronously from the browser's live renderer, the export CLI, and every
// test), which is a bigger architectural change than this table's accuracy gain justifies
// right now. Falls back to the old category heuristic for anything not in the table —
// accented Latin, Devanagari, CJK, etc. (non-Latin shaping remains a known gap).
const HELVETICA_WIDTHS: Record<string,number> = {
  ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
  '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
  ':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,
  A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
  '[':278,'\\':278,']':278,'^':469,_:556,'`':333,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,
  '{':334,'|':260,'}':334,'~':584,
};
const NARROW_CHARS = new Set('iIlj.,;:\'`|!ft-'.split(''));
const WIDE_CHARS = new Set('mwMW@%'.split(''));
function charWidthRatio(ch:string):number {
  const tabled = HELVETICA_WIDTHS[ch];
  if (tabled !== undefined) return tabled / 1000;
  if (NARROW_CHARS.has(ch)) return 0.32;
  if (WIDE_CHARS.has(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.5;
}
function measureText(text:string, fontSize:number):number {
  let total = 0; for (const ch of text) total += charWidthRatio(ch);
  return total * fontSize;
}
function wrapText(text:string, maxWidth:number, fontSize:number, measure = measureText) {
  // Over-wide words split at hyphens first (hyphen kept at line end); raw
  // character-splitting applies only to a segment that alone still exceeds
  // maxWidth — so "one-million-token" breaks at hyphens, never "tok|en".
  const splitLongWord=(word:string):string[]=>{
    // Break at natural separators (hyphen, slash, underscore) before ever cutting a
    // word mid-token — live SVGs showed "recurrence/conv|olution" and "parameter|s".
    const chunks=word.match(/[^-\s/_]+[-/_]?/g)??[word];
    const out:string[]=[];let cur='';
    const pushChars=(s:string)=>{let part='';for(const c of s){if(measure(part+c,fontSize)>maxWidth&&part){out.push(part);part='';}part+=c;}if(part)out.push(part);};
    for(const ch of chunks){
      if(measure(ch,fontSize)>maxWidth){if(cur){out.push(cur);cur='';}pushChars(ch);continue;}
      if(cur&&measure(cur+ch,fontSize)>maxWidth){out.push(cur);cur='';}
      cur+=ch;
    }
    if(cur)out.push(cur);
    return out;
  };
  const words = text.split(/\s+/).flatMap(w=>measure(w,fontSize)>maxWidth?splitLongWord(w):[w]); const lines=[]; let line='';
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
    // Image shape: a real (content-addressed) source figure drawn as a bitmap with the
    // same bottom caption strip as an illustration. Data URI only — no network in render.
    const isImage=node.shape==='image';
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
    const isEquation=node.shape==='equation';
    // Annotations reuse their placed caption box: same formula as placement (w-12 at 16px)
    // so the wrapped lines always match the reserved rect.
    const isAnnotation=node.shape==='annotation';
    let fontSize=isIllustration||isImage?16:isAnnotation?16:isEquation?24:isNumber?(h<70?20:28):(h<70?20:25);
    const maxWidth=isIllustration||isImage?w-24:isAnnotation?w-12:isIcon?w-iconReserve-16:isBullet?w-bulletReserve-16:isNumber?(Math.min(w,h)-8)*0.9:w-36;
    let lines=isBullet
      ?(()=>{const points=node.label.split(/\s*[|•]\s*|\.\s+/).map(s=>s.trim()).filter(Boolean);
        if(points.length>5)fail(`Too many bullet points ${node.id}`);
        return points.flatMap(p=>{const wrapped=wrapText(p,Math.max(40,maxWidth-18),fontSize);return ['• '+wrapped[0],...wrapped.slice(1)];});})()
      :wrapText(node.label,maxWidth,fontSize);
    const labelBudget=isIllustration||isImage?24:isNumber?h*0.7:h-12;
    // Phase 8: shrink type to fit before failing — a slot with little vertical room left
    // (e.g. a radial layout's satellite row) may still not have enough height even after
    // textExpand's growth, and a real label must show rather than blow up the whole scene.
    // Illustrations/annotations keep their fixed caption size; every other shape shrinks
    // down to the preflight-enforced 14px floor. Bullet re-splits its points at each size
    // since the point count itself is size-independent but wrapping per point is not.
    if(!isIllustration&&!isAnnotation&&!isImage&&!isEquation)while(lines.length*fontSize*1.18>labelBudget&&fontSize>14){
      fontSize-=2;
      lines=isBullet
        ?(()=>{const points=node.label.split(/\s*[|•]\s*|\.\s+/).map(s=>s.trim()).filter(Boolean);
          return points.flatMap(p=>{const wrapped=wrapText(p,Math.max(40,maxWidth-18),fontSize);return ['• '+wrapped[0],...wrapped.slice(1)];});})()
        :wrapText(node.label,maxWidth,fontSize);
    }
    if(!isEquation&&lines.length*fontSize*1.18>labelBudget) fail(`Label overflows ${node.id}`);
    const anchor=timing.words[node.wordIndex];
    if(!anchor) fail(`Missing speech anchor ${node.wordIndex}`);
    const semanticColor=node.kind?SEMANTIC_COLORS[node.kind]:undefined; const baseColor=semanticColor||COLORS[i%COLORS.length]; const fillOpacity=node.shape==='icon'||node.shape==='annotation'||isImage?0:0.25; return {...node,x,y,w,h,fontSize,lines,color:baseColor,fillOpacity,startMs:Math.max(0,anchor.startMs-180),drawMs:isIllustration?1700:isImage?1200:isEquation?1500:900};
  });
  const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
  const edges=scene.edges.map(e=>{
    const a=byId[e.from],b=byId[e.to]; const dx=b.x-a.x,dy=b.y-a.y;
    let x1,y1,x2,y2;
    if(Math.abs(dx)>Math.abs(dy)) {
      x1=a.x+(dx>0?a.w:0);y1=a.y+a.h/2;x2=b.x+(dx>0?0:b.w);y2=b.y+b.h/2;
    } else {x1=a.x+a.w/2;y1=a.y+(dy>0?a.h:0);x2=b.x+b.w/2;y2=b.y+(dy>0?0:b.h);}
    // V3-3 container-endpoint rule: icons have no box — anchor the connector to the
    // glyph circle's edge, not the invisible layout rect, so arrows never float in
    // empty space beside an icon.
    const edgeR=(n:typeof a)=>iconRadius(n.h,!!n.emphasis);
    if(Math.abs(dx)>Math.abs(dy)){
      if(a.shape==='icon'){const cx=a.x+edgeR(a)+8;x1=dx>0?cx+edgeR(a):cx-edgeR(a);}
      if(b.shape==='icon'){const cx=b.x+edgeR(b)+8;x2=dx>0?cx-edgeR(b):cx+edgeR(b);}
    } else {
      if(a.shape==='icon'){const cy=a.y+a.h/2;y1=dy>0?cy+edgeR(a):cy-edgeR(a);}
      if(b.shape==='icon'){const cy=b.y+b.h/2;y2=dy>0?cy-edgeR(b):cy+edgeR(b);}
    }
    return {...e,x1,y1,x2,y2,startMs:Math.max(a.startMs,b.startMs)+700,drawMs:650};
  });
  // O2 deterministic micro-beat pacing: LLM anchors cluster early, leaving multi-second
  // narrated silences with no canvas activity. Instead of asking the model for micro-
  // timing, the engine stretches each draw into the following slack (up to a bounded
  // cap, never into the next anchor, never past the last word) — the pencil keeps
  // stroking while narration continues, which is what a real whiteboard artist does.
  // Deterministic: pure function of the compiled timings.
  const lastWordEnd=timing.words.at(-1)?.endMs??timing.durationMs;
  const anchors=[...nodes.map(n=>n.startMs)].sort((a,b)=>a-b);
  for(let i=0;i<nodes.length;i++){
    const nextAnchor=anchors.find(t=>t>nodes[i].startMs+nodes[i].drawMs)??lastWordEnd;
    const slack=nextAnchor-(nodes[i].startMs+nodes[i].drawMs);
    // leave only ~2.6s of true silence; cap the stretch at +7s so a stroke never
    // outlives plausibility (the content validator bounds anchor gaps at ~45%).
    if(slack>2600)nodes[i].drawMs=Math.min(nodes[i].drawMs+slack-2600,nodes[i].drawMs+7000);
  }
  for(const e of edges){
    const a=byId[e.from],b=byId[e.to];
    const end=Math.max(a.startMs+a.drawMs,b.startMs+b.drawMs)+700;
    const nextAnchor=anchors.find(t=>t>end+e.drawMs)??lastWordEnd;
    const slack=nextAnchor-(end+e.drawMs);
    if(slack>2600)e.drawMs=Math.min(e.drawMs+slack-2600,e.drawMs+5400);
  }
  const eventEnd=Math.max(...nodes.map(n=>n.startMs+n.drawMs),...edges.map(e=>e.startMs+e.drawMs));
  return {...scene,nodes,edges,timing,audioUrl:undefined as string|undefined,durationMs:Math.ceil(Math.max(timing.durationMs,eventEnd)+650)};
}

const progressAt = (t:number,start:number,duration:number) => Math.max(0,Math.min(1,(t-start)/duration));
export function sceneState(scene:CompiledScene,timeMs:number) {
  const t=Math.max(0,Math.min(timeMs,scene.durationMs));
  return {title:scene.title,note:scene.note,
    nodes:scene.nodes.map(n=>({...n,progress:progressAt(t,n.startMs,n.drawMs)})),
    edges:scene.edges.map(e=>({...e,progress:progressAt(t,e.startMs,e.drawMs)})),
    activeWord:scene.timing.words.findIndex(w=>t>=w.startMs&&t<w.endMs)};
}
/** Index of the last word that has finished speaking at or before `timeMs`, or -1 when we are
 *  still before the first word ends. Companion to `sceneState().activeWord` (which is -1 in
 *  every gap): this is the search the caption "hold" state needs, since there is no active
 *  index to count back from while the narration is between words. */
function lastCompletedWordIndex(words:{endMs:number}[],timeMs:number) {
  let index=-1;
  for(let i=0;i<words.length;i++) if(words[i].endMs<=timeMs) index=i;
  return index;
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
const mathText=(value:string)=>value.replace(/\\rho\b/g,'ρ').replace(/\\mu\b/g,'μ').replace(/\\nu\b/g,'ν').replace(/\\partial\b/g,'∂').replace(/\\nabla\b/g,'∇').replace(/\\cdot\b/g,'·').replace(/[{}]/g,'');
// V3-3 sketch style (EXPLAIN_SKETCH=1): hand-drawn marker look — wobbly double-stroke
// containers plus hachure fill — rendered as plain SVG paths so browser and export share
// the exact same bytes. Seeded per-node PRNG: same node id always yields the same wobble.
const sketchMode=()=>process.env.EXPLAIN_SKETCH==='1';
const hash32=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
const mulberry32=(seed:number)=>()=>{let t=seed+0x6D2B79F5|0;seed=seed+0x9E3779B9|0;t=Math.imul(t^t>>>15,1|t);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
/** Sample points along a rounded-rect perimeter (clockwise from top-left), corners as
 *  quarter-arc approximations — the input to the jittered sketch stroke. */
const rectPerimeterPoints=(x:number,y:number,w:number,h:number,r:number):Array<[number,number]>=>{
  const pts:Array<[number,number]>=[];
  const corner=(cx:number,cy:number,startAngle:number)=>{for(let k=0;k<=2;k++){const a=startAngle+k*(Math.PI/2)/2;pts.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}};
  const step=(x1:number,y1:number,x2:number,y2:number)=>{const len=Math.hypot(x2-x1,y2-y1),n=Math.max(1,Math.round(len/26));for(let k=0;k<n;k++)pts.push([x1+(x2-x1)*k/n,y1+(y2-y1)*k/n]);};
  corner(x+r,y+r,Math.PI);step(x+r,y,x+w-r,y);corner(x+w-r,y+r,-Math.PI/2);step(x+w,y+r,x+w,y+h-r);corner(x+w-r,y+h-r,0);step(x+w-r,y+h,x+r,y+h);corner(x+r,y+h-r,Math.PI/2);step(x,y+h-r,x,y+r);
  return pts;
};
/** One wobbly closed polyline through the perimeter points (pass seed varies the wobble). */
const sketchStrokePath=(pts:Array<[number,number]>,seed:number)=>{
  const rnd=mulberry32(seed);const norm=(x1:number,y1:number,x2:number,y2:number)=>{const l=Math.hypot(x2-x1,y2-y1)||1;return[(y2-y1)/l,-(x2-x1)/l] as const;};
  let d='';for(let i=0;i<pts.length;i++){const [x,y]=pts[i];const [px,py]=pts[(i+1)%pts.length];const [nx,ny]=norm(x,y,px,py);const j=(rnd()-0.5)*3.2;const ox=x+nx*j,oy=y+ny*j;d+=(i?'L':'M')+ox.toFixed(1)+' '+oy.toFixed(1)+' ';}
  return d+'Z';
};
/** Hachure (diagonal marker-hatch) fill lines clipped to a rect. 45°, gap 9. */
const hachureLines=(x:number,y:number,w:number,h:number,seed:number)=>{
  const rnd=mulberry32(seed);const out:Array<[number,number,number,number]>=[];
  for(let o=-h;o<=w;o+=9){
    let s0=Math.max(0,-o),s1=Math.min(h,w-o);
    if(s1<=s0)continue;
    const j=()=> (rnd()-0.5)*2;
    out.push([x+o+s0+j(),y+h-s0+j(),x+o+s1+j(),y+h-s1+j()]);
  }
  return out;
};
/** V3-3 obstacle-avoiding connector routing: quadratic control point for an edge.
 *  Tries the default upward bow, then the mirrored bow, then increasing magnitudes,
 *  and returns the first candidate whose sampled curve clears every obstacle rect
 *  (endpoints excluded by the caller). Deterministic; falls back to the base bow. */
function routeEdge(e:{x1:number;y1:number;x2:number;y2:number},obstacles:Array<{x:number;y:number;w:number;h:number}>):{cx:number;cy:number;px:number;py:number;bow:number}{
  const dx=e.x2-e.x1,dy=e.y2-e.y1,dist=Math.hypot(dx,dy)||1;
  const bow=Math.max(16,Math.min(34,dist*0.3));
  let px=-dy/dist,py=dx/dist; if(py>0){px=-px;py=-py;}
  const clear=(cx:number,cy:number)=>{
    for(let k=0;k<=12;k++){const t=k/12,mt=1-t;const x=mt*mt*e.x1+2*mt*t*cx+t*t*e.x2,y=mt*mt*e.y1+2*mt*t*cy+t*t*e.y2;
      for(const o of obstacles)if(x>o.x-8&&x<o.x+o.w+8&&y>o.y-8&&y<o.y+o.h+8)return false;}
    return true;
  };
  const midX=(e.x1+e.x2)/2,midY=(e.y1+e.y2)/2;
  for(const mult of [1,2,3.2]){
    const cx=midX+px*bow*mult,cy=midY+py*bow*mult;
    if(clear(cx,cy))return {cx,cy,px,py,bow:bow*mult};
    const mx=midX-px*bow*mult,my=midY-py*bow*mult;
    if(clear(mx,my))return {cx:mx,cy:my,px:-px,py:-py,bow:bow*mult};
  }
  return {cx:midX+px*bow,cy:midY+py*bow,px,py,bow};
}
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
interface RenderOptions { captions?: boolean }
export function renderSVG(scene:CompiledScene,timeMs:number,options:RenderOptions={}) {
  const s=sceneState(scene,timeMs);
  const titleProgress=progressAt(timeMs,0,700);
  const transitionFade=timeMs<300?progressAt(timeMs,0,300):1;
  const texts=(lines:string[],x:number,y:number,size:number)=>lines.map((line,i)=>`<text x="${x}" y="${y+i*size*1.18}" text-anchor="middle" font-size="${size}">${esc(line)}</text>`).join('');
  const textsLeft=(lines:string[],x:number,y:number,size:number)=>lines.map((line,i)=>`<text x="${x}" y="${y+i*size*1.18}" text-anchor="start" font-size="${size}">${esc(line)}</text>`).join('');
  // A2: Caption gap/tail state — opening words must not reappear outside word intervals.
  // activeWord is -1 when t is outside all word [startMs, endMs) intervals.
  // Short gap: hold the current visible phrase; long gap (past last word): hide caption.
  // At most two measured lines; deterministic seek (no layout shift on time skip).
  let captionText: string[]=[];
  const captionMs = Math.max(0, Math.min(timeMs, scene.durationMs));
  if (options.captions !== false && s.activeWord >= 0) {
    // Within narration: show a measured trailing window, at most 14 words total,
    // split into a maximum of two lines for legibility at 640×360.
    const winStart = Math.max(0, s.activeWord - 6);
    const win = scene.timing.words.slice(winStart, winStart + 14).map(w=>w.word);
    // Phrase-wrap into at most two lines using the existing measureText utility.
    const firstLine = win.slice(0, 7).join(' ');
    const secondLine = win.slice(7).join(' ');
    captionText = [firstLine, secondLine].filter(l=>l.trim().length > 0);
  } else if (options.captions !== false) {
    // Outside word intervals: if we are after the last word end, hide caption entirely;
    // otherwise (before first word or in an inter-word gap) hold the last visible phrase
    // by showing the final completed phrase from the nearest preceding word, if any.
    const lastWord = scene.timing.words[scene.timing.words.length - 1];
    if (lastWord && captionMs >= lastWord.endMs) {
      // Long gap after narration: hide caption.
      captionText = [];
    } else {
      // Short gap / before first word: hold the phrase ending at the last completed word.
      // `s.activeWord` is -1 for the whole of this branch (that is the precondition for
      // being here), so the held window is located by searching the word list directly.
      const heldIndex = lastCompletedWordIndex(scene.timing.words, captionMs);
      if (heldIndex >= 0) {
        const startIdx = Math.max(0, heldIndex - 6);
        const held = scene.timing.words.slice(startIdx, heldIndex + 1).map(w=>w.word);
        captionText = [held.join(' ')];
      } else {
        captionText = [];
      }
    }
  }
  // Phase 9: a faint dot-grid texture so the board reads as a physical whiteboard rather
  // than a flat fill (V2 §9/§11 "rich visuals... belong on one whiteboard"). Subtle enough
  // to never compete with content — a fixed pattern def, not re-generated per frame's data.
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><pattern id="board-grain" width="26" height="26" patternUnits="userSpaceOnUse"><rect x="0.2" y="0.2" width="1.6" height="1.6" rx="0.8" fill="#e7e1cf"/></pattern></defs><rect width="1280" height="720" fill="#fffef9"/><rect width="1280" height="720" fill="url(#board-grain)" opacity="0.55"/><g font-family="DejaVu Sans, sans-serif" fill="#182d33" opacity="${transitionFade}"><text x="60" y="49" font-size="14" letter-spacing="3">EXPLAIN / CANVAS LAB</text><g opacity="${titleProgress}">${texts(wrapText(s.title,1140,38),640,113,38)}</g>`;
  // These grammars own the full teaching surface. Their semantic cards, arrows, and
  // labels are rendered by the template; drawing the two compatibility nodes on top
  // would duplicate text and create the overlap that sparse fallback scenes used to
  // ship. Nodes remain in the compiled scene for timing, provenance, and linting.
  const templateOwnsSurface=scene.template==='sleep_perception'||scene.template==='trust_path'||scene.template==='scam_funnel';
  // Pencil follows whichever single node or edge is actively mid-stroke (0<progress<1); a
  // scene at rest (everything settled at 0 or 1) shows no pencil at all.
  let pencil:{x:number;y:number;angle:number}|null=null;

  const edgeLabels:string[]=[];
  for(const e of s.edges) {
    if(templateOwnsSurface)continue;
    if(e.progress<=0)continue;

    const obstacles=s.nodes.filter(n=>n.id!==e.from&&n.id!==e.to).map(n=>({x:n.x,y:n.y,w:n.w,h:n.h}));
    const {cx,cy,px,py}=routeEdge(e,obstacles);
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

    if(e.label&&e.progress>.7){const mid=bezierPoint(0.5);edgeLabels.push(`<g opacity="${Math.min(1,(e.progress-.7)/.3)}"><text x="${mid.x+px*14}" y="${mid.y+py*14}" text-anchor="middle" font-size="14" paint-order="stroke" stroke="#fffef9" stroke-width="3">${esc(e.label)}</text></g>`);}
  }
  for(const n of s.nodes) {
    if(templateOwnsSurface)continue;
    if(n.progress<=0)continue;
    const stroke=n.kind&&KIND_ACCENT[n.kind]||'#243a41';
    if(n.shape==='illustration') {
      const labelH=24;
      svg+=renderIllustration(n.kind,n.x,n.y,n.w,n.h-labelH,n.progress,stroke,n.color);
      if(n.progress>.55)svg+=`<g opacity="${Math.min(1,(n.progress-.55)/.45)}">${texts(n.lines,n.x+n.w/2,n.y+n.h-labelH+17,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='image') {
      // Real source figure (content-addressed PNG as a data URI): fade the bitmap in,
      // then write the caption below it. Deterministic and network-free.
      const labelH=24;
      const op=Math.min(1,n.progress/0.4);
      svg+=`<g opacity="${op}"><image x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h-labelH}" preserveAspectRatio="xMidYMid meet" href="${n.imageData}"/></g>`;
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
    if(n.shape==='equation') {
      const steps=(n.equationSteps&&n.equationSteps.length?n.equationSteps:[n.label]).map(mathText);
      const visible=Math.max(0,Math.min(steps.length,Math.ceil(n.progress*steps.length)));
      const lineHeight=Math.min(42,Math.max(28,n.fontSize*1.35));
      const top=n.y+n.h/2-(steps.length-1)*lineHeight/2;
      const perimeter=2*(n.w+n.h);
      svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="14" fill="${n.color}" fill-opacity="0.16" stroke="${stroke}" stroke-width="${n.emphasis?STROKE_TOKENS.emphasis:STROKE_TOKENS.border}" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter*(1-n.progress)}"/>`;
      svg+=`<g font-family="STIX Two Math, DejaVu Serif, serif" font-size="${n.fontSize}" fill="#182d33" opacity="${Math.min(1,n.progress/0.35)}">${steps.slice(0,visible).map((step,index)=>`<text x="${n.x+n.w/2}" y="${top+index*lineHeight}" text-anchor="middle">${esc(step)}</text>`).join('')}</g>`;
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
      const fillOp=n.fillOpacity??0.25;
      const open=isC?`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`:`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="0"`;
      svg+=`${open} fill="${n.color}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter*(1-n.progress)}"/>`;
      // Emphasis wash: marker-like highlight sweep behind the label for the result node.
      if(n.emphasis&&n.progress>.55)svg+=isC
        ?renderHighlightEllipse(cx,cy,rx*0.78,ry*0.42,0.4*Math.min(1,(n.progress-.55)/.45))
        :renderHighlightRect(n.x+10,n.y+n.h*0.3,n.w-20,n.h*0.4,8,0.4*Math.min(1,(n.progress-.55)/.45));
      // Equation/formula glyphs are deliberately omitted from text boxes: the
      // compact symbol is not a readable mathematical expression and can look
      // like “+=X” beside the real label. Equation plans use the box text as the
      // authoritative representation instead.
      if(!isC&&n.kind!=='equation'&&n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.3)}">${renderIcon(n.kind,n.x+22,n.y+22,15,stroke)}</g>`;
      if(n.progress>.45)svg+=`<g opacity="${(n.progress-.45)/.55}">${texts(n.lines,n.x+n.w/2,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
      if(!pencil&&n.progress<1)pencil=isC?pointOnEllipsePerimeter(cx,cy,rx,ry,n.progress):pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
      continue;
    }
    if(n.shape==='bullet') {
      // Key-point list, no container: each list item reveals in sequence across the
      // node's window, so the canvas writes the takeaways one by one as the narration
      // speaks them, instead of dumping the whole list at once.
      const items=n.lines.length;
      const baseY=n.y+n.h/2-(items-1)*n.fontSize*.59+n.fontSize*.35;
      for(let i=0;i<items;i++){
        const start=0.18+(items>1?(i/items)*0.5:0);
        const op=Math.max(0,Math.min(1,(n.progress-start)/0.28));
        if(op>0)svg+=`<g opacity="${op}">${textsLeft([n.lines[i]],n.x+8,baseY+i*n.fontSize*1.18,n.fontSize)}</g>`;
      }
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
    const fillOp=n.fillOpacity??0.25;
    if(sketchMode()){
      // V3-3 sketch container: flat fill + hachure hatch + wobbly double stroke that
      // reveals with the same dash-offset grammar as the clean style.
      svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${n.color}" fill-opacity="${fillOp}"/>`;
      const seed=hash32(n.id+n.label);
      for(const [hx1,hy1,hx2,hy2] of hachureLines(n.x+4,n.y+4,n.w-8,n.h-8,seed))svg+=`<line x1="${hx1.toFixed(1)}" y1="${hy1.toFixed(1)}" x2="${hx2.toFixed(1)}" y2="${hy2.toFixed(1)}" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round" opacity="0.45"/>`;
      const pts=rectPerimeterPoints(n.x,n.y,n.w,n.h,10);
      let passLen=0;for(let i=0;i<pts.length;i++){const [ax,ay]=pts[i];const [bx,by]=pts[(i+1)%pts.length];passLen+=Math.hypot(bx-ax,by-ay);}
      for(let pass=0;pass<2;pass++){
        const len=passLen*1.06;
        svg+=`<path d="${sketchStrokePath(pts,seed+pass*7919)}" fill="none" stroke="${stroke}" stroke-width="${pass?strokeWidth*0.7:strokeWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len*(1-n.progress)}"/>`;
      }
      // Hachure runs under the label — give the text a board-colored backdrop so it
      // stays legible over the hatch (clean style has flat fills and needs none).
      if(n.progress>.45){
        const tw=Math.max(...n.lines.map(l=>measureText(l,n.fontSize)))+20,th=n.lines.length*n.fontSize*1.18+10;
        svg+=`<rect x="${(n.x+n.w/2-tw/2).toFixed(1)}" y="${(n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35-th+n.fontSize*0.7).toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="6" fill="#fffef9" opacity="0.88"/>`;
      }
    } else {
      svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${n.color}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter*(1-n.progress)}"/>`;
    }
    if(n.emphasis&&n.progress>.55)svg+=renderHighlightRect(n.x+10,n.y+n.h*0.3,n.w-20,n.h*0.4,8,0.4*Math.min(1,(n.progress-.55)/.45));
    if(n.kind!=='equation'&&n.progress>.4)svg+=`<g opacity="${Math.min(1,(n.progress-.4)/.3)}">${renderIcon(n.kind,n.x+22,n.y+22,15,stroke)}</g>`;
    if(n.progress>.45)svg+=`<g opacity="${(n.progress-.45)/.55}">${texts(n.lines,n.x+n.w/2,n.y+n.h/2-(n.lines.length-1)*n.fontSize*.59+n.fontSize*.35,n.fontSize)}</g>`;
    if(!pencil&&n.progress<1)pencil=pointOnRectPerimeter(n.x,n.y,n.w,n.h,n.progress);
  }
  for(const l of edgeLabels)svg+=l;
  svg+=renderTemplate(scene,timeMs);
  if(pencil){
    const localEventEnd=Math.max(...scene.nodes.map(n=>n.startMs+n.drawMs),...scene.edges.map(e=>e.startMs+e.drawMs));
    const pencilFade=progressAt(timeMs,Math.max(0,localEventEnd-400),400);
    svg+=`<g opacity="${0.6+0.4*pencilFade}">${renderPencil(pencil.x,pencil.y,pencil.angle)}</g>`;
  }
  if(options.captions!==false){
    svg+=`<g opacity="${titleProgress}"><rect x="70" y="640" width="1140" height="58" rx="8" fill="#f4f1e6" stroke="#d8d2c0"/><text x="90" y="676" font-size="22" xml:space="preserve">`;
    const showSpoken = s.activeWord >= 0;
    captionText.forEach((line,i)=>{const spoken=showSpoken&&i===0;svg+=`<tspan fill="${spoken?'#1a4d3a':'#2b3d38'}" font-weight="${spoken?'700':'400'}" dy="${i===0?1.2:2.8}">${esc(line)} </tspan>`;});
    svg+='</text></g>';
  }
  return svg+'</g></svg>';
}

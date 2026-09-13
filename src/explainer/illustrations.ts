import type {NodeKind} from '../shared/vocabulary.js';
/** Rich, multi-part reusable illustrations (target doc §12/§20): unlike icons.ts's single
 *  small glyphs, each entry here is several strokes/fills drawn in ordered stages — major
 *  outline first, secondary detail, then fill — so the renderer actually draws a scene (e.g.
 *  a person) piece by piece rather than fading in one static box+icon. Coordinates are
 *  normalized to a 0-100 square; renderIllustration maps them into the node's box. */
type Pt = [number, number];
type Part =
  | {kind:'line'; p1:Pt; p2:Pt; stage:number; fill?:undefined}
  | {kind:'circle'; c:Pt; r:number; stage:number; fill?:boolean}
  | {kind:'polyline'; pts:Pt[]; closed?:boolean; stage:number; fill?:boolean}
  | {kind:'arc'; c:Pt; r:number; from:number; to:number; stage:number; fill?:undefined};

const L=(p1:Pt,p2:Pt,stage:number):Part=>({kind:'line',p1,p2,stage});
const C=(c:Pt,r:number,stage:number,fill?:boolean):Part=>({kind:'circle',c,r,stage,fill});
const PL=(pts:Pt[],stage:number,opts:{closed?:boolean;fill?:boolean}={}):Part=>({kind:'polyline',pts,stage,...opts});
const ARC=(c:Pt,r:number,from:number,to:number,stage:number):Part=>({kind:'arc',c,r,from,to,stage});

// Stage 0 = major outline, stage 1 = secondary detail, stage 2 = fill wash.
function personParts():Part[] {
  const torso:Pt[]=[[36,40],[64,40],[59,86],[41,86]];
  return [
    C([50,24],13,0),
    PL(torso,0,{closed:true}),
    L([36,46],[20,66],1),
    L([64,46],[80,66],1),
    C([45,23],1.4,1,true),
    C([55,23],1.4,1,true),
    ARC([50,28],5,20,160,1),
    PL(torso,2,{closed:true,fill:true}),
  ];
}
function teacherParts():Part[] {
  const book:Pt[]=[[12,58],[29,58],[29,71],[12,71]];
  return [...personParts(),
    PL(book,1,{closed:true}),
    L([20.5,58],[20.5,71],1),
    PL(book,2,{closed:true,fill:true}),
  ];
}
function studentParts():Part[] {
  const pack:Pt[]=[[63,47],[76,47],[76,75],[65,75]];
  return [...personParts(),
    PL(pack,1,{closed:true}),
    PL(pack,2,{closed:true,fill:true}),
  ];
}
function agentParts():Part[] {
  const head:Pt[]=[[32,20],[68,20],[68,44],[32,44]];
  const body:Pt[]=[[30,50],[70,50],[66,88],[34,88]];
  return [
    PL(head,0,{closed:true}),
    PL(body,0,{closed:true}),
    L([50,20],[50,10],1),
    C([50,8],2.4,1,true),
    C([42,30],2.6,1,true),
    C([58,30],2.6,1,true),
    L([30,58],[16,74],1),
    L([70,58],[84,74],1),
    PL(head,2,{closed:true,fill:true}),
    PL(body,2,{closed:true,fill:true}),
  ];
}
function serverParts():Part[] {
  const units:Pt[]=[[26,18],[26,42],[26,66]];
  const w=48,h=18;
  const unitPts=(x:number,y:number):Pt[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  const parts:Part[]=[];
  for(const [x,y] of units) parts.push(PL(unitPts(x,y),0,{closed:true}));
  for(const [x,y] of units) parts.push(C([x+42,y+9],2,1,true));
  for(const [x,y] of units) parts.push(L([x+6,y+9],[x+30,y+9],1));
  for(const [x,y] of units) parts.push(PL(unitPts(x,y),2,{closed:true,fill:true}));
  return parts;
}
function plantParts():Part[] {
  const pot:Pt[]=[[38,62],[62,62],[57,90],[43,90]];
  const leafL:Pt[]=[[50,50],[34,42],[30,28],[46,32]];
  const leafR:Pt[]=[[50,42],[66,34],[70,20],[54,24]];
  return [
    PL(pot,0,{closed:true}),
    L([50,62],[50,36],0),
    PL(leafL,1,{closed:true}),
    PL(leafR,1,{closed:true}),
    PL(pot,2,{closed:true,fill:true}),
    PL(leafL,2,{closed:true,fill:true}),
    PL(leafR,2,{closed:true,fill:true}),
  ];
}
function sunParts():Part[] {
  const parts:Part[]=[C([50,45],16,0)];
  for(let a=0;a<360;a+=45){
    const rad=a*Math.PI/180, r1=23, r2=31;
    parts.push(L([50+Math.cos(rad)*r1,45+Math.sin(rad)*r1],[50+Math.cos(rad)*r2,45+Math.sin(rad)*r2],1));
  }
  parts.push(C([50,45],16,2,true));
  return parts;
}
function browserParts():Part[] {
  const win:Pt[]=[[18,20],[82,20],[82,80],[18,80]];
  return [
    PL(win,0,{closed:true}),
    L([18,32],[82,32],0),
    C([26,26],2,1,true),
    C([34,26],2,1,true),
    C([42,26],2,1,true),
    L([26,48],[74,48],1),
    L([26,58],[60,58],1),
    PL(win,2,{closed:true,fill:true}),
  ];
}
function phoneParts():Part[] {
  const body:Pt[]=[[32,12],[68,12],[68,88],[32,88]];
  return [
    PL(body,0,{closed:true}),
    L([38,26],[62,26],1),
    L([38,64],[62,64],1),
    C([50,80],2.4,1,true),
    PL(body,2,{closed:true,fill:true}),
  ];
}
function robotParts():Part[] {
  const body:Pt[]=[[30,46],[70,46],[66,88],[34,88]];
  return [
    ARC([50,40],16,180,360,0),
    L([34,40],[34,46],0),
    L([66,40],[66,46],0),
    PL(body,0,{closed:true}),
    L([50,24],[50,12],1),
    C([50,10],2.2,1,true),
    C([43,32],2.6,1,true),
    C([57,32],2.6,1,true),
    L([30,58],[16,74],1),
    L([70,58],[84,74],1),
    PL(body,2,{closed:true,fill:true}),
  ];
}
function pipelineParts():Part[] {
  const box=(x:number):Pt[]=>[[x,35],[x+22,35],[x+22,65],[x,65]];
  const parts:Part[]=[];
  for(const x of [10,39,68]) parts.push(PL(box(x),0,{closed:true}));
  parts.push(L([32,50],[39,50],1));
  parts.push(L([61,50],[68,50],1));
  parts.push(C([21,50],2,1,true));
  parts.push(C([50,50],2,1,true));
  parts.push(C([79,50],2,1,true));
  for(const x of [10,39,68]) parts.push(PL(box(x),2,{closed:true,fill:true}));
  return parts;
}
function modelParts():Part[] {  const inputPts:Pt[]=[[22,26],[22,50],[22,74]];
  const hiddenPts:Pt[]=[[50,18],[50,38],[50,58],[50,78]];
  const outputPts:Pt[]=[[78,38],[78,58]];
  const all=[...inputPts,...hiddenPts,...outputPts];
  const parts:Part[]=[];
  for(const p of all) parts.push(C(p,4,0));
  for(const a of inputPts) for(const b of hiddenPts) parts.push(L(a,b,1));
  for(const a of hiddenPts) for(const b of outputPts) parts.push(L(a,b,1));
  for(const p of all) parts.push(C(p,4,2,true));
  return parts;
}

const ILLUSTRATIONS: Partial<Record<NodeKind, Part[]>> = {
  user: personParts(), teacher: teacherParts(), student: studentParts(),
  agent: agentParts(), server: serverParts(), model: modelParts(),
  plant: plantParts(), sun: sunParts(), browser: browserParts(),
  phone: phoneParts(), robot: robotParts(), pipeline: pipelineParts(),
};
export function hasIllustration(kind?:NodeKind):boolean { return !!(kind && ILLUSTRATIONS[kind]); }

function length(p:Part, X:(n:number)=>number, Y:(n:number)=>number):number {
  if (p.kind==='line') return Math.hypot(X(p.p2[0])-X(p.p1[0]), Y(p.p2[1])-Y(p.p1[1]));
  if (p.kind==='circle') return 2*Math.PI*Math.abs(X(p.c[0]+p.r)-X(p.c[0]));
  if (p.kind==='arc') return Math.abs(X(p.c[0]+p.r)-X(p.c[0]))*Math.abs(p.to-p.from)*Math.PI/180;
  const pts=p.pts.map(([x,y])=>[X(x),Y(y)] as Pt);
  let d=0; for(let i=1;i<pts.length;i++) d+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  if (p.closed) d+=Math.hypot(pts[0][0]-pts.at(-1)![0],pts[0][1]-pts.at(-1)![1]);
  return d;
}
function partSvg(p:Part, X:(n:number)=>number, Y:(n:number)=>number, local:number, stroke:string, fillColor:string):string {
  const w=2.6;
  if (p.fill) {
    const op=Math.max(0,Math.min(1,local));
    if (op<=0) return '';
    if (p.kind==='circle') return `<circle cx="${X(p.c[0])}" cy="${Y(p.c[1])}" r="${Math.abs(X(p.c[0]+p.r)-X(p.c[0]))}" fill="${fillColor}" fill-opacity="${op}"/>`;
    if (p.kind==='polyline') return `<path d="M ${p.pts.map(([x,y])=>`${X(x)} ${Y(y)}`).join(' L ')} Z" fill="${fillColor}" fill-opacity="${op*0.45}"/>`;
    return '';
  }
  const len=length(p,X,Y)||1;
  const clamped=Math.max(0,Math.min(1,local));
  if (clamped<=0) return '';
  const dash=`stroke-dasharray="${len}" stroke-dashoffset="${len*(1-clamped)}"`;
  if (p.kind==='line') return `<line x1="${X(p.p1[0])}" y1="${Y(p.p1[1])}" x2="${X(p.p2[0])}" y2="${Y(p.p2[1])}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" fill="none" ${dash}/>`;
  if (p.kind==='circle') return `<circle cx="${X(p.c[0])}" cy="${Y(p.c[1])}" r="${Math.abs(X(p.c[0]+p.r)-X(p.c[0]))}" stroke="${stroke}" stroke-width="${w}" fill="none" ${dash}/>`;
  if (p.kind==='arc') {
    const r=Math.abs(X(p.c[0]+p.r)-X(p.c[0]));
    const fx=X(p.c[0])+r*Math.cos(p.from*Math.PI/180), fy=Y(p.c[1])+r*Math.sin(p.from*Math.PI/180);
    const tx=X(p.c[0])+r*Math.cos(p.to*Math.PI/180), ty=Y(p.c[1])+r*Math.sin(p.to*Math.PI/180);
    const large=Math.abs(p.to-p.from)>180?1:0;
    return `<path d="M ${fx} ${fy} A ${r} ${r} 0 ${large} 1 ${tx} ${ty}" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linecap="round" ${dash}/>`;
  }
  const d=`M ${p.pts.map(([x,y])=>`${X(x)} ${Y(y)}`).join(' L ')}${p.closed?' Z':''}`;
  return `<path d="${d}" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linejoin="round" stroke-linecap="round" ${dash}/>`;
}
// Relative time budget per stage: most time on the major outline, less on fill.
const STAGE_WEIGHTS=[0.45,0.3,0.25];
export function renderIllustration(kind:NodeKind|undefined, x:number, y:number, w:number, h:number, progress:number, stroke:string, fillColor:string):string {
  const parts=kind&&ILLUSTRATIONS[kind];
  if (!parts || progress<=0) return '';
  const size=Math.min(w,h);
  const scale=size/100*0.86, pad=(size-100*scale)/2;
  const ox=x+(w-size)/2+pad, oy=y+(h-size)/2+pad;
  const X=(n:number)=>ox+n*scale, Y=(n:number)=>oy+n*scale;
  const maxStage=parts.reduce((m,p)=>Math.max(m,p.stage),0);
  const weights=STAGE_WEIGHTS.slice(0,maxStage+1);
  const total=weights.reduce((a,b)=>a+b,0);
  let acc=0;
  const windows=weights.map(wt=>{const start=acc/total; acc+=wt; return {start,end:acc/total};});
  let svg='<g>';
  for (const p of parts) {
    const win=windows[p.stage];
    const local=(progress-win.start)/(win.end-win.start);
    svg+=partSvg(p,X,Y,local,stroke,fillColor);
  }
  return svg+'</g>';
}

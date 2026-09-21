import type {CompiledScene,CompiledNode,SceneTemplate} from '../types/engine.js';

/** V3-4 domain templates (harness §33): the two compositions our frames review showed
 *  generic boxes cannot teach — a protocol message ladder and an economics equilibrium.
 *  Pure functions of (scene, timeMs) → SVG; geometry is deterministic code, the model
 *  never sends coordinates (harness §16). Templates anchor onto the compiled node rects
 *  and reveal with those nodes' timing, so drawing stays speech-aligned for free. */

const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]||c));
const STROKE='#3a5a52';

const revealOpacity=(progress:number,from=0.35)=>Math.max(0,Math.min(1,(progress-from)/(1-from)));
const progressOf=(n:{startMs:number;drawMs:number},timeMs:number)=>Math.max(0,Math.min(1,(timeMs-n.startMs)/n.drawMs));
const arrow=(x1:number,y1:number,x2:number,label:string,opacity:number)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${STROKE}" stroke-width="3" stroke-linecap="round" opacity="${opacity}"/><path d="M ${x2.toFixed(1)} ${y1.toFixed(1)} l ${x2<x1?12:-12} -5.2 l 0 10.4 Z" fill="${STROKE}" opacity="${opacity}"/>${label?`<text x="${((x1+x2)/2).toFixed(1)}" y="${(y1-8).toFixed(1)}" text-anchor="middle" font-size="15" paint-order="stroke" stroke="#fffef9" stroke-width="3.5" opacity="${opacity}">${esc(label)}</text>`:''}`;

/** TLS-style message ladder: two lifelines from the scene's two anchor nodes, numbered
 *  message arrows drawn top-down BELOW the node band; labels come from the scene's edge
 *  labels (canonical handshake step names as fallback when unlabeled). */
function tlsLadder(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation').slice(0,2).sort((a,b)=>a.x-b.x);
  if(anchors.length<2)return '';
  const [client,server]=anchors;
  const lifelineX=(n:CompiledNode)=>n.shape==='icon'?n.x+Math.min(38,n.h*0.4)*(n.emphasis?1.25:1)+8:n.x+n.w/2;
  const clientX=lifelineX(client),serverX=lifelineX(server);
  // The whole ladder lives below the lowest anchor rect (nodes + annotations), so
  // messages never cross the party icons or their annotations.
  const top=Math.max(...scene.nodes.map(n=>n.y+n.h))+18,bottom=614;
  const clientOp=revealOpacity(timeMs>=client.startMs?1:0),serverOp=revealOpacity(timeMs>=server.startMs?1:0);
  let svg=`<line x1="${clientX.toFixed(1)}" y1="${top.toFixed(1)}" x2="${clientX.toFixed(1)}" y2="${bottom}" stroke="${STROKE}" stroke-width="2.4" stroke-dasharray="7 7" opacity="${(0.55*clientOp).toFixed(2)}"/><line x1="${serverX.toFixed(1)}" y1="${top.toFixed(1)}" x2="${serverX.toFixed(1)}" y2="${bottom}" stroke="${STROKE}" stroke-width="2.4" stroke-dasharray="7 7" opacity="${(0.55*serverOp).toFixed(2)}"/>`;
  const steps=['ClientHello','ServerHello + certificate','Key exchange','Finished'];
  const labels=scene.edges.map(e=>e.label||'').filter(Boolean);
  const count=Math.max(2,Math.min(4,scene.edges.length||steps.length));
  const band=(bottom-top-30)/count;
  for(let i=0;i<count;i++){
    const startAt=(scene.edges[i]?.startMs??client.startMs+i*900)+200;
    const opacity=revealOpacity(timeMs>=startAt?1:0);
    const y=top+24+band*i;
    const leftToRight=i%2===0;
    const x1=leftToRight?clientX:serverX,x2=leftToRight?serverX-14:clientX+14;
    svg+=arrow(x1,y,x2,labels[i]||steps[i]||'',opacity);
  }
  return svg;
}

/** Supply/demand equilibrium: axes, downward demand curve, upward supply curve, dashed
 *  equilibrium guides, P-star and Q-star tags. The whole chart lives below the lowest
 *  anchor rect so node boxes stay clear of the curves. */
function supplyDemand(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation').slice(0,2);
  if(anchors.length<2)return '';
  const [demand,supply]=anchors;
  const chartTop=Math.max(...scene.nodes.map(n=>n.y+n.h))+26,yBase=600,xAxisEnd=1120;
  const ox=170;
  const axisOp=revealOpacity(timeMs>=demand.startMs?1:0);
  let svg=`<line x1="${ox}" y1="${yBase}" x2="${xAxisEnd}" y2="${yBase}" stroke="${STROKE}" stroke-width="2.6" opacity="${axisOp}"/><line x1="${ox}" y1="${yBase}" x2="${ox}" y2="${chartTop.toFixed(1)}" stroke="${STROKE}" stroke-width="2.6" opacity="${axisOp}"/><text x="${xAxisEnd-6}" y="${yBase+26}" text-anchor="end" font-size="15" fill="#182d33" opacity="${axisOp}">quantity</text><text x="${ox-34}" y="${(chartTop+18).toFixed(1)}" font-size="15" fill="#182d33" opacity="${axisOp}">price</text>`;
  const dOp=revealOpacity(progressOf(demand,timeMs)),sOp=revealOpacity(progressOf(supply,timeMs));
  const dash=(op:number)=>op>=1?'':` stroke-dasharray="${980}" stroke-dashoffset="${(980*(1-op)).toFixed(1)}"`;
  const yTop=chartTop+22,yLow=yBase-30;
  const xL=ox+90,xR=xAxisEnd-70;
  svg+=`<path d="M ${xL} ${yTop.toFixed(1)} L ${xR} ${yLow}" fill="none" stroke="${demand.color}" stroke-width="4" stroke-linecap="round"${dash(dOp)}/>`;
  svg+=`<path d="M ${xL} ${yLow} L ${xR} ${yTop.toFixed(1)}" fill="none" stroke="${supply.color}" stroke-width="4" stroke-linecap="round"${dash(sOp)}/>`;
  const midX=(xL+xR)/2,midY=(yTop+yLow)/2;
  const midOp=Math.min(dOp,sOp);
  svg+=`<line x1="${ox}" y1="${midY.toFixed(1)}" x2="${midX.toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${STROKE}" stroke-width="2" stroke-dasharray="5 5" opacity="${(0.7*midOp).toFixed(2)}"/><line x1="${midX.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${midX.toFixed(1)}" y2="${yBase}" stroke="${STROKE}" stroke-width="2" stroke-dasharray="5 5" opacity="${(0.7*midOp).toFixed(2)}"/>`;
  svg+=`<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="6" fill="#fffef9" stroke="${STROKE}" stroke-width="3" opacity="${midOp}"/>`;
  svg+=`<text x="${ox-8}" y="${(midY+5).toFixed(1)}" text-anchor="end" font-size="15" fill="#182d33" opacity="${midOp}">P*</text><text x="${midX.toFixed(1)}" y="${yBase+24}" text-anchor="middle" font-size="15" fill="#182d33" opacity="${midOp}">Q*</text>`;
  svg+=`<text x="${xR}" y="${(yLow+22).toFixed(1)}" text-anchor="middle" font-size="15" fill="${demand.color}" opacity="${dOp}">${esc(demand.lines[0]||'demand')}</text>`;
  svg+=`<text x="${xR}" y="${(yTop-10).toFixed(1)}" text-anchor="middle" font-size="15" fill="${supply.color}" opacity="${sOp}">${esc(supply.lines[0]||'supply')}</text>`;
  return svg;
}

/** Attention scores grid: one query (row head) against several keys (columns), a filled
 *  best-match cell, and the weighted-sum arrow out. Anchors: the score node and the
 *  weight/result node; reveal rides them. */
function attentionMatrix(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation').slice(0,2);
  if(anchors.length<2)return '';
  const [scores,weights]=anchors;
  const bandTop=Math.max(...scene.nodes.map(n=>n.y+n.h))+26;
  const left=250,top=bandTop,cell=64,cols=4,rows=3;
  const gridOp=revealOpacity(timeMs>=scores.startMs?1:0);
  const keyLabels=['key 1','key 2','key 3','key 4'];
  let svg=`<text x="${left-14}" y="${top+rows*cell/2+5}" text-anchor="end" font-size="15" fill="${scores.color}" opacity="${gridOp}">q →</text>`;
  for(let c=0;c<cols;c++)svg+=`<text x="${left+cell*c+cell/2}" y="${top-10}" text-anchor="middle" font-size="14" fill="#182d33" opacity="${gridOp}">${esc(keyLabels[c])}</text>`;
  for(let r=0;r<=rows;r++)svg+=`<line x1="${left}" y1="${top+r*cell}" x2="${left+cols*cell}" y2="${top+r*cell}" stroke="${STROKE}" stroke-width="2" opacity="${gridOp}"/>`;
  for(let c=0;c<=cols;c++)svg+=`<line x1="${left+c*cell}" y1="${top}" x2="${left+c*cell}" y2="${top+rows*cell}" stroke="${STROKE}" stroke-width="2" opacity="${gridOp}"/>`;
  const best={r:0,c:1};
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const filled=r===best.r&&c===best.c;
    const op=revealOpacity(timeMs>=scores.startMs+(r*cols+c)*250?1:0,0.5);
    if(op<=0)continue;
    svg+=filled
      ?`<rect x="${left+c*cell+5}" y="${top+r*cell+5}" width="${cell-10}" height="${cell-10}" fill="${scores.color}" fill-opacity="0.85" opacity="${op}"/>`
      :`<text x="${left+c*cell+cell/2}" y="${top+r*cell+cell/2+5}" text-anchor="middle" font-size="14" fill="#5a6b66" opacity="${op}">.${(r+c)%9}</text>`;
  }
  const cellCx=left+best.c*cell+cell/2,cellCy=top+best.r*cell+cell/2;
  const wOp=revealOpacity(progressOf(weights,timeMs),0.5);
  svg+=`<path d="M ${cellCx} ${cellCy+cell/2+6} C ${cellCx+40} ${cellCy+70} ${left+cols*cell+60} ${top+rows*cell+34} ${left+cols*cell+96} ${top+rows*cell+34}" fill="none" stroke="${weights.color}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${260}" stroke-dashoffset="${(260*(1-wOp)).toFixed(1)}"/>`;
  svg+=`<text x="${left+cols*cell+104}" y="${top+rows*cell+39}" font-size="15" fill="${weights.color}" opacity="${wOp}">weights Σ=1</text>`;
  return svg;
}

/** Replication fork: a proper tall Y — the fork point sits at the bottom of the lower
 *  band, parental strands diverge upward, new complementary strands synthesize along
 *  the inside of each arm, and the fork-point marker names the unzip site. */
function dnaFork(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation').slice(0,2);
  if(anchors.length<2)return '';
  const [parental,newStrand]=anchors;
  const bandTop=Math.max(...scene.nodes.map(n=>n.y+n.h))+26;
  const forkX=640,forkY=592,armY=bandTop+10;
  let svg='';
  const pOp=revealOpacity(progressOf(parental,timeMs));
  // Parental strands diverging upward from the fork point (the open "Y").
  const arm=(tipX:number)=>{const len=Math.hypot(tipX-forkX,forkY-armY);return {len,d:`M ${forkX} ${forkY} L ${tipX} ${armY}`};};
  for(const armD of [arm(forkX-260),arm(forkX+260)]){
    svg+=`<path d="${armD.d}" fill="none" stroke="${parental.color}" stroke-width="4.4" stroke-linecap="round" stroke-dasharray="${armD.len.toFixed(1)}" stroke-dashoffset="${(armD.len*(1-pOp)).toFixed(1)}"/>`;
  }
  const sOp=revealOpacity(progressOf(newStrand,timeMs),0.45);
  // New complementary strands: parallel dashes just inside each parental arm.
  for(const dir of [-1,1]){
    const tipX=forkX+dir*260;
    const len=Math.hypot(tipX-(forkX+dir*16),armY-(forkY-30));
    svg+=`<path d="M ${forkX+dir*16} ${forkY-30} L ${tipX+dir*18} ${armY+26}" fill="none" stroke="${newStrand.color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(len*0.62).toFixed(1)} ${(len*0.38).toFixed(1)}" stroke-dashoffset="${(len*(1-sOp)).toFixed(1)}"/>`;
  }
  const forkOp=Math.min(pOp,sOp);
  svg+=`<path d="M ${forkX-9} ${forkY-24} L ${forkX} ${forkY} L ${forkX+9} ${forkY-24}" fill="none" stroke="${STROKE}" stroke-width="3" stroke-linecap="round" opacity="${forkOp}"/>`;
  svg+=`<text x="${forkX}" y="${forkY+22}" text-anchor="middle" font-size="15" fill="#182d33" opacity="${forkOp}">unzips here</text>`;
  return svg;
}

/** Tectonic cross-section: two plates on the surface line with a ridge between them;
 *  circulation drawn as a clean loop — down arrows at the plate tails, return flow
 *  toward the ridge along the mantle floor, up-arrow at the ridge. */
function tectonicSection(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation').slice(0,2);
  if(anchors.length<2)return '';
  const [leftPlate,rightPlate]=anchors.slice().sort((a,b)=>a.x-b.x);
  const top=Math.max(...scene.nodes.map(n=>n.y+n.h))+26;
  const surfaceY=top+56,ridgeX=640;
  let svg='';
  const lOp=revealOpacity(progressOf(leftPlate,timeMs)),rOp=revealOpacity(progressOf(rightPlate,timeMs));
  svg+=`<line x1="120" y1="${surfaceY}" x2="${ridgeX-64}" y2="${surfaceY}" stroke="${leftPlate.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${520}" stroke-dashoffset="${(520*(1-lOp)).toFixed(1)}"/>`;
  svg+=`<line x1="${ridgeX+64}" y1="${surfaceY}" x2="1160" y2="${surfaceY}" stroke="${rightPlate.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${440}" stroke-dashoffset="${(440*(1-rOp)).toFixed(1)}"/>`;
  svg+=`<path d="M ${ridgeX-64} ${surfaceY} L ${ridgeX} ${surfaceY-24} L ${ridgeX+64} ${surfaceY}" fill="none" stroke="${STROKE}" stroke-width="3" opacity="${Math.min(lOp,rOp)}"/>`;
  const convOp=Math.min(lOp,rOp);
  const head=(x:number,y:number,dir:'up'|'down'|'left'|'right')=>{
    const d=dir==='up'?`M ${x-8} ${y+14} L ${x} ${y} L ${x+8} ${y+14}`:dir==='down'?`M ${x-8} ${y-14} L ${x} ${y} L ${x+8} ${y-14}`:dir==='left'?`M ${x+14} ${y-8} L ${x} ${y} L ${x+14} ${y+8}`:`M ${x-14} ${y-8} L ${x} ${y} L ${x-14} ${y+8}`;
    return `<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="${convOp}"/>`;
  };
  // One full convection loop per side: sink at the tail, return along the deep mantle,
  // rise at the ridge. Each piece is a plain line with an attached arrowhead.
  for(const dir of [-1,1]){
    const tailX=ridgeX+dir*420;
    svg+=`<line x1="${tailX}" y1="${surfaceY+16}" x2="${tailX}" y2="${deepY(surfaceY)}" stroke="${STROKE}" stroke-width="2.8" stroke-linecap="round" opacity="${convOp}"/>`+head(tailX,deepY(surfaceY),'down');
    const innerX=ridgeX+dir*110;
    svg+=`<line x1="${tailX-dir*10}" y1="${deepY(surfaceY)}" x2="${innerX+dir*12}" y2="${deepY(surfaceY)}" stroke="${STROKE}" stroke-width="2.8" stroke-linecap="round" opacity="${convOp}"/>`;
    svg+=head(innerX,deepY(surfaceY),dir===-1?'right':'left');
    svg+=`<line x1="${ridgeX+dir*90}" y1="${deepY(surfaceY)}" x2="${ridgeX+dir*70}" y2="${surfaceY+30}" stroke="${STROKE}" stroke-width="2.8" stroke-linecap="round" opacity="${convOp}"/>`;
  }
  svg+=head(ridgeX,surfaceY+28,'up');
  svg+=`<text x="${ridgeX}" y="${deepY(surfaceY)+34}" text-anchor="middle" font-size="15" fill="#182d33" opacity="${convOp}">hot material rises, cool sinks</text>`;
  return svg;
}
const deepY=(surfaceY:number)=>Math.min(600,surfaceY+112);

/** Fluid-flow teaching grammar: a channel, pressure arrows, streamlines, and a
 * velocity profile. Deterministic geometry keeps Navier–Stokes lessons from
 * falling back to generic boxes or misleading unrelated templates. */
function fluidFlow(scene:CompiledScene,timeMs:number):string {
  const anchors=scene.nodes.filter(n=>n.shape!=='annotation');
  if(!anchors.length)return '';
  const top=Math.max(...scene.nodes.map(n=>n.y+n.h))+28;
  const left=110,right=1170,mid=top+145;
  const active=anchors[0];
  const op=revealOpacity(timeMs>=active.startMs?1:0);
  const pressure=anchors[0].color;
  const viscosity=(anchors[1]??anchors[0]).color;
  let svg=`<rect x="${left}" y="${(mid-74).toFixed(1)}" width="${right-left}" height="148" rx="28" fill="#eef6f4" stroke="#3a5a52" stroke-width="2.5" opacity="${(0.8*op).toFixed(2)}"/>`;
  for(let row=0;row<5;row++){
    const y=mid-50+row*25;
    const bend=10*Math.sin(row*0.8);
    svg+=`<path d="M ${left+28} ${y.toFixed(1)} C ${left+300} ${(y+bend).toFixed(1)} ${right-300} ${(y-bend).toFixed(1)} ${right-34} ${y.toFixed(1)}" fill="none" stroke="${viscosity}" stroke-width="${row===2?3.8:2.3}" opacity="${(0.75*op).toFixed(2)}"/>`;
    svg+=`<path d="M ${right-62} ${(y-5).toFixed(1)} L ${right-34} ${y.toFixed(1)} L ${right-62} ${(y+5).toFixed(1)}" fill="none" stroke="${viscosity}" stroke-width="2.3" opacity="${(0.75*op).toFixed(2)}"/>`;
  }
  const arrowY=mid-104;
  for(let i=0;i<5;i++){
    const x=left+80+i*210;
    const a=0.3+0.12*i;
    svg+=`<line x1="${x}" y1="${arrowY}" x2="${x+86}" y2="${arrowY}" stroke="${pressure}" stroke-width="3" opacity="${(a*op).toFixed(2)}"/><path d="M ${x+86} ${arrowY} l -12 -6 l 0 12 Z" fill="${pressure}" opacity="${(a*op).toFixed(2)}"/>`;
  }
  svg+=`<text x="${left+8}" y="${arrowY-14}" font-size="16" fill="${pressure}" opacity="${op}">pressure gradient →</text>`;
  svg+=`<text x="${left+8}" y="${mid+106}" font-size="16" fill="${viscosity}" opacity="${op}">viscosity smooths velocity differences</text>`;
  const px=right-150,py=mid+8;
  svg+=`<line x1="${px-45}" y1="${py-64}" x2="${px-45}" y2="${py+64}" stroke="#3a5a52" stroke-width="2" opacity="${op}"/><path d="M ${px-44} ${py+58} C ${px-5} ${py+10} ${px-4} ${py-10} ${px+34} ${py-58}" fill="none" stroke="${pressure}" stroke-width="3" opacity="${op}"/><text x="${px-40}" y="${py+84}" font-size="14" fill="#182d33" opacity="${op}">velocity profile</text>`;
  return svg;
}

// The deterministic fallback used when a live visual director is unavailable must still
// teach a complete idea. These topic grammars deliberately use a few large, readable
// primitives instead of two isolated icons. They are semantic overlays: narration and
// node anchors still control reveal timing, while the geometry remains renderer-owned.
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const stageOpacity=(scene:CompiledScene,timeMs:number,index:number,total:number):number=>{
  const progress=clamp01(timeMs/Math.max(1,scene.durationMs));
  const start=(index/Math.max(1,total))*0.64;
  // Keep the full concept map faintly present across scene boundaries.  A
  // scene-local reveal otherwise resets to a single card and leaves a large
  // empty frame while the next narration beat starts.  The active step still
  // ramps to full opacity, but the learner can always see the surrounding
  // context and the direction of the lesson.
  const revealed=clamp01((progress-start)/0.18);
  return 0.28+0.72*revealed;
};
const splitLabel=(value:string,max=18):string[]=>{
  const words=value.trim().split(/\s+/).filter(Boolean);if(!words.length)return [''];
  const lines:string[]=[];let current='';
  for(const word of words){const next=current?`${current} ${word}`:word;if(current&&next.length>max){lines.push(current);current=word;}else current=next;}
  if(current)lines.push(current);return lines.slice(0,2);
};
const card=(x:number,y:number,w:number,h:number,label:string,color:string,opacity:number,marker:string):string=>{
  const lines=splitLabel(label);const lineHeight=25;const start=y+h/2-(lines.length-1)*lineHeight/2+8;
  return `<g opacity="${opacity.toFixed(3)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${color}" fill-opacity="0.28" stroke="${STROKE}" stroke-width="2.5"/><circle cx="${x+28}" cy="${y+28}" r="14" fill="${color}" stroke="${STROKE}" stroke-width="2"/><text x="${x+28}" y="${y+34}" text-anchor="middle" font-size="16" fill="#182d33" font-weight="700">${esc(marker)}</text><text x="${x+w/2+10}" y="${start}" text-anchor="middle" font-size="20" fill="#182d33" font-weight="600">${lines.map((line,i)=>`<tspan x="${x+w/2+10}" dy="${i?lineHeight:0}">${esc(line)}</tspan>`).join('')}</text></g>`;
};
const arrowRight=(x1:number,y:number,x2:number,opacity:number,label?:string):string=>`<g opacity="${opacity.toFixed(3)}"><line x1="${x1}" y1="${y}" x2="${x2-16}" y2="${y}" stroke="${STROKE}" stroke-width="3.5" stroke-linecap="round"/><path d="M ${x2-16} ${y-8} L ${x2} ${y} L ${x2-16} ${y+8}" fill="none" stroke="${STROKE}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>${label?`<text x="${((x1+x2)/2).toFixed(1)}" y="${y-14}" text-anchor="middle" font-size="15" fill="#536b65">${esc(label)}</text>`:''}</g>`;

/** Ghost/sleep lessons teach the distinction between a vivid felt event and an
 * interpretation. The diagram is intentionally non-diagnostic: context is shown as a
 * set of possible contributors, not as proof that explains every experience. */
function sleepPerception(scene:CompiledScene,timeMs:number):string {
  const labels=['felt experience','sleep / stress / context','interpretation'];
  const colors=['#e6dff5','#d9edf4','#f9ebbd'];const xs=[110,470,830];const y=274,w=300,h=150;
  let svg=`<text x="640" y="190" text-anchor="middle" font-size="23" fill="#536b65">Separate what was felt from what it means</text>`;
  for(let i=0;i<labels.length;i++){
    const op=stageOpacity(scene,timeMs,i,labels.length);svg+=card(xs[i],y,w,h,labels[i],colors[i],op,String(i+1));
    if(i<labels.length-1)svg+=arrowRight(xs[i]+w+12,y+h/2,xs[i+1]-12,Math.min(op,stageOpacity(scene,timeMs,i+1,labels.length)),i===0?'notice':'check');
  }
  const op=stageOpacity(scene,timeMs,2,3);
  svg+=`<g opacity="${op.toFixed(3)}"><path d="M 174 330 C 152 300 165 270 196 270 C 225 270 238 302 216 330" fill="none" stroke="#3a5a52" stroke-width="3"/><circle cx="190" cy="310" r="6" fill="#3a5a52"/><path d="M 164 350 Q 190 330 216 350" fill="none" stroke="#3a5a52" stroke-width="3"/></g>`;
  svg+=`<rect x="250" y="515" width="780" height="58" rx="16" fill="#eef6f4" stroke="#9ab5ad"/><text x="640" y="551" text-anchor="middle" font-size="20" fill="#30534b">A vivid experience is real as an experience; its cause still needs evidence.</text>`;
  return svg;
}

/** Spiritual-leadership lessons show trust as a repeatable path: care, reasons,
 * questions, and accountability. The path avoids a worship/obedience visual shortcut. */
function trustPath(scene:CompiledScene,timeMs:number):string {
  const labels=['Listen with care','Explain the reasons','Invite questions','Stay accountable'];
  const colors=['#d9edf4','#e6dff5','#f9ebbd','#dbecdd'];const xs=[80,365,650,935];const y=278,w=250,h=142;
  let svg=`<text x="640" y="190" text-anchor="middle" font-size="23" fill="#536b65">Trust grows through visible reasons and responsibility</text><line x1="120" y1="488" x2="1160" y2="488" stroke="#9ab5ad" stroke-width="4" stroke-linecap="round"/>`;
  for(let i=0;i<labels.length;i++){
    const op=stageOpacity(scene,timeMs,i,labels.length);svg+=card(xs[i],y,w,h,labels[i],colors[i],op,String(i+1));
    svg+=`<circle cx="${xs[i]+w/2}" cy="488" r="12" fill="${colors[i]}" stroke="${STROKE}" stroke-width="3" opacity="${op.toFixed(3)}"/>`;
    if(i<labels.length-1)svg+=arrowRight(xs[i]+w+10,349,xs[i+1]-10,Math.min(op,stageOpacity(scene,timeMs,i+1,labels.length)));
  }
  const op=stageOpacity(scene,timeMs,0,4);
  svg+=`<g opacity="${op.toFixed(3)}" stroke="#3a5a52" stroke-width="3" fill="none"><circle cx="54" cy="333" r="18"/><path d="M 54 352 L 54 415 M 54 370 L 28 397 M 54 370 L 80 397"/><circle cx="1225" cy="333" r="18"/><path d="M 1225 352 L 1225 415 M 1225 370 L 1199 397 M 1225 370 L 1251 397"/></g>`;
  svg+=`<rect x="265" y="535" width="750" height="52" rx="15" fill="#fff7df" stroke="#d7bd75"/><text x="640" y="568" text-anchor="middle" font-size="20" fill="#6a5523">A leader earns trust; trust never removes a learner's agency.</text>`;
  return svg;
}

/** Defensive dark-web lessons show the social funnel and the safe exit lane. It
 * intentionally omits operational access, evasion, or marketplace instructions. */
function scamFunnel(scene:CompiledScene,timeMs:number):string {
  const labels=['Sensational hook','Private pressure','Urgent request'];const colors=['#e6dff5','#f9ebbd','#f6ded4'];
  const xs=[100,300,500],y=255,w=190,h=130;let svg=`<text x="640" y="190" text-anchor="middle" font-size="23" fill="#536b65">Manipulation narrows choices; safety restores them</text>`;
  for(let i=0;i<labels.length;i++){
    const op=stageOpacity(scene,timeMs,i,labels.length);const top=y+i*32;const width=w-i*28;const x=xs[i]+i*14;
    svg+=`<g opacity="${op.toFixed(3)}"><path d="M ${x} ${top} L ${x+width} ${top} L ${x+width-26} ${top+h} L ${x+26} ${top+h} Z" fill="${colors[i]}" fill-opacity="0.45" stroke="${STROKE}" stroke-width="2.5"/><text x="${x+width/2}" y="${top+68}" text-anchor="middle" font-size="19" fill="#182d33" font-weight="600">${splitLabel(labels[i],15).map((line,j)=>`<tspan x="${x+width/2}" dy="${j?23:0}">${esc(line)}</tspan>`).join('')}</text></g>`;
    if(i<labels.length-1)svg+=arrowRight(x+width+10,top+h/2,xs[i+1]-10,Math.min(op,stageOpacity(scene,timeMs,i+1,labels.length)));
  }
  const safeOp=stageOpacity(scene,timeMs,2,3);
  svg+=`<g opacity="${safeOp.toFixed(3)}"><rect x="800" y="252" width="360" height="285" rx="24" fill="#eef6f4" stroke="#78a99c" stroke-width="3"/><path d="M 980 292 L 1040 316 L 1030 388 C 1022 430 980 455 980 455 C 980 455 938 430 930 388 L 920 316 Z" fill="#d9edf4" stroke="#3a5a52" stroke-width="3"/><path d="M 950 370 L 972 392 L 1015 344" fill="none" stroke="#3a5a52" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><text x="980" y="485" text-anchor="middle" font-size="20" fill="#30534b" font-weight="600">Pause · verify · protect</text><text x="980" y="515" text-anchor="middle" font-size="16" fill="#536b65">Use an independent source before acting.</text></g>`;
  svg+=`<rect x="170" y="545" width="940" height="48" rx="14" fill="#f4f1e6" stroke="#d8d2c0"/><text x="640" y="576" text-anchor="middle" font-size="19" fill="#536b65">Pressure is a signal to slow down, not a reason to comply.</text>`;
  return svg;
}

const RENDERERS:Record<SceneTemplate,(scene:CompiledScene,timeMs:number)=>string>={
  tls_handshake:tlsLadder,
  supply_demand:supplyDemand,
  attention_matrix:attentionMatrix,
  dna_fork:dnaFork,
  tectonic_section:tectonicSection,
  fluid_flow:fluidFlow,
  sleep_perception:sleepPerception,
  trust_path:trustPath,
  scam_funnel:scamFunnel,
};

/** Template overlay for the current frame — appended after nodes, before edge labels. */
export function renderTemplate(scene:CompiledScene,timeMs:number):string {
  const render=scene.template&&RENDERERS[scene.template];
  return render?render(scene,timeMs):'';
}

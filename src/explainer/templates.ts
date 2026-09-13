import type {CompiledScene,CompiledNode,SceneTemplate} from '../shared/types.js';

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

const RENDERERS:Record<SceneTemplate,(scene:CompiledScene,timeMs:number)=>string>={
  tls_handshake:tlsLadder,
  supply_demand:supplyDemand,
  attention_matrix:attentionMatrix,
  dna_fork:dnaFork,
  tectonic_section:tectonicSection,
};

/** Template overlay for the current frame — appended after nodes, before edge labels. */
export function renderTemplate(scene:CompiledScene,timeMs:number):string {
  const render=scene.template&&RENDERERS[scene.template];
  return render?render(scene,timeMs):'';
}

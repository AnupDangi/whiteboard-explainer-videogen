import type {CompiledScene,CompiledNode,SceneTemplate} from './types.js';

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

const RENDERERS:Record<SceneTemplate,(scene:CompiledScene,timeMs:number)=>string>={
  tls_handshake:tlsLadder,
  supply_demand:supplyDemand,
};

/** Template overlay for the current frame — appended after nodes, before edge labels. */
export function renderTemplate(scene:CompiledScene,timeMs:number):string {
  const render=scene.template&&RENDERERS[scene.template];
  return render?render(scene,timeMs):'';
}

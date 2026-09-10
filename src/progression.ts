import {renderSVG,routeEdge} from './engine.js';
import type {CompiledScene} from './types.js';

/** V3-5 quality harness (harness §§45/47/48/64): deterministic visual measurements a
 *  model should never be paid to detect — the progression contact sheet the critic
 *  reviews, the longest narrated interval with no visual change, and a connector
 *  sampling check that catches routes `routeEdge` could not clear. Pure functions. */

/** Frames at 0/25/50/75/100% of the scene duration (start frame clamps to first event). */
export function progressionFrames(scene:CompiledScene):Array<{timeMs:number;svg:string}> {
  const d=scene.durationMs;
  return [0,0.25,0.5,0.75,1].map(f=>{const timeMs=Math.round(d*f);return {timeMs,svg:renderSVG(scene,timeMs)};});
}

/** Longest narrated span (word-timed) during which nothing appears, moves or finishes.
 *  Reveals and edge draws count as change; pure text captions do not. */
export function staticIntervalMs(scene:CompiledScene):number {
  const events=[...scene.nodes.map(n=>n.startMs),...scene.nodes.map(n=>n.startMs+n.drawMs),...scene.edges.map(e=>e.startMs),...scene.edges.map(e=>e.startMs+e.drawMs)]
    .sort((a,b)=>a-b);
  const firstWord=scene.timing.words[0]?.startMs??0;
  const lastWordEnd=scene.timing.words.at(-1)?.endMs??scene.durationMs;
  const marks=[firstWord,...events.filter(t=>t>firstWord&&t<lastWordEnd),lastWordEnd];
  let longest=0;
  for(let i=1;i<marks.length;i++)longest=Math.max(longest,marks[i]-marks[i-1]);
  return longest;
}

/** Sampled route test: does the edge's best achievable route still pass through a node
 *  rect that is not an endpoint? routeEdge picks the first of six deterministic
 *  candidates that clears everything; when none does, its fallback bow can clip —
 *  this lint surfaces that residual so the critic (or a report) sees it. */
export function connectorThroughNode(scene:CompiledScene):Array<{from:string;to:string;through:string}> {
  const byId=new Map(scene.nodes.map(n=>[n.id,n]));
  const hits:Array<{from:string;to:string;through:string}>=[];
  for(const e of scene.edges){
    const a=byId.get(e.from),b=byId.get(e.to);
    if(!a||!b)continue;
    const obstacles=scene.nodes.filter(n=>n.id!==e.from&&n.id!==e.to&&n.shape!=='annotation');
    const route=routeEdge(e,obstacles.map(n=>({x:n.x,y:n.y,w:n.w,h:n.h})));
    for(const n of obstacles){
      for(let k=0;k<=12;k++){
        const t=k/12,mt=1-t;
        const x=mt*mt*e.x1+2*mt*t*route.cx+t*t*e.x2,y=mt*mt*e.y1+2*mt*t*route.cy+t*t*e.y2;
        if(x>n.x&&x<n.x+n.w&&y>n.y&&y<n.y+n.h){hits.push({from:e.from,to:e.to,through:n.id});break;}
      }
    }
  }
  return hits;
}

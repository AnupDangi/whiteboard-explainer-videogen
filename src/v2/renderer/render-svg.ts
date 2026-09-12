import type {CompiledSceneV2} from '../types.js';
import {path} from '../assets/geometry.js';
import {wrapLabel} from '../compiler/text.js';
import {COLORS,escape} from './style.js';
import {objectState} from './scene-state.js';
import {renderIllustration} from './illustrations.js';
import {renderPrimitive,renderLabel,renderEquation} from './primitives.js';
import {renderRelations} from './relations.js';
import {renderCursor} from './cursor.js';
import {renderStep} from './steps.js';
import {renderCaptions} from './captions.js';
/** Browser and export import this exact pure renderer. No DOM, env, clock, or random state. */
export function renderSVG(scene:CompiledSceneV2,timeMs:number,options:{cursor?:boolean;captions?:boolean}={}):string{
 if(!Number.isFinite(timeMs))throw new Error('Invalid render time');const time=Math.max(0,Math.min(timeMs,scene.durationMs));let body='',cursor;const titleLines=wrapLabel(scene.scene.title,1152,32);const title=titleLines.map((line,i)=>`<text x="64" y="${titleLines.length===1?99:76+i*34}" font-family="Arial, sans-serif" font-size="32" font-weight="600" fill="${COLORS.ink}">${escape(line)}</text>`).join('');
 const orderedRoots=[...scene.objects].filter(o=>!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support').sort((a,b)=>a.x-b.x);let structure='';
 if(scene.scene.archetype==='timeline'&&orderedRoots.length>1){const railY=Math.min(...orderedRoots.map(o=>o.y+o.h))+34,x0=orderedRoots[0].x+orderedRoots[0].w/2,x1=orderedRoots[orderedRoots.length-1].x+orderedRoots[orderedRoots.length-1].w/2;structure=`<path d="M ${x0} ${railY} H ${x1}" stroke="#d9dfd5" stroke-width="3"/>`+orderedRoots.map(o=>`<circle cx="${o.x+o.w/2}" cy="${railY}" r="5" fill="${COLORS.green}"/>`).join('');}
 if(scene.scene.archetype==='trajectory'&&orderedRoots.length>1)structure=`<path d="${path(orderedRoots.map(o=>({x:o.x+o.w/2,y:o.y+o.h})))}" fill="none" stroke="${COLORS.blue}" stroke-width="2" stroke-dasharray="8 8" opacity=".6"/>`;
 for(const o of [...scene.objects].sort((a,b)=>a.zIndex-b.zIndex||a.id.localeCompare(b.id))){const state=objectState(scene,o.id,time);if(!state.visible)continue;let drawing='';
  if(o.assetRef){const rendered=renderIllustration(o,state.draw,state.emphasis,state.state);drawing=rendered.svg;if(rendered.cursor)cursor=rendered.cursor;}else if(o.primitiveRef==='equation')drawing=renderEquation(o,state.draw,state.emphasis);else drawing=renderPrimitive(o,state.draw);
  const numbered=scene.scene.archetype==='numbered_steps'&&!o.parentId&&o.role!=='annotation';if(numbered)drawing=renderStep(o,scene.objects.filter(x=>!x.parentId&&x.role!=='annotation').findIndex(x=>x.id===o.id),state.draw,state.emphasis);
  body+=`<g data-object="${escape(o.id)}" opacity="${state.opacity}">${drawing}${!numbered&&o.primitiveRef!=='equation'&&state.draw>.2?renderLabel(o,state.emphasis,state.draw):''}</g>`;
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${COLORS.paper}"/><text x="64" y="38" font-family="Arial, sans-serif" font-size="13" letter-spacing="2" fill="#65776b">EXPLAIN CANVAS / VISUAL LESSON</text>${title}${structure}${body}${renderRelations(scene,time)}${options.cursor?renderCursor(cursor):''}<path d="M64 643 H1216" stroke="#d9dfd5"/>${options.captions===false?'':renderCaptions(scene.timing,time)}<text x="1216" y="704" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#65776b">${scene.timing.kind==='estimated'?'ESTIMATED TIMING · SILENT PREVIEW':'SPEECH-ALIGNED'}</text></svg>`;
}

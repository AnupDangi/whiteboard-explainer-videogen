import type {CompiledSceneV2} from '../types.js';
import {path,length,pointAt} from '../assets/geometry.js';
import {progress,objectState} from './scene-state.js';
import {COLORS} from './style.js';
import {getAsset} from '../assets/registry.js';
export function renderRelations(scene:CompiledSceneV2,time:number):string{
 let svg='';for(const r of scene.relations){if(['none','containment'].includes(r.visualForm))continue;
  const events=scene.actions.filter(a=>a.relationIds.includes(r.id)&&a.startMs<=time);if(!events.length)continue;
  if(!objectState(scene,r.from.objectId,time).visible||!objectState(scene,r.to.objectId,time).visible)continue;
  const firstDraw=events.find(a=>a.type==='trace'||a.type==='flow');if(!firstDraw)continue;
  let emphasis=0,opacity=1;for(const a of events){const p=progress(a,time);if(a.type==='highlight')emphasis=p;if(a.type==='pulse')emphasis=p<1?Math.sin(p*Math.PI):0;if(a.type==='fade')opacity=1-p;}
  const event=events.filter(a=>a.type==='flow').at(-1)??firstDraw,p=progress(event,time),reveal=progress(firstDraw,time),l=length(r.points),tip=pointAt(r.points,l*reveal),source=scene.objects.find(o=>o.id===r.from.objectId)!,color=source.assetRef?COLORS[getAsset(source.assetRef).parts[0].stroke]:COLORS.ink;
  svg+=`<g opacity="${opacity}"><path d="${path(r.points)}" fill="none" stroke="${color}" stroke-width="${2.2+emphasis*2.2}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${l}" stroke-dashoffset="${l*(1-reveal)}"/>`;
  if(p>0&&r.visualForm!=='leader')svg+=`<path d="M -10 -5 L 0 0 L -10 5" fill="none" stroke="${color}" stroke-width="${2.2+emphasis*2.2}" transform="translate(${tip.x} ${tip.y}) rotate(${tip.angle})"/>`;
  if(event.type==='flow'&&p<1){const dot=pointAt(r.points,l*p);svg+=`<circle cx="${dot.x}" cy="${dot.y}" r="4" fill="${color}"/>`;}
  svg+='</g>';
 }return svg;
}

import type {CompiledSceneV2} from '../types.js';
import {path,length,pointAt} from '../assets/geometry.js';
import {progress,objectState} from './scene-state.js';
import {COLORS} from './style.js';
import {resolveAsset} from '../assets/registry.js';
import {resolveAssetColor,themePalette,type ThemePalette} from './palette.js';
/** Relations are knowledge, not decoration, so a relation renders even when
 *  nothing animates it. A relation with no trace/flow action is VISIBLE_STATIC:
 *  it draws fully as soon as both endpoints are visible. A relation that *does*
 *  have a motion stays hidden until that motion starts, then draws
 *  progressively as before. Previously only an animated relation drew at all,
 *  so graph edges vanished silently and the picture was poorer than the graph
 *  (measured on the first complete narrated lesson: 5 relations in the scene,
 *  1 visible arrow). */
export function renderRelations(scene:CompiledSceneV2,time:number,palette:ThemePalette=themePalette()):string{
 let svg='';for(const r of scene.relations){
  if(['none','containment'].includes(r.visualForm))continue;
  if(!objectState(scene,r.from.objectId,time).visible||!objectState(scene,r.to.objectId,time).visible)continue;
  const all=scene.actions.filter(a=>a.relationIds.includes(r.id));
  const events=all.filter(a=>a.startMs<=time);
  const hasMotion=all.some(a=>a.type==='trace'||a.type==='flow');
  const motion=events.find(a=>a.type==='trace'||a.type==='flow');
  if(hasMotion&&!motion)continue;
  let emphasis=0,opacity=1;for(const a of events){const p=progress(a,time);if(a.type==='highlight')emphasis=p;if(a.type==='pulse')emphasis=p<1?Math.sin(p*Math.PI):0;if(a.type==='fade')opacity=1-p;}
  const flow=events.filter(a=>a.type==='flow').at(-1),p=flow?progress(flow,time):0,reveal=motion?progress(motion,time):1;
  const l=length(r.points),tip=pointAt(r.points,l*reveal),source=scene.objects.find(o=>o.id===r.from.objectId)!,firstPart=source.assetRef?resolveAsset(source.assetRef,scene.assetCatalog).parts[0]:undefined,color=firstPart?(resolveAssetColor(firstPart.stroke,firstPart.strokeRole,palette)??COLORS.ink):COLORS.ink;
  svg+=`<g opacity="${opacity}"><path d="${path(r.points)}" fill="none" stroke="${color}" stroke-width="${2.2+emphasis*2.2}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${l}" stroke-dashoffset="${l*(1-reveal)}"/>`;
  if(reveal>0&&r.visualForm!=='leader')svg+=`<path d="M -10 -5 L 0 0 L -10 5" fill="none" stroke="${color}" stroke-width="${2.2+emphasis*2.2}" transform="translate(${tip.x} ${tip.y}) rotate(${tip.angle})"/>`;
  if(flow&&p<1){const dot=pointAt(r.points,l*p);svg+=`<circle cx="${dot.x}" cy="${dot.y}" r="4" fill="${color}"/>`;}
  svg+='</g>';
 }return svg;
}

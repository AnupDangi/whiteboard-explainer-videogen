import {archetypePlacements} from './archetypes.js';
import type {CompiledObject,CompiledSceneV2,VisualTiming,LayoutZone} from '../types.js';
import {validateVisualScene} from '../planning/validate.js';
import {getAsset,canonicalAnchor} from '../assets/registry.js';
import {BOARD,zoneRect,supportedArchetype} from './zones.js';
import {wrapLabel,visualBounds} from './text.js';
import {findCollisions,contains} from './collisions.js';
import {routeRelation} from './routing.js';
import {occupancy} from './occupancy.js';
import {compileTimeline,estimatedTiming,staticIntervals} from './timeline.js';
export function compileScene(input:unknown,timingInput?:VisualTiming,previous?:CompiledSceneV2):CompiledSceneV2{
 const scene=validateVisualScene(input,undefined,new Set(previous?.objects.map(o=>o.id))),diagnostics:string[]=[];
 for(const action of scene.beats.flatMap(b=>b.actions))if(!['draw','reveal','trace','flow','fill','highlight','pulse','fade'].includes(action.type))throw new Error(`Motion not implemented: ${action.type}`);
 for(const r of scene.relations)for(const ref of [r.from,r.to]){const o=scene.objects.find(o=>o.id===ref.objectId)!;if(o.assetRef)ref.anchor=canonicalAnchor(o.assetRef,ref.anchor);}
 if(!supportedArchetype(scene.archetype))throw new Error(`Archetype not implemented: ${scene.archetype}`);
 if(['structural_diagram','convergence'].includes(scene.archetype)&&scene.objects.filter(o=>o.role==='hero').length!==1)throw new Error('Structural composition requires exactly one hero');
 const placements=archetypePlacements(scene);
 const objects:CompiledObject[]=[],remaining=[...scene.objects];let support=0;
 while(remaining.length){const index=remaining.findIndex(o=>!o.parentId||objects.some(p=>p.id===o.parentId));if(index<0)throw new Error('Unresolved parent');const o=remaining.splice(index,1)[0];
  const asset=o.assetRef?getAsset(o.assetRef):undefined;if(asset&&!asset.archetypes.includes(scene.archetype))throw new Error(`Asset incompatible with archetype: ${o.id}`);
  if(asset)for(const state of o.allowedStates)if(state!=='hidden'&&!asset.states[state])throw new Error(`Asset does not implement state ${state}`);
  const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const hero=o.role==='hero',w=hero?330:labelOnly?250:132,h=hero?440:labelOnly?44:132;
  const zone=o.preferredZone??(hero?'center':(['upper_left','upper_right','lower_left','lower_right'] as LayoutZone[])[support++%4]);
  let rect=placements.get(o.id)??zoneRect(zone,w,h);const parent=o.parentId?objects.find(p=>p.id===o.parentId):undefined;
  if(parent){const cw=Math.min(w,parent.w*.4),ch=Math.min(h,parent.h*.35);const px=zone.includes('left')?.2:zone.includes('right')?.8:.5,py=zone.includes('upper')?.2:zone.includes('lower')?.54:.5;rect={x:parent.x+(parent.w-cw)*px,y:parent.y+(parent.h-ch)*py,w:cw,h:ch};if(o.collisionPolicy==='touch')rect.x=parent.x+parent.w;}
  const old=scene.continuity.keepFromPrevious.includes(o.id)?previous?.objects.find(x=>x.id===o.id):undefined;
  if(old){if(old.conceptId!==o.conceptId||old.assetRef!==o.assetRef)throw new Error('Persistent identity changed');rect={x:old.x,y:old.y,w:old.w,h:old.h};}
  const fontSize=scene.archetype==='numbered_steps'?24:scene.archetype==='equation_walkthrough'?24:labelOnly?22:20,lines=wrapLabel(o.label,labelOnly?rect.w:Math.max(rect.w,180),fontSize);
  const compiled:CompiledObject={...o,...rect,anchors:{},fontSize,lines,zIndex:parent?parent.zIndex+1:hero?1:2};
  objects.push(compiled);
 }
 const resolveAnchors=()=>{for(const o of objects){o.anchors={center:{x:o.x+o.w/2,y:o.y+o.h/2},input:{x:o.x,y:o.y+o.h/2},output:{x:o.x+o.w,y:o.y+o.h/2},top:{x:o.x+o.w/2,y:o.y},bottom:{x:o.x+o.w/2,y:o.y+o.h}};if(o.assetRef){const a=getAsset(o.assetRef),[vx,vy,vw,vh]=a.viewBox;for(const [name,p] of Object.entries(a.anchors))o.anchors[name]={x:o.x+(p.x-vx)/vw*o.w,y:o.y+(p.y-vy)/vh*o.h};}}};
 // Labels are part of occupied geometry, including labels below illustration bounds.
 for(let pass=0;pass<3&&findCollisions(objects).length;pass++){
  for(const o of objects.filter(o=>o.role==='annotation'||o.role==='label')){
   const before=findCollisions(objects).length,original={x:o.x,y:o.y};
   for(const [dx,dy] of [[0,32],[0,-32],[0,64],[0,-64],[32,32],[-32,32],[0,96]]){
    o.x=original.x+dx;o.y=original.y+dy;
    if(contains(BOARD.safe,visualBounds(o))&&findCollisions(objects).length<before){diagnostics.push(`geometry repair: moved annotation ${o.id}`);break;}
    o.x=original.x;o.y=original.y;
   }
  }
 }
 // Treat zones as preferences. Repair crowded supports locally, preserving the hero and persisted objects.
 for(let pass=0;pass<3&&['structural_diagram','convergence'].includes(scene.archetype)&&findCollisions(objects).length;pass++){
  for(const o of objects.filter(o=>!o.parentId&&o.role!=='hero'&&!['annotation','label'].includes(o.role)&&!scene.continuity.keepFromPrevious.includes(o.id))){
   const before=findCollisions(objects),involved=before.some(pair=>pair.split('/').includes(o.id));if(!involved)continue;
   const original={x:o.x,y:o.y,w:o.w,h:o.h};let best={...original},bestCount=before.length,bestDistance=Infinity;
   for(const scale of [1,.9,.8])for(const zone of ['upper_left','upper_right','lower_left','lower_right','left','right'] as LayoutZone[]){
    Object.assign(o,zoneRect(zone,original.w*scale,original.h*scale));
    if(!contains(BOARD.safe,visualBounds(o)))continue;
    const count=findCollisions(objects).length,distance=Math.hypot(o.x-original.x,o.y-original.y)+(1-scale)*100;
    if(count<bestCount||(count===bestCount&&count<before.length&&distance<bestDistance)){best={x:o.x,y:o.y,w:o.w,h:o.h};bestCount=count;bestDistance=distance;}
   }
   Object.assign(o,best);if(bestCount<before.length)diagnostics.push(`geometry repair: repositioned support ${o.id}`);
  }
 }
 const collisions=findCollisions(objects);if(collisions.length)throw new Error(`Illegal overlap: ${collisions.join(', ')}`);
 for(const o of objects)if(!contains(BOARD.safe,visualBounds(o)))throw new Error(`Canvas escape: ${o.id}`);
 resolveAnchors();
 // Non-directional symbols expose facing flow ports; physical subpart anchors stay fixed.
 for(const o of objects){if(!o.assetRef||getAsset(o.assetRef).flowPortPolicy!=='facing')continue;const ports={input:{...o.anchors.input},output:{...o.anchors.output}};
  for(const name of ['input','output']){const outgoing=scene.relations.filter(r=>r.from.objectId===o.id&&r.from.anchor===name&&r.relationType==='flows_to');if(!outgoing.length)continue;
   const targets=outgoing.map(r=>objects.find(t=>t.id===r.to.objectId)!.anchors[r.to.anchor]);if(targets.some(p=>!p))throw new Error('Invalid flow target anchor');const meanX=targets.reduce((n,p)=>n+p.x,0)/targets.length;o.anchors[name]=meanX<o.x+o.w/2?ports.input:ports.output;
  }
 }
 // A simple cycle has one incoming/outgoing port per node. Face each port toward its neighbor.
 if(scene.archetype==='cycle')for(const r of scene.relations){const from=objects.find(o=>o.id===r.from.objectId)!,to=objects.find(o=>o.id===r.to.objectId)!;
  for(const [o,target,name] of [[from,to,r.from.anchor],[to,from,r.to.anchor]] as const){if(!['input','output'].includes(name))continue;const b=visualBounds(o),cx=b.x+b.w/2,cy=b.y+b.h/2,dx=target.x+target.w/2-cx,dy=target.y+target.h/2-cy,scale=1/Math.max(Math.abs(dx)/(b.w/2+10),Math.abs(dy)/(b.h/2+10));o.anchors[name]={x:cx+dx*scale,y:cy+dy*scale};}
 }
 const relations=scene.relations.map(r=>routeRelation(scene.archetype==='hierarchy'?{...r,from:{...r.from,anchor:'bottom'},to:{...r.to,anchor:'top'}}:r,objects)),timing=structuredClone(timingInput??estimatedTiming(scene)),actions=compileTimeline(scene,timing);
 if(['structural_diagram','convergence','cross_section','spatial_process'].includes(scene.archetype)){const metrics=occupancy(objects);if(metrics.heroRatio<.3)diagnostics.push('Weak hero salience');if(metrics.areaRatio<.2)diagnostics.push('Low structural occupancy');}
 const gaps=staticIntervals(scene,timing,actions);if(gaps.some(g=>g.endMs-g.startMs>3500))diagnostics.push('Narrated static interval exceeds 3500ms');
 return {version:2,scene,objects,relations,actions,timing,durationMs:timing.durationMs+650,diagnostics};
}

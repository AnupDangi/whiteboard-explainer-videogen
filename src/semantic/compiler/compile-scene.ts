import {archetypePlacements} from './archetypes.js';
import {MOTIONS} from '../types.js';
import type {CompiledObject,CompiledSceneV2,VisualTiming,LayoutZone} from '../types.js';
import type {AssetDefinition} from '../assets/types.js';
import {validateVisualScene} from '../planning/validate.js';
import {resolveAsset,canonicalAnchor} from '../assets/registry.js';
import {applyCompositionFallbacks} from './fallback.js';
import {BOARD,zoneRect,nestedZoneRect,supportedArchetype} from './zones.js';
import {MAX_STATIC_INTERVAL_MS} from '../../shared/language.js';
import {fitLabel,visualBounds} from './text.js';
import {findCollisions,contains} from './collisions.js';
import {routeRelation} from './routing.js';
import {occupancy} from './occupancy.js';
import {compileTimeline,estimatedTiming,staticIntervals} from './timeline.js';
export function compileScene(input:unknown,timingInput?:VisualTiming,previous?:CompiledSceneV2,catalog?:Record<string,AssetDefinition>):CompiledSceneV2{
 const validated=validateVisualScene(input,undefined,new Set(previous?.objects.map(o=>o.id))),diagnostics:string[]=[];
 const {scene,warnings:fallbackWarnings}=applyCompositionFallbacks(validated,catalog);
 for(const w of fallbackWarnings)diagnostics.push(w);
  /** Schema MOTIONS is the contract (the prompt advertises all of them); any
   *  action the renderer does not individually animate simply times its beat. */
  for(const action of scene.beats.flatMap(b=>b.actions))if(!MOTIONS.includes(action.type))throw new Error(`Motion not implemented: ${action.type}`);
 for(const r of scene.relations)for(const ref of [r.from,r.to]){const o=scene.objects.find(o=>o.id===ref.objectId)!;if(o.assetRef)ref.anchor=canonicalAnchor(o.assetRef,ref.anchor,catalog);}
 if(!supportedArchetype(scene.archetype))throw new Error(`Archetype not implemented: ${scene.archetype}`);
 if(['structural_diagram','convergence'].includes(scene.archetype)&&scene.objects.filter(o=>o.role==='hero').length!==1)throw new Error('Structural composition requires exactly one hero');
 const placements=archetypePlacements(scene);
 /** Eight distinct non-centre zones keep a hero plus up to eight unplaced
  *  supports from stacking two objects on the same rect. */
 const SUPPORT_ZONES:LayoutZone[]=['upper_left','upper_right','lower_left','lower_right','left','right','top','bottom'];
 /** Lowest height a fit-to-safe shrink may leave an object at. */
 const ALT_MIN_H=60;
 const objects:CompiledObject[]=[],remaining=[...scene.objects];const childIndex=new Map<string,number>();let support=0;
 while(remaining.length){const index=remaining.findIndex(o=>!o.parentId||objects.some(p=>p.id===o.parentId));if(index<0)throw new Error('Unresolved parent');const o=remaining.splice(index,1)[0];
  /** An asset is geometry with anchors; the compiler draws it in any layout. This
   *  used to throw, and the fallback demoted the concept to a bare label, which is
   *  why boxes rendered empty. The archetype list now only affects ranking. */
  const asset=o.assetRef?resolveAsset(o.assetRef,catalog):undefined;
  if(asset)for(const state of o.allowedStates)if(state!=='hidden'&&!['before','after'].includes(state)&&!asset.states[state])throw new Error(`Asset does not implement state ${state}`);
  /** A structural hero has to share the band with its supports. At the fixed
   *  330x440 it filled the centre and left no room for eleven of them, so the
   *  supports landed on it (measured: `structural_diagram n=12` overlapped
   *  n0/n7, n0/n8). Past eight supports the hero gives ground; the golden
   *  structural fixture has five, so its geometry is untouched. */
  const STRUCTURAL_SUPPORT_LIMIT=8;
  const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const hero=o.role==='hero',structuralHero=hero&&['structural_diagram','convergence'].includes(scene.archetype);
  const structuralCrowded=structuralHero&&scene.objects.filter(x=>!x.parentId&&x.role!=='hero'&&x.role!=='annotation'&&x.role!=='decorative_support').length>STRUCTURAL_SUPPORT_LIMIT;
  const w=structuralHero?(structuralCrowded?220:330):labelOnly?250:132,h=structuralHero?(structuralCrowded?300:440):labelOnly?44:132;
  /** `nest` is how many objects already claimed this zone. It was ignored, so
   *  the ninth unplaced object reused zone 0 and landed on the same rect as the
   *  first. nest 0 is `zoneRect` unchanged, so existing scenes keep byte-identical
   *  output; later claimants shrink toward a corner inside their zone. */
  const zoneIndex=support;
  const zone=o.preferredZone??(hero?'center':SUPPORT_ZONES[support++%SUPPORT_ZONES.length]);
  const nest=o.preferredZone||hero?0:Math.floor(zoneIndex/SUPPORT_ZONES.length);
  let rect=placements.get(o.id)??nestedZoneRect(zone,w,h,nest);
  if(labelOnly&&rect){const native=scene.archetype==='equation_walkthrough'?44:44;rect={x:rect.x,y:rect.y+(rect.h-native)/2,w:rect.w,h:native};}
  const parent=o.parentId?objects.find(p=>p.id===o.parentId):undefined;
  if(parent){
   const cw=Math.min(w,parent.w*.4),ch=Math.min(h,parent.h*.35);
   const px=zone.includes('left')?.2:zone.includes('right')?.8:.5;
   /** Children that share a zone on the same parent derange vertically, or two
    *  'lower_right' subparts would land on identical rects. */
   const slot=(childIndex.get(o.parentId!)??0);childIndex.set(o.parentId!,slot+1);
   const py=zone.includes('upper')?.18+[0,.34][slot%2]! as number:zone.includes('lower')?.58+[0,.26][slot%2]! as number:.4;
   rect={x:parent.x+(parent.w-cw)*px,y:parent.y+(parent.h-ch)*Math.min(1,py),w:cw,h:ch};if(o.collisionPolicy==='touch')rect.x=parent.x+parent.w;
  }
  /** A child's geometry is derived from its parent, so reusing the previous
   *  scene's rect would place it outside a parent that has moved or resized —
   *  an illegal containment violation with no repair path (children are excluded
   *  from every repair pass). Only roots may persist their geometry verbatim.
   *  Measured: scene 2 of a narrated run failed on exactly this. */
  if(parent&&scene.continuity.keepFromPrevious.includes(o.id))diagnostics.push(`continuity: re-derived child ${o.id} from its parent`);
  const old=!parent&&scene.continuity.keepFromPrevious.includes(o.id)?previous?.objects.find(x=>x.id===o.id):undefined;
  if(old){if(old.conceptId!==o.conceptId||old.assetRef!==o.assetRef)throw new Error('Persistent identity changed');rect={x:old.x,y:old.y,w:old.w,h:old.h};}
  const baseFontSize=scene.archetype==='numbered_steps'?24:scene.archetype==='equation_walkthrough'?24:labelOnly?22:20;
  /** A label is centred on its rect, so the widest it may fit is set by the
   *  NEARER safe edge, not by a flat 180px floor. A 120px support at x=76
   *  fitted a 180px label and escaped the band on the left - the
   *  cross_section and spatial_process canvas escape. */
  const centreX=rect.x+rect.w/2;
  const maxLabelWidth=Math.max(80,2*Math.min(centreX-BOARD.safe.x,BOARD.safe.x+BOARD.safe.w-centreX)-8);
  const fitted=fitLabel(o.label,Math.min(labelOnly?rect.w:Math.max(rect.w,180),maxLabelWidth),baseFontSize);
  if(fitted.truncated&&o.importance==='primary'&&o.primitiveRef!=='label')throw new Error(`Critical label would be truncated: ${o.id}`);
  if(fitted.fitted||fitted.truncated)diagnostics.push(`representation fallback: label "${o.label}" ${fitted.truncated?'truncated to three lines':'shrunk to '+fitted.fontSize+'px'} to fit (${o.id})`);
  const fontSize=fitted.fontSize,lines=fitted.lines;
  const compiled:CompiledObject={...o,...rect,anchors:{},fontSize,lines,zIndex:parent?parent.zIndex+1:hero?1:2};
  objects.push(compiled);
 }
 /** Fit-to-safe repair. The structural hero is 440px tall inside a 498px safe
  *  band, which leaves no room for the three-line label `fitLabel` permits (81px)
  *  beneath it: a hero plus its label needs up to 521px. Measured, that is
  *  exactly the `structural_diagram` and `convergence` canvas escape, and no
  *  later pass could fix it because the escape check runs after every repair.
  *  Objects that actually escape are shrunk about their own centre and re-fitted
  *  until they fit; objects that already fit are untouched, so existing scenes
  *  keep byte-identical geometry. */
 for(const o of objects){
  for(let attempt=0;attempt<10&&!contains(BOARD.safe,visualBounds(o));attempt++){
   const oldH=o.h;
   o.h=Math.max(ALT_MIN_H,Math.round(o.h*.92));
   o.y=Math.round(o.y+(oldH-o.h)/2);
   const only=o.primitiveRef==='label'||o.primitiveRef==='equation';
   const size=scene.archetype==='numbered_steps'?24:scene.archetype==='equation_walkthrough'?24:only?22:20;
   const refit=fitLabel(o.label,only?o.w:Math.max(o.w,180),size);
   o.fontSize=refit.fontSize;o.lines=refit.lines;
  }
 }
 const resolveAnchors=()=>{for(const o of objects){o.anchors={center:{x:o.x+o.w/2,y:o.y+o.h/2},input:{x:o.x,y:o.y+o.h/2},output:{x:o.x+o.w,y:o.y+o.h/2},top:{x:o.x+o.w/2,y:o.y},bottom:{x:o.x+o.w/2,y:o.y+o.h}};if(o.assetRef){const a=resolveAsset(o.assetRef,catalog),[vx,vy,vw,vh]=a.viewBox;for(const [name,p] of Object.entries(a.anchors))o.anchors[name]={x:o.x+(p.x-vx)/vw*o.w,y:o.y+(p.y-vy)/vh*o.h};}}};
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
  // General repair (Task 7.4) for the remaining archetypes: shrink secondary supports
  // and nudge non-hero objects within their own zone before declaring an illegal overlap.
  for(let pass=0;pass<3&&!['structural_diagram','convergence'].includes(scene.archetype)&&findCollisions(objects).length;pass++){
   for(const o of objects.filter(o=>!o.parentId&&o.role!=='hero'&&!['annotation','label'].includes(o.role)&&!scene.continuity.keepFromPrevious.includes(o.id))){
    const before=findCollisions(objects).length,original={x:o.x,y:o.y,w:o.w,h:o.h};
    for(const [dx,dy] of [[0,24],[0,-24],[24,0],[-24,0]]){
     o.x=original.x+dx;o.y=original.y+dy;
     if(contains(BOARD.safe,visualBounds(o))&&findCollisions(objects).length<before){diagnostics.push(`geometry repair: nudged ${o.id}`);break;}
     o.x=original.x;o.y=original.y;
    }
    if(findCollisions(objects).length>=before){
     for(const scale of [.9,.8]){
      o.w=original.w*scale;o.h=original.h*scale;
      if(contains(BOARD.safe,visualBounds(o))&&findCollisions(objects).length<before){diagnostics.push(`geometry repair: scaled ${o.id} to ${scale}`);break;}
      o.w=original.w;o.h=original.h;
     }
    }
    /** Same-zone nudge/scale can deadlock when two supports prefer adjacent
     *  zones with no free room between them. Fall back to the same
     *  zone-relocation search the structural branch uses, so a crowded
     *  non-structural scene repairs instead of failing the job. */
    if(findCollisions(objects).length>=before){
     const beforeCount=findCollisions(objects).length;let best={...original},bestCount=beforeCount,bestDistance=Infinity;
     for(const scale of [1,.9,.8])for(const zone of ['upper_left','upper_right','lower_left','lower_right','left','right'] as LayoutZone[]){
      Object.assign(o,zoneRect(zone,original.w*scale,original.h*scale));
      if(!contains(BOARD.safe,visualBounds(o)))continue;
      const count=findCollisions(objects).length,distance=Math.hypot(o.x-original.x,o.y-original.y)+(1-scale)*100;
      if(count<bestCount||(count===bestCount&&count<beforeCount&&distance<bestDistance)){best={x:o.x,y:o.y,w:o.w,h:o.h};bestCount=count;bestDistance=distance;}
     }
     Object.assign(o,best);if(bestCount<beforeCount)diagnostics.push(`geometry repair: relocated support ${o.id}`);
    }
   }
  }
 // Children were excluded from every pass above because moving them freely breaks
 // containment. They can still be repaired WITHIN their parent, which is where the
 // freedom actually is: shrink and re-seat a colliding child toward one of the
 // parent's quadrants until it clears. Measured: `Illegal overlap:
 // concept_1_dreaming_loop_1/concept_1_discovery_history_1` on two cycle subparts.
 for(const o of objects.filter(o=>o.parentId)){
  const parent=objects.find(p=>p.id===o.parentId);if(!parent)continue;
  for(let attempt=0;attempt<6&&findCollisions(objects).some(pair=>pair.split('/').includes(o.id));attempt++){
   o.w=Math.max(16,Math.round(o.w*.85));o.h=Math.max(12,Math.round(o.h*.85));
   const quadrant=(attempt%4);
   const fx=[.12,.68,.12,.68][quadrant],fy=[.12,.12,.68,.68][quadrant];
   o.x=Math.round(parent.x+(parent.w-o.w)*fx);
   o.y=Math.round(parent.y+(parent.h-o.h)*fy);
   diagnostics.push(`geometry repair: re-seated child ${o.id} inside ${parent.id}`);
  }
 }
 // A child still colliding after re-seating inside its own parent means the
 // PARENTS are too close to each other, not the children. Relocate the parent
 // (never a hero or a persisted object) and re-seat the child inside it.
 // Measured: `Illegal overlap: concept_1_kv_cache_1/concept_1_latent_vector_1`,
 // two subparts of two different ring nodes.
 for(const o of objects.filter(o=>o.parentId)){
  if(!findCollisions(objects).some(pair=>pair.split('/').includes(o.id)))continue;
  const parent=objects.find(p=>p.id===o.parentId);
  if(!parent||parent.role==='hero'||scene.continuity.keepFromPrevious.includes(parent.id))continue;
  const original={x:parent.x,y:parent.y};
  for(const [dx,dy] of [[0,32],[0,-32],[32,0],[-32,0],[0,64],[0,-64],[64,0],[-64,0]]){
   parent.x=original.x+dx;parent.y=original.y+dy;
   o.x=Math.round(parent.x+(parent.w-o.w)*.5);o.y=Math.round(parent.y+(parent.h-o.h)*.5);
   const clear=findCollisions(objects).filter(pair=>pair.split('/').includes(o.id)||pair.split('/').includes(parent.id));
   if(!clear.length&&contains(BOARD.safe,visualBounds(parent))&&contains(BOARD.safe,visualBounds(o))){
    diagnostics.push(`geometry repair: relocated parent ${parent.id} for child ${o.id}`);break;
   }
   parent.x=original.x;parent.y=original.y;
  }
 }
 const collisions=findCollisions(objects);if(collisions.length)throw Object.assign(new Error(`Illegal overlap: ${collisions.join(', ')}`),{compiledObjects:objects.map(o=>({id:o.id,role:o.role,parentId:o.parentId,collisionPolicy:o.collisionPolicy,x:Math.round(o.x),y:Math.round(o.y),w:o.w,h:o.h}))});
 for(const o of objects)if(!contains(BOARD.safe,visualBounds(o)))throw new Error(`Canvas escape: ${o.id}`);
 resolveAnchors();
 // Non-directional symbols expose facing flow ports; physical subpart anchors stay fixed.
  for(const o of objects){if(!o.assetRef||resolveAsset(o.assetRef,catalog).flowPortPolicy!=='facing')continue;const ports={input:{...o.anchors.input},output:{...o.anchors.output}};
   for(const name of ['input','output']){const outgoing=scene.relations.filter(r=>r.from.objectId===o.id&&r.from.anchor===name&&r.relationType==='flows_to');if(!outgoing.length)continue;
    for(const r of outgoing)if(!objects.find(t=>t.id===r.to.objectId)!.anchors[r.to.anchor]){diagnostics.push(`representation fallback: anchor ${r.to.anchor} unavailable; degraded to center (${r.id})`);r.to.anchor='center';}
    const targets=outgoing.map(r=>objects.find(t=>t.id===r.to.objectId)!.anchors[r.to.anchor]);const meanX=targets.reduce((n,p)=>n+p.x,0)/targets.length;o.anchors[name]=meanX<o.x+o.w/2?ports.input:ports.output;
   }
  }
 // A simple cycle has one incoming/outgoing port per node. Face each port toward its neighbor.
 if(scene.archetype==='cycle')for(const r of scene.relations){const from=objects.find(o=>o.id===r.from.objectId)!,to=objects.find(o=>o.id===r.to.objectId)!;
  for(const [o,target,name] of [[from,to,r.from.anchor],[to,from,r.to.anchor]] as const){if(!['input','output'].includes(name))continue;const b=visualBounds(o),cx=b.x+b.w/2,cy=b.y+b.h/2,dx=target.x+target.w/2-cx,dy=target.y+target.h/2-cy,scale=1/Math.max(Math.abs(dx)/(b.w/2+10),Math.abs(dy)/(b.h/2+10));o.anchors[name]={x:cx+dx*scale,y:cy+dy*scale};}
 }
  // Final safety net (Wave 3): an unroutable connector degrades to a direct line
  // with a visible diagnostic instead of failing the scene. The bounded
  // re-direction in the director still gets first attempt at better geometry for
  // overlap/escape failures; routing alone never kills a job.
  const relations=scene.relations.map(r=>{
   const routed={...r};
   if(['hierarchy','equation_walkthrough'].includes(scene.archetype)){routed.from={...r.from,anchor:'bottom'};routed.to={...r.to,anchor:'top'};}
   try{return routeRelation(routed,objects,{direct:scene.archetype==='equation_walkthrough'});}
   catch{
    const from=objects.find(o=>o.id===r.from.objectId)!,to=objects.find(o=>o.id===r.to.objectId)!;
    const a=from.anchors[r.from.anchor]??from.anchors.center,b=to.anchors[r.to.anchor]??to.anchors.center;
    diagnostics.push(`representation fallback: no safe connector route for ${r.id}; using direct line`);
    return {...r,points:[a,b]};
   }
  }),timing=structuredClone(timingInput??estimatedTiming(scene)),actions=compileTimeline(scene,timing,diagnostics);
 if(['structural_diagram','convergence','cross_section','spatial_process'].includes(scene.archetype)){const metrics=occupancy(objects);if(metrics.heroRatio<.3)diagnostics.push('Weak hero salience');if(metrics.areaRatio<.2)diagnostics.push('Low structural occupancy');}
 const gaps=staticIntervals(scene,timing,actions);if(gaps.some(g=>g.endMs-g.startMs>MAX_STATIC_INTERVAL_MS))diagnostics.push(`Narrated static interval exceeds ${MAX_STATIC_INTERVAL_MS}ms`);
 return {version:2,scene,objects,relations,actions,timing,durationMs:timing.durationMs+650,diagnostics,...(catalog&&Object.keys(catalog).length?{assetCatalog:catalog}:{})};
}

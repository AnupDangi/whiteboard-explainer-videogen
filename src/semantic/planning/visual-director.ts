import {stageFailure} from '../repair.js';
import {log} from '../../shared/logger.js';
import {resolvedDirectionSchema} from '../identity/runtime-schemas.js';
import {directionToScene} from '../identity/intent-adapter.js';
import {visualSceneSchema,type Schema} from '../schemas.js';
import {validateVisualScene} from './validate.js';
import {directorPrompt} from './prompt-builder.js';
import {resolveRepresentation,primitiveFallbackNote} from '../identity/representation.js';
import {getAsset,canonicalAnchor} from '../assets/registry.js';
import {compileScene} from '../compiler/compile-scene.js';
import {zoneRect} from '../compiler/zones.js';
import {archetypePlacements} from '../compiler/archetypes.js';
import type {ConceptIdentity,SemanticScenePlan,VisualSceneV2,CompiledSceneV2} from '../types.js';
import type {VisualModel} from './visual-model.js';
import type {JsonModel} from './model-adapter.js';
import type {WhiteboardPlan} from '../harness/contracts.js';
import {skillInstruction} from '../skills.js';
export interface DirectionDecisions {centralTeachingObject:string;firstFocus:string;illustratedConcepts:string;labelsOnly:string;movingRelations:string;persistentContext:string;stateChanges:string;omit:string}
const decisionKeys=['centralTeachingObject','firstFocus','illustratedConcepts','labelsOnly','movingRelations','persistentContext','stateChanges','omit'];
const decisionSchema:Schema={type:'object',additionalProperties:false,required:decisionKeys,properties:Object.fromEntries(decisionKeys.map(k=>[k,{type:'string',maxLength:600}]))};
const schema:Schema={type:'object',additionalProperties:false,required:['direction','decisions'],properties:{direction:resolvedDirectionSchema,decisions:decisionSchema}};
/** Deterministic continuity heal: a PRESERVE diff whose visual re-draws the
 *  concept is converted to a highlight, so the preserved object is emphasized
 *  instead of re-introduced (recorded by the caller). */
export function healPreservedRedraws(scene:VisualSceneV2,board:WhiteboardPlan):number{
 if(board.beats.length!==scene.beats.length)return 0;
 let healed=0;
 for(const [index,boardBeat] of board.beats.entries()){
  const visual=scene.beats[index];
  const conceptOf=(objectId:string)=>scene.objects.find(object=>object.id===objectId)?.conceptId;
  for(const diff of boardBeat.diffs){
   if(diff.operation!=='PRESERVE')continue;
   for(const key of diff.semanticKeys)for(const action of visual.actions){
    if(action.type!=='draw')continue;
    if(!action.objectIds.some(id=>conceptOf(id)===key))continue;
    action.type='highlight';action.id=`${action.id}_preserved`;healed++;
   }
  }
 }
 return healed;
}
/** Resolver results are scoped to the archetype the director will actually use.
 *  Resolving against the whole `candidateArchetypes` union offered assets that
 *  the selected archetype cannot carry (measured: `data.value.v2` for a
 *  `cause_effect` scene), which the compiler then stripped to a label — read
 *  downstream as an unexplained representation degradation. `candidateArchetypes[0]`
 *  is the one the director is instructed to use and the one validate clamps to. */
function archetypeSort(model:VisualModel){const primary=model.candidateArchetypes[0];return (a:{archetypes:string[]},b:{archetypes:string[]})=>(b.archetypes.includes(primary)?1:0)-(a.archetypes.includes(primary)?1:0);}
export function assetCandidates(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel){const selected=[model.candidateArchetypes[0]];return scene.requiredConceptIds.map(id=>{const concept=registry.find(c=>c.id===id)!;const decision=resolveRepresentation({id:concept.id,canonicalName:concept.canonicalName,aliases:concept.aliases,semanticType:concept.semanticType,visualFamily:concept.visualFamily},selected);return {conceptId:id,candidates:decision.candidates.map(c=>{const a=getAsset(c.id);return {id:a.id,aliases:a.aliases,anchors:Object.keys(a.anchors),semanticAnchorAliases:a.anchorAliases??{},states:Object.keys(a.states),archetypes:a.archetypes};}).sort(archetypeSort(model)),fallback:decision.fallback,representation:decision.representation,warnings:decision.warnings};});}
export function representationWarnings(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel):string[]{return assetCandidates(scene,registry,model).flatMap(c=>c.warnings);}
/** Every initial or repaired direction passes this same teaching contract. */
export function validateDirectedScene(raw:VisualSceneV2,scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,allowedAssets:Set<string>,previous?:CompiledSceneV2):VisualSceneV2{
 const visual=validateVisualScene(raw,new Set(registry.map(c=>c.id)),new Set(previous?.objects.map(o=>o.id)));
 if(visual.id!==scene.id)throw new Error('Director changed scene identity');
 if(!mentalModel.candidateArchetypes.includes(visual.archetype))throw new Error('Director chose unavailable mental model');
 if(!visual.objects.some(o=>o.role==='hero'&&o.conceptId===scene.centralConceptId))throw new Error('Director changed central teaching object');
 for(const o of visual.objects)if(o.representation&&o.assetRef)throw new Error('Object has two representations');
  /** The archetype is harness-owned (selectVisualModel); the prompt names it, so
   *  a model-returned mismatch is clamped to it (recorded). */
  if(visual.archetype!==mentalModel.candidateArchetypes[0]){log('v2.director.archetype-clamp',{scene:scene.id,from:visual.archetype,to:mentalModel.candidateArchetypes[0]});visual.archetype=mentalModel.candidateArchetypes[0];}
  /** Cycle contract synthesis: a cycle must be exactly one closed ring. When
   *  the model's graph does not form one, close it deterministically over the
   *  plan's primaries in beat order, reusing the plan's own relation type
   *  where one exists between the pair (recorded degradation). */
  if(visual.archetype==='cycle'){
   const primaryIds=visual.objects.filter(o=>!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support').map(o=>o.id);
   const conceptOf=(id:string)=>visual.objects.find(o=>o.id===id)?.conceptId;
   const ringArcs=visual.relations.filter(r=>primaryIds.includes(r.from.objectId)&&primaryIds.includes(r.to.objectId)&&r.visualForm!=='none'&&!r.layoutFeedback&&!['labels','compares_with'].includes(r.relationType));
   const outgoingCount=(id:string)=>ringArcs.filter(r=>r.from.objectId===id).length;
   const visited=new Set<string>();
   let current=[...primaryIds].sort()[0];
   while(visited.size<primaryIds.length){
    visited.add(current);
    const next=ringArcs.filter(r=>r.from.objectId===current&&!visited.has(r.to.objectId));
    if(next.length!==1){break;}
    current=next[0].to.objectId;
   }
   if(visited.size<primaryIds.length||!ringArcs.some(r=>r.from.objectId===current&&r.to.objectId===[...primaryIds].sort()[0])){
    /** Repair: keep exactly one outgoing arc per node along the plan order. */
    const beatOrder=new Map<string,number>();
    scene.beats.forEach((b,i)=>{for(const key of [...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)])if(!beatOrder.has(key))beatOrder.set(key,i);});
    const order=[...primaryIds].sort((a,b)=>(beatOrder.get(conceptOf(a)!)??99)-(beatOrder.get(conceptOf(b)!)??99)||a.localeCompare(b));
    const start=order[0];
    const planArcType=(fromId:string,toId:string)=>{const from=conceptOf(fromId),to=conceptOf(toId);const arc=scene.requiredRelations.find(r=>r.fromConceptId===from&&r.toConceptId===to);return arc?.relationType??'flows_to';};
    for(let i=0;i<order.length;i++){
     const fromId=order[i],toId=order[(i+1)%order.length];
     const existing=ringArcs.filter(r=>r.from.objectId===fromId);
     if(existing.length===1&&existing[0].to.objectId===toId)continue;
     for(const r of existing)if(r.to.objectId!==toId){r.visualForm='none';log('v2.director.ring-heal',{scene:scene.id,dropped:`${r.from.objectId}->${r.to.objectId}`},'warn');}
     if(!ringArcs.some(r=>r.from.objectId===fromId&&r.to.objectId===toId)){
      const from=conceptOf(fromId),to=conceptOf(toId);
      const arc=scene.requiredRelations.find(r=>r.fromConceptId===from&&r.toConceptId===to);
      const newRelation={id:`relation_ring_${i}`,from:{objectId:fromId,anchor:'center'},to:{objectId:toId,anchor:'center'},relationType:arc?.relationType??'flows_to',visualForm:'flow',label:arc?.id??'cycle arc'} as VisualSceneV2['relations'][number];
      visual.relations.push(newRelation);ringArcs.push(newRelation);
      log('v2.director.ring-heal',{scene:scene.id,added:`${fromId}->${toId}`},'warn');
     }
    }
   }
  }
 for(const o of visual.objects)if(o.assetRef&&!allowedAssets.has(o.assetRef))throw new Error(`Director invented asset ${o.assetRef}`);
  /** Defence in depth for the resolver/compiler contract: an asset the selected
   *  archetype cannot carry must be rejected as a director choice (repairable
   *  once) rather than silently stripped by the compiler's fallback. */
  for(const o of visual.objects)if(o.assetRef&&!getAsset(o.assetRef).archetypes.includes(visual.archetype))throw new Error(`${o.assetRef} does not support ${visual.archetype}; choose a candidate whose archetypes include it, or a semantic composition`);
 for(const id of scene.requiredConceptIds)if(!visual.objects.some(o=>o.conceptId===id))throw new Error(`Director omitted concept ${id}`);
 if(visual.beats.length!==scene.beats.length)throw new Error('Director changed beat count');
 for(const [i,b] of scene.beats.entries())if(visual.beats[i].id!==b.id||visual.beats[i].narration!==b.narrationDraft)throw new Error(`Director changed narration/beat ${b.id}`);
 for(const r of visual.relations)for(const ref of [r.from,r.to]){
  const object=visual.objects.find(o=>o.id===ref.objectId)!;
  if(object.assetRef)ref.anchor=canonicalAnchor(object.assetRef,ref.anchor);
  const anchors=object.assetRef?Object.keys(getAsset(object.assetRef).anchors):['input','output','center','top','bottom'];
  if(!anchors.includes(ref.anchor)){
   /** A named anchor the asset does not implement (the live model said
    *  'exterior') degrades to 'center' with a diagnostic, mirroring the
    *  unroutable-relation degradation, instead of failing the whole stage. */
   log('v2.director.anchor-degraded',{scene:scene.id,object:object.id,from:ref.anchor,to:'center'},'warn');
   ref.anchor='center';
  }
 }
 for(const required of scene.requiredRelations){
  let relation=visual.relations.find(r=>{
   const from=visual.objects.find(o=>o.id===r.from.objectId)!,to=visual.objects.find(o=>o.id===r.to.objectId)!;
   if(from.conceptId!==required.fromConceptId||to.conceptId!==required.toConceptId||r.relationType!==required.relationType)return false;
   if(!required.targetAnchor)return true;
   const target=to.assetRef?canonicalAnchor(to.assetRef,required.targetAnchor):required.targetAnchor;
   return r.to.anchor===target;
  });
   /** A required relation is part of the teaching contract — the plan asserts
    *  the lesson needs it — so the harness realizes it when the direction omits
    *  it, exactly as cycle ring synthesis closes a ring. Measured: the director
    *  omitted a required relation on both scenes of a live run and the single
    *  targeted repair did not converge, failing the job. Recorded, never silent;
    *  relation coverage is a migration gate (100%). */
   if(!relation){
    const from=visual.objects.find(o=>o.conceptId===required.fromConceptId),to=visual.objects.find(o=>o.conceptId===required.toConceptId);
    if(!from||!to)throw new Error(`Missing semantic relation ${required.id}: a concept object is absent`);
    /** Only a relation *entirely absent* between the two concepts is synthesized.
     *  A relation that is present but reversed, mistyped or mis-anchored is a
     *  real direction error and stays strict: the one targeted repair must fix
     *  it, otherwise the wrong arc would render alongside a synthesized one. */
    const pairPresent=visual.relations.some(r=>{const a=visual.objects.find(o=>o.id===r.from.objectId),b=visual.objects.find(o=>o.id===r.to.objectId);return Boolean(a&&b&&((a.conceptId===required.fromConceptId&&b.conceptId===required.toConceptId)||(a.conceptId===required.toConceptId&&b.conceptId===required.fromConceptId)));});
    if(pairPresent)throw new Error(`Missing semantic relation ${required.id}: direction, type and target part are required`);
    const anchorNames=to.assetRef?Object.keys(getAsset(to.assetRef).anchors):['input','output','center','top','bottom'];
    const requested=required.targetAnchor?(to.assetRef?canonicalAnchor(to.assetRef,required.targetAnchor):required.targetAnchor):'center';
    /** Mirrors intent-adapter's relationType -> visualForm mapping. */
    const visualForm=required.relationType==='contains'||required.relationType==='part_of'?'containment':required.relationType==='flows_to'?'flow':required.relationType==='labels'?'leader':required.relationType==='compares_with'?'brace':'arrow';
    relation={id:`relation_synth_${required.id}`,from:{objectId:from.id,anchor:'center'},to:{objectId:to.id,anchor:anchorNames.includes(requested)?requested:'center'},relationType:required.relationType,visualForm} as VisualSceneV2['relations'][number];
    visual.relations.push(relation);
    log('v2.director.relation-synthesis',{scene:scene.id,relation:required.id,from:from.id,to:to.id,type:required.relationType,anchor:relation.to.anchor},'warn');
   }
  for(const b of scene.beats.filter(b=>b.relationFocus.includes(required.id))){
   const beat=visual.beats.find(v=>v.id===b.id)!;
   if(beat.actions.some(a=>a.relationIds.includes(relation.id)))continue;
   /** The plan's relation is its own animation: inject the action referencing
    *  the RUNTIME relation id (recorded) instead of failing the stage. */
   beat.actions.push({id:`${b.id}_rel_${required.id}`,type:'flow',objectIds:[],relationIds:[relation.id],durationMs:1500,leadMs:0,easing:'linear'});
   log('v2.director.relation-heal',{scene:scene.id,beat:b.id,relation:required.id},'warn');
  }
 }
 return visual;
}
export async function directVisual(scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,model:JsonModel,previous?:CompiledSceneV2,language?:string,resolved?:{candidates?:ReturnType<typeof assetCandidates>;sourceVisualIds?:string[];repairNotes?:string[];whiteboardPlan?:WhiteboardPlan;signal?:AbortSignal}):Promise<{scene:VisualSceneV2;decisions:DirectionDecisions}>{
 const candidates=resolved?.candidates??assetCandidates(scene,registry,mentalModel),allowedAssets=new Set(candidates.flatMap(c=>c.candidates.map(a=>a.id)));
 const fallbackNote=primitiveFallbackNote(candidates.filter(c=>!c.candidates.length&&!c.representation).map(c=>c.conceptId));
  const repairNote=resolved?.repairNotes?.length?`A previous direction failed these visual checks: ${resolved.repairNotes.join('; ')}. Correct exactly those objects, relations, anchors, states or actions and keep narration, beat IDs and concept coverage unchanged.`:'';
  /** The gate matches relations by exact concept pair, type and anchor; naming
   *  them removes a whole class of 'Missing semantic relation' failures. */
  const requiredRelationNote=scene.requiredRelations.length?`Every required relation must appear with these exact values: ${scene.requiredRelations.map(required=>`${required.fromConceptId} --${required.relationType}--> ${required.toConceptId}${required.targetAnchor?` (arriving at the target part "${required.targetAnchor}")`:''}`).join('; ')}. Set from/to to the objects whose conceptId matches, and copy the relation type verbatim.`:'';
 const instructions=[directorPrompt({archetype:mentalModel.candidateArchetypes[0],language,whiteboard:Boolean(resolved?.whiteboardPlan)}),requiredRelationNote,fallbackNote,repairNote,skillInstruction('visual-director')].filter(Boolean).join(' ');
  const directed=await model.generate('director',instructions,{semanticScene:scene,mentalModel,conceptRegistry:registry,candidateAssets:candidates,sourceVisualIds:resolved?.sourceVisualIds??[],whiteboardPlan:resolved?.whiteboardPlan??null,previousContinuity:previous?.scene.continuity??null},schema,value=>{
   const response=value as {scene?:VisualSceneV2;direction?:unknown;decisions:DirectionDecisions};
   if(response.scene){
    // Instrumented legacy passthrough (plan heal rule 24): kept for model
    // compatibility, recorded here so removal has data. Not silent.
    log('v2.director.legacy-scene-passthrough',{scene:scene.id,hasDirection:'direction' in response});
   }
   const result={scene:response.scene??directionToScene(response.direction,scene),decisions:response.decisions};
  for(const o of result.scene.objects){
   if(scene.requiredConceptIds.includes(o.conceptId??''))o.importance='primary';
   const choice=candidates.find(c=>c.conceptId===o.conceptId);
   if(choice?.representation&&!o.assetRef){o.representation=o.representation??choice.representation;if(o.representation.family!==choice.representation.family)throw new Error('Representation family changed');o.primitiveRef='rectangle';}
  }
  return {...result,scene:validateDirectedScene(result.scene,scene,registry,mentalModel,allowedAssets,previous)};
 },{signal:resolved?.signal}) as {scene:VisualSceneV2;decisions:DirectionDecisions};
 // Deterministic geometry repair belongs to the compiler, never another model call.
 let compiled;try{compiled=compileScene(directed.scene,undefined,previous);}catch(e){
   /** Phase 8: failed critical gates retain diagnostic partial artifacts. The
    *  directed geometry is dumped compactly so a layout wall can be analyzed
    *  without re-paying for the model call. */
   /** The placement pass runs the same layout that just failed, so it can throw
    *  again and swallow the original diagnostic. A missing placement map only
    *  costs the zone-rect fallback in the dump. */
   let placementMap;try{placementMap=archetypePlacements(directed.scene);}catch{placementMap=new Map();}
   log('v2.director.compile-failure',{scene:scene.id,archetype:directed.scene.archetype,error:e instanceof Error?e.message:String(e),objects:directed.scene.objects.map(o=>{const rect=placementMap.get(o.id);const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const hero=o.role==='hero',structuralHero=hero&&['structural_diagram','convergence'].includes(directed.scene.archetype);const w=structuralHero?330:labelOnly?250:132,h=structuralHero?440:labelOnly?44:132;const zone=o.preferredZone??(o.role==='hero'?'center':'upper_left');return {id:o.id,role:o.role,parentId:o.parentId,zone:o.preferredZone,primitive:o.primitiveRef,asset:o.assetRef,root:!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support',placed:Boolean(rect),rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)}:zoneRect(zone,w,h)};}),relations:directed.scene.relations.map(r=>`${r.from.objectId}->${r.to.objectId}:${r.relationType}:${r.visualForm}`),directedScene:directed.scene,compiledObjects:(e as {compiledObjects?:unknown}).compiledObjects??null},'error');
   throw stageFailure(e,'compile');}
 validateDirectedScene(compiled.scene,scene,registry,mentalModel,allowedAssets,previous);
  /** Post-compile integrity checks are owned by the representation resolver and
   *  the compiler, not by the director: the director cannot redraw pixels, and a
   *  repair call reproduced this failure byte-identically on the live run while
   *  costing another 15s. Routing it (typed REPRESENTATION) stops the director
   *  retry and surfaces the degradation where it belongs. */
  for(const o of directed.scene.objects)if(scene.requiredConceptIds.includes(o.conceptId??'')){const actual=compiled.objects.find(c=>c.id===o.id);if(actual?.assetRef!==o.assetRef||actual?.representation?.family!==o.representation?.family)throw stageFailure(new Error(`Critical representation degraded: ${o.id}`),'representation');}
  const hero=compiled.objects.find(o=>o.role==='hero');
  if(hero?.primitiveRef==='label'&&!['numbered_steps','timeline','trajectory'].includes(compiled.scene.archetype))throw stageFailure(new Error('Unrepresented structural hero: choose a semantic composition'),'representation');
 return directed;
}

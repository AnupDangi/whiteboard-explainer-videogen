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
export function assetCandidates(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel){return scene.requiredConceptIds.map(id=>{const concept=registry.find(c=>c.id===id)!;const decision=resolveRepresentation({id:concept.id,canonicalName:concept.canonicalName,aliases:concept.aliases,semanticType:concept.semanticType,visualFamily:concept.visualFamily},model.candidateArchetypes);return {conceptId:id,candidates:decision.candidates.map(c=>{const a=getAsset(c.id);return {id:a.id,aliases:a.aliases,anchors:Object.keys(a.anchors),semanticAnchorAliases:a.anchorAliases??{},states:Object.keys(a.states),archetypes:a.archetypes};}).filter(candidate=>candidate.archetypes.includes(model.candidateArchetypes[0])),fallback:decision.fallback,representation:decision.representation,warnings:decision.warnings};});}
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
 for(const o of visual.objects)if(o.assetRef&&!allowedAssets.has(o.assetRef))throw new Error(`Director invented asset ${o.assetRef}`);
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
  const relation=visual.relations.find(r=>{
   const from=visual.objects.find(o=>o.id===r.from.objectId)!,to=visual.objects.find(o=>o.id===r.to.objectId)!;
   if(from.conceptId!==required.fromConceptId||to.conceptId!==required.toConceptId||r.relationType!==required.relationType)return false;
   if(!required.targetAnchor)return true;
   const target=to.assetRef?canonicalAnchor(to.assetRef,required.targetAnchor):required.targetAnchor;
   return r.to.anchor===target;
  });
  if(!relation)throw new Error(`Missing semantic relation ${required.id}: direction, type and target part are required`);
  for(const b of scene.beats.filter(b=>b.relationFocus.includes(required.id))){
   if(!visual.beats.find(v=>v.id===b.id)!.actions.some(a=>a.relationIds.includes(relation.id)))throw new Error(`Untimed semantic relation ${required.id} in ${b.id}`);
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
   const placementMap=archetypePlacements(directed.scene);
   log('v2.director.compile-failure',{scene:scene.id,archetype:directed.scene.archetype,error:e instanceof Error?e.message:String(e),objects:directed.scene.objects.map(o=>{const rect=placementMap.get(o.id);const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const hero=o.role==='hero',structuralHero=hero&&['structural_diagram','convergence'].includes(directed.scene.archetype);const w=structuralHero?330:labelOnly?250:132,h=structuralHero?440:labelOnly?44:132;const zone=o.preferredZone??(o.role==='hero'?'center':'upper_left');return {id:o.id,role:o.role,parentId:o.parentId,zone:o.preferredZone,primitive:o.primitiveRef,asset:o.assetRef,root:!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support',placed:Boolean(rect),rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)}:zoneRect(zone,w,h)};}),relations:directed.scene.relations.map(r=>`${r.from.objectId}->${r.to.objectId}:${r.relationType}:${r.visualForm}`)},'error');
   throw stageFailure(e,'compile');}
 validateDirectedScene(compiled.scene,scene,registry,mentalModel,allowedAssets,previous);
 for(const o of directed.scene.objects)if(scene.requiredConceptIds.includes(o.conceptId??'')){const actual=compiled.objects.find(c=>c.id===o.id);if(actual?.assetRef!==o.assetRef||actual?.representation?.family!==o.representation?.family)throw new Error(`Critical representation degraded: ${o.id}`);}
 const hero=compiled.objects.find(o=>o.role==='hero');
 if(hero?.primitiveRef==='label'&&!['numbered_steps','timeline','trajectory'].includes(compiled.scene.archetype))throw new Error('Unrepresented structural hero: choose a semantic composition');
 return directed;
}

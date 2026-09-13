import {visualSceneSchema,type Schema} from '../schemas.js';
import {validateVisualScene} from './validate.js';
import {directorPrompt} from './prompt-builder.js';
import {searchAssets} from '../assets/search.js';
import {getAsset,canonicalAnchor} from '../assets/registry.js';
import {compileScene} from '../compiler/compile-scene.js';
import type {ConceptIdentity,SemanticScenePlan,VisualSceneV2,CompiledSceneV2} from '../types.js';
import type {VisualModel} from './visual-model.js';
import type {JsonModel} from './model-adapter.js';
export interface DirectionDecisions {centralTeachingObject:string;firstFocus:string;illustratedConcepts:string;labelsOnly:string;movingRelations:string;persistentContext:string;stateChanges:string;omit:string}
const decisionKeys=['centralTeachingObject','firstFocus','illustratedConcepts','labelsOnly','movingRelations','persistentContext','stateChanges','omit'];
const decisionSchema:Schema={type:'object',additionalProperties:false,required:decisionKeys,properties:Object.fromEntries(decisionKeys.map(k=>[k,{type:'string',minLength:1,maxLength:600}]))};
const schema:Schema={type:'object',additionalProperties:false,required:['scene','decisions'],properties:{scene:visualSceneSchema,decisions:decisionSchema}};
export function assetCandidates(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel){return scene.requiredConceptIds.map(id=>{const concept=registry.find(c=>c.id===id)!;const found=[concept.canonicalName,...concept.aliases].flatMap(name=>searchAssets({name,semanticType:concept.semanticType,archetype:model.candidateArchetypes[0],styleFamily:'chalk-ink-v2'}));return {conceptId:id,candidates:[...new Set(found.map(c=>c.id))].slice(0,8).map(id=>{const a=getAsset(id);return {id:a.id,aliases:a.aliases,anchors:Object.keys(a.anchors),semanticAnchorAliases:a.anchorAliases??{},states:Object.keys(a.states),archetypes:a.archetypes};})};});}
export async function directVisual(scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,model:JsonModel,previous?:CompiledSceneV2):Promise<{scene:VisualSceneV2;decisions:DirectionDecisions}>{
 const candidates=assetCandidates(scene,registry,mentalModel),allowedAssets=new Set(candidates.flatMap(c=>c.candidates.map(a=>a.id)));
 for(const id of mentalModel.heroConceptIds)if(!candidates.find(c=>c.conceptId===id)?.candidates.length)throw new Error(`No teaching asset for hero concept ${id}`);
   const directed=await model.generate('director',directorPrompt({archetype:mentalModel.candidateArchetypes[0]}),{semanticScene:scene,mentalModel,conceptRegistry:registry,candidateAssets:candidates,previousContinuity:previous?.scene.continuity??null},schema,value=>{
  const result=value as {scene:VisualSceneV2;decisions:DirectionDecisions},visual=validateVisualScene(result.scene,new Set(registry.map(c=>c.id)),new Set(previous?.objects.map(o=>o.id)));
  if(visual.id!==scene.id)throw new Error('Director changed scene identity');if(!mentalModel.candidateArchetypes.includes(visual.archetype))throw new Error('Director chose unavailable mental model');
  if(!visual.objects.some(o=>o.role==='hero'&&mentalModel.heroConceptIds.includes(o.conceptId??'')))throw new Error('Director changed central teaching object');
  for(const o of visual.objects)if(o.assetRef&&!allowedAssets.has(o.assetRef))throw new Error(`Director invented asset ${o.assetRef}`);
  for(const relation of visual.relations)for(const ref of [relation.from,relation.to]){const object=visual.objects.find(o=>o.id===ref.objectId)!;if(object.assetRef)ref.anchor=canonicalAnchor(object.assetRef,ref.anchor);const anchors=object.assetRef?Object.keys(getAsset(object.assetRef).anchors):['input','output','center'];if(!anchors.includes(ref.anchor))throw new Error(`Unavailable semantic anchor ${ref.objectId}.${ref.anchor}`);}
  for(const id of scene.requiredConceptIds)if(!visual.objects.some(o=>o.conceptId===id))throw new Error(`Director omitted concept ${id}`);
  if(visual.beats.length!==scene.beats.length)throw new Error('Director changed beat count');
  for(const [i,b] of scene.beats.entries())if(visual.beats[i].id!==b.id||visual.beats[i].narration!==b.narrationDraft)throw new Error(`Director changed narration/beat ${b.id}`);
  for(const required of scene.requiredRelations){const relation=visual.relations.find(r=>visual.objects.find(o=>o.id===r.from.objectId)?.conceptId===required.fromConceptId&&visual.objects.find(o=>o.id===r.to.objectId)?.conceptId===required.toConceptId&&r.relationType===required.relationType&&(!required.targetAnchor||r.to.anchor===(visual.objects.find(o=>o.id===r.to.objectId)?.assetRef?canonicalAnchor(visual.objects.find(o=>o.id===r.to.objectId)!.assetRef!,required.targetAnchor):required.targetAnchor)));if(!relation)throw new Error(`Missing semantic relation ${required.id}`);for(const b of scene.beats.filter(b=>b.relationFocus.includes(required.id)))if(!visual.beats.find(v=>v.id===b.id)!.actions.some(a=>a.relationIds.includes(relation.id)))throw new Error(`Untimed relation ${required.id}`);}
  return {...result,scene:visual};
 }) as {scene:VisualSceneV2;decisions:DirectionDecisions};
 // Geometry repair stays local; an impossible composition never buys another model attempt.
 compileScene(directed.scene,undefined,previous);
 return directed;
}

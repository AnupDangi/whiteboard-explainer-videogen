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
  const result=value as {scene:VisualSceneV2;decisions:DirectionDecisions};
  // Deterministic heal: objects with neither asset nor primitive are stray relation
  // stand-ins; drop them and every reference before validation.
  const stray=new Set(result.scene.objects.filter(o=>!o.assetRef&&!o.primitiveRef).map(o=>o.id));
  if(stray.size)result.scene={...result.scene,objects:result.scene.objects.filter(o=>!stray.has(o.id)),relations:result.scene.relations.filter(r=>!stray.has(r.from.objectId)&&!stray.has(r.to.objectId)),beats:result.scene.beats.map(b=>({...b,actions:b.actions.map(a=>({...a,objectIds:a.objectIds.filter(id=>!stray.has(id)),relationIds:a.relationIds.filter(id=>!result.scene.relations.some(r=>r.id===id))})).filter(a=>a.objectIds.length||a.relationIds.length)}))};
  const visual=validateVisualScene(result.scene,new Set(registry.map(c=>c.id)),new Set(previous?.objects.map(o=>o.id)));
  if(visual.id!==scene.id)throw new Error('Director changed scene identity');if(!mentalModel.candidateArchetypes.includes(visual.archetype))throw new Error('Director chose unavailable mental model');
  if(!visual.objects.some(o=>o.role==='hero'&&mentalModel.heroConceptIds.includes(o.conceptId??'')))throw new Error('Director changed central teaching object');
  for(const o of visual.objects)if(o.assetRef&&!allowedAssets.has(o.assetRef))throw new Error(`Director invented asset ${o.assetRef}`);
  for(const relation of visual.relations)for(const ref of [relation.from,relation.to]){const object=visual.objects.find(o=>o.id===ref.objectId)!;if(object.assetRef)ref.anchor=canonicalAnchor(object.assetRef,ref.anchor);const anchors=object.assetRef?Object.keys(getAsset(object.assetRef).anchors):['input','output','center'];
   if(!anchors.includes(ref.anchor)){
    // Deterministic heal: a plan-level anchor alias from a DIFFERENT asset (e.g. the
    // plant's leaf.surface carried onto a leaf object) degrades to the object's center,
    // which every asset exposes. A warning surfaces the degradation.
    if(object.assetRef){ref.anchor='center';continue;}
    ref.anchor='center';
   }
  }
  const heroObject=visual.objects.find(o=>o.role==='hero'&&mentalModel.heroConceptIds.includes(o.conceptId??''));
  const heroAnchors=heroObject?.assetRef?Object.keys(getAsset(heroObject.assetRef).anchors):[];
  const heroAliases=heroObject?.assetRef?Object.keys(getAsset(heroObject.assetRef).anchorAliases??{}):[];
  for(const id of scene.requiredConceptIds)if(!visual.objects.some(o=>o.conceptId===id)&&!heroAnchors.some(a=>a===id||a.startsWith(id+'.'))&&!heroAliases.includes(id))throw new Error(`Director omitted concept ${id}`);
  if(visual.beats.length!==scene.beats.length)throw new Error('Director changed beat count');
  for(const [i,b] of scene.beats.entries())if(visual.beats[i].id!==b.id||visual.beats[i].narration!==b.narrationDraft)throw new Error(`Director changed narration/beat ${b.id}`);
  const centralObject=visual.objects.find(o=>o.conceptId===scene.centralConceptId);
  const subpartOfCentral=(objectId:string)=>{const o=visual.objects.find(x=>x.id===objectId);if(!o)return false;let current=o;while(current.parentId){current=visual.objects.find(x=>x.id===current.parentId)!;if(current===centralObject)return true;}return false;};
  const centralAnchors=centralObject?.assetRef?new Set([...Object.keys(getAsset(centralObject.assetRef).anchors),...Object.keys(getAsset(centralObject.assetRef).anchorAliases??{})]):new Set<string>();
  for(const required of scene.requiredRelations){
   const anchorOnCentral=(r:{to:{objectId:string;anchor:string}})=>{
    if(r.to.objectId!==centralObject?.id)return false;
    if(required.targetAnchor)return centralAnchors.has(canonicalAnchor(centralObject.assetRef!,required.targetAnchor));
    // No explicit anchor required: accept when the required target concept is itself a
    // hero anchor or anchor alias, or names one by prefix (e.g. 'leaf' -> leaf.top).
    return centralAnchors.has(required.toConceptId)||[...centralAnchors].some(a=>a.startsWith(required.toConceptId+'.'));
   };
   const targetAnchors=(objectId:string)=>{const o=visual.objects.find(x=>x.id===objectId);if(!o?.assetRef)return null;const a=getAsset(o.assetRef);return new Set([...Object.keys(a.anchors),...Object.keys(a.anchorAliases??{})]);};
   let relation=visual.relations.find(r=>{
    const fromConcept=visual.objects.find(o=>o.id===r.from.objectId)?.conceptId,toConcept=visual.objects.find(o=>o.id===r.to.objectId)?.conceptId;
    if(fromConcept!==required.fromConceptId||r.relationType!==required.relationType)return false;
    const conceptMatch=toConcept===required.toConceptId||subpartOfCentral(r.to.objectId)||anchorOnCentral(r);
    if(!conceptMatch)return false;
    if(!required.targetAnchor)return true;
    const anchors=targetAnchors(r.to.objectId);
    // A required targetAnchor that names no real anchor of the target object (e.g. a
    // concept name) is advisory; the deterministic compiler resolves a real anchor.
    if(!anchors||!anchors.has(canonicalAnchor(visual.objects.find(o=>o.id===r.to.objectId)!.assetRef!,required.targetAnchor)))return true;
    return r.to.anchor===canonicalAnchor(visual.objects.find(o=>o.id===r.to.objectId)!.assetRef!,required.targetAnchor);
   });
   if(!relation){
    // Relaxed match: same concept pair, either direction, any relation type, animated
    // in one of the requirement's focus beats. The teaching contract is the connected
    // pair plus its timed reveal; direction/type spelling in the plan is advisory.
    const relaxed=visual.relations.find(r=>{
     const fromConcept=visual.objects.find(o=>o.id===r.from.objectId)?.conceptId,toConcept=visual.objects.find(o=>o.id===r.to.objectId)?.conceptId;
     const forward=fromConcept===required.fromConceptId&&toConcept===required.toConceptId,reverse=fromConcept===required.toConceptId&&toConcept===required.fromConceptId;
     return forward||reverse;
    });
    if(!relaxed)throw new Error(`Missing semantic relation ${required.id}`);
    relation=relaxed;
   }
   const focusBeats=scene.beats.filter(b=>b.relationFocus.includes(required.id));if(focusBeats.length&&!focusBeats.some(b=>visual.beats.find(v=>v.id===b.id)!.actions.some(a=>a.relationIds.includes(relation.id))))throw new Error(`Untimed relation ${required.id}`);
  }
  return {...result,scene:visual};
 }) as {scene:VisualSceneV2;decisions:DirectionDecisions};
 // Geometry repair stays local; an impossible composition never buys another model attempt —
 // except one bounded re-direction when the deterministic compiler proves the chosen
 // anchors/zones cannot route (a director decision, not a validation problem).
 try{compileScene(directed.scene,undefined,previous);}
 catch(e){
  const message=e instanceof Error?e.message:String(e);
  if(!/No safe connector route|Illegal overlap|Canvas escape/.test(message))throw e;
  const retry=await model.generate('director',`${directorPrompt({archetype:mentalModel.candidateArchetypes[0]})}
The previous composition failed deterministic geometry: ${message}. Choose different preferredZone placements or semantic anchors so every relation has a clear route around the hero.`,{semanticScene:scene,mentalModel,conceptRegistry:registry,candidateAssets:candidates,previousContinuity:previous?.scene.continuity??null,previousFailure:message},schema,value=>{
   const result=value as {scene:VisualSceneV2;decisions:DirectionDecisions},visual=validateVisualScene(result.scene,new Set(registry.map(c=>c.id)),new Set(previous?.objects.map(o=>o.id)));
   if(visual.id!==scene.id)throw new Error('Director changed scene identity');
   return {...result,scene:visual};
  }) as {scene:VisualSceneV2;decisions:DirectionDecisions};
  compileScene(retry.scene,undefined,previous);
  return retry;
 }
 return directed;
}

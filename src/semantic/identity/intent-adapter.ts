import type {TeachingPlanV2,VisualSceneV2,SemanticScenePlan} from '../types.js';
import {log} from '../../shared/logger.js';
import {bridgeVisualState} from '../harness/state.js';
/** Structural translation only; domain validation still runs after resolution. */
export function teachingIntentToPlan(value:any):TeachingPlanV2{
 if(value.scenes?.[0]?.id)return value; // Stored/manual legacy contract.
 const {conceptRegistry,requiredMechanisms,scenes,...rest}=value;
 return {...rest,
 conceptRegistry:conceptRegistry.map(({key,...c}:any)=>({...c,id:key})),
 requiredMechanisms:requiredMechanisms.map(({conceptKeys,...m}:any)=>({...m,conceptIds:conceptKeys})),
 scenes:scenes.map(({key,centralConceptKey,requiredConceptKeys,requiredRelations,beats,...s}:any)=>({...s,id:key,centralConceptId:centralConceptKey,requiredConceptIds:requiredConceptKeys,
 requiredRelations:requiredRelations.map(({key,fromConcept,toConcept,relation,targetPart}:any)=>({id:key,fromConceptId:fromConcept,toConceptId:toConcept,relationType:relation,...(targetPart?{targetAnchor:targetPart}:{})})),
 beats:beats.map(({key,transform,...b}:any)=>({...b,id:key,transform:transform.map(({conceptKey,...t}:any)=>({...t,conceptId:conceptKey}))}))}))};
}
export function directionToScene(direction:any,semantic:SemanticScenePlan):VisualSceneV2{
 const containment=['structural_diagram','convergence','cross_section','spatial_process'].includes(direction.archetype),dropped:string[]=[];
 const objects=direction.objects.map(({conceptKey,parentConceptKey,children,...o}:any)=>({...o,id:`object_${conceptKey}`,conceptId:conceptKey,children:[],...(containment&&parentConceptKey?{parentId:`object_${parentConceptKey}`}:{})}));
 for(const declared of direction.objects){
  const childKeys=(declared.children??[]).filter((k:any)=>k!==declared.conceptKey);
  if(!containment){if(declared.parentConceptKey)dropped.push(declared.conceptKey);dropped.push(...childKeys);continue;}
  for(const childKey of childKeys){
   const parent=objects.find((o:any)=>o.conceptId===declared.conceptKey),child=objects.find((o:any)=>o.conceptId===childKey);
   if(parent&&child&&!child.parentId)child.parentId=parent.id;
  }
 }
  if(dropped.length)log('v2.direction.parenting-heal',{scene:semantic.id,dropped:[...new Set(dropped)],archetype:direction.archetype});
  /** Parenting can arrive two ways (a `parentConceptKey`, or a parent's
   *  `children` list). The compiler places a child INSIDE its parent's rect, so
   *  a child left on the default `forbid` policy is an unconditional illegal
   *  overlap — only contain/overlay/allow/touch short-circuit the collision
   *  check. Normalise every parented object in one place. Recorded. */
  for(const o of objects)if(o.parentId&&o.collisionPolicy==='forbid'){o.collisionPolicy='contain';log('v2.direction.collision-policy-heal',{scene:semantic.id,object:o.id,parent:o.parentId,to:'contain'},'warn');}
 /** An object with neither asset nor primitive is not renderable: a labeled
  *  concept degrades to the tier-7 labeled abstraction, an unlabeled one to a
  *  rectangle (recorded), instead of failing the stage. */
 for(const o of objects)if(!o.assetRef&&!o.primitiveRef){o.primitiveRef=o.label?'label':'rectangle';log('v2.direction.primitive-heal',{scene:semantic.id,object:o.id,tier:o.label?'label':'rectangle'},'warn');}
 const objectFor=(key:string)=>{const found=objects.filter((o:any)=>o.conceptId===key);if(found.length!==1)throw new Error(`Ambiguous or missing concept ${key}`);return found[0];};
 for(const o of objects)if(o.parentId){const parent=objects.find((p:any)=>p.id===o.parentId);if(!parent)throw new Error(`Missing parent ${o.parentId}`);parent.children.push(o.id);}
 const form=(type:string)=>['contains','part_of'].includes(type)?'containment':type==='flows_to'?'flow':type==='labels'?'leader':type==='compares_with'?'brace':'arrow';
 const relations=direction.relations.map((r:any,i:number)=>({id:`relation_${i}`,from:{objectId:objectFor(r.fromConcept).id,anchor:r.sourcePart??'center'},to:{objectId:objectFor(r.toConcept).id,anchor:r.targetPart??'center'},relationType:r.relation,visualForm:form(r.relation)}));
 const relationFor=(ref:any)=>{const matches=relations.filter((r:any)=>r.from.objectId===objectFor(ref.fromConcept).id&&r.to.objectId===objectFor(ref.toConcept).id&&r.relationType===ref.relation&&(!ref.targetPart||r.to.anchor===ref.targetPart));if(matches.length!==1)throw new Error('Ambiguous or missing semantic relation reference');return matches[0].id;};
 /** The teaching plan's beat transforms are contracts: every transform the
  *  plan declares must reach its toState on screen, so a missing state change
  *  is synthesized as a morph on the concept's object (recorded). */
 const semanticById=new Map(semantic.beats.map((b:any)=>[b.id,b]));
 const beats=direction.beats.map((b:any,i:number)=>{
  const actions=b.actions.map(({conceptKeys,relationRefs,relationIds,...a}:any,j:number)=>{
   const mapped=relationRefs?.length?relationRefs.map(relationFor):((relationIds??[]).map((key:string)=>{
    /** The model may emit plan relation keys directly (refrigerant-to-compressor)
     *  instead of typed relationRefs: resolve through the plan's own relation
     *  list and drop unresolvable references (recorded). */
    const planRelation=(semantic.requiredRelations??[]).find((r:any)=>r.id===key);
    if(!planRelation)return null;
    try{return relationFor(planRelation);}catch{return null;}
   }).filter(Boolean) as string[]);
   if(relationIds?.length&&!relationRefs?.length)log('v2.direction.relation-ids-heal',{scene:semantic.id,action:a.id??j,dropped:(relationIds.length??0)-(mapped?.length??0)},'warn');
   return {...a,id:`action_${i}_${j}`,objectIds:(conceptKeys??[]).map((k:string)=>objectFor(k).id),relationIds:mapped??[]};
  });
  const semanticBeat=semantic.beats.find((sb:any)=>sb.id===b.key);
  for(const transform of semanticBeat?.transform??[]){
   const conceptId=transform.conceptId;
   const target=objects.find((o:any)=>o.conceptId===conceptId);
   if(!target)continue;
   if(actions.some((action:any)=>action.toState===transform.toState&&action.objectIds.includes(target.id)))continue;
    const toState=bridgeVisualState(transform.toState);
   target.allowedStates=[...new Set([...(target.allowedStates??[]),toState])];
   actions.push({id:`action_${i}_${actions.length}_state_${conceptId}`,type:'morph',objectIds:[target.id],relationIds:[],durationMs:1500,leadMs:0,easing:'linear',fromState:bridgeVisualState(transform.fromState),toState});
   log('v2.direction.state-heal',{scene:semantic.id,beat:b.key,concept:conceptId,toState:transform.toState});
  }
  return {id:b.key,narration:b.narration,...(b.intentionalPause?{intentionalPause:b.intentionalPause}:{}),actions};
 });
 return {version:2,id:semantic.id,title:direction.title,teachingGoal:direction.teachingGoal,mentalModel:direction.mentalModel,archetype:direction.archetype,objects,relations,beats,continuity:{keepFromPrevious:[],prepareForNext:[]}};
}

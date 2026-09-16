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
  const actions=b.actions.map(({conceptKeys,relationRefs,...a}:any,j:number)=>({...a,id:`action_${i}_${j}`,objectIds:conceptKeys.map((k:string)=>objectFor(k).id),relationIds:relationRefs.map(relationFor)}));
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

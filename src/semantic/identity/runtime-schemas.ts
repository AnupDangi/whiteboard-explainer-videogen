/** JSON-schema translation of the model-facing semantic contracts. Not the
 *  identity authority (`harness/registry.ts`).
 */
import {teachingPlanSchema,visualObjectSchema,visualActionSchema,type Schema} from '../schemas.js';
import {RELATIONS} from '../types.js';
import {SUPPORTED_ARCHETYPES} from '../compiler/zones.js';
const text:Schema={type:'string',minLength:1,maxLength:1800};
const key:Schema={type:'string',pattern:'^[a-z][a-z0-9_-]*$',minLength:1,maxLength:64};
const array=(items:Schema,maxItems=48,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const object=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:false});
function rename(schema:Schema,names:Record<string,string>):Schema{
 const copy=structuredClone(schema);copy.properties=Object.fromEntries(Object.entries(copy.properties!).map(([k,v])=>[names[k]??k,v]));copy.required=copy.required!.map(k=>names[k]??k);return copy;
}
const relationRefSchema=object({fromConcept:key,relation:{type:'string',enum:RELATIONS},toConcept:key,targetPart:{type:'string',minLength:1,maxLength:64},sourcePart:{type:'string',minLength:1,maxLength:64}},['targetPart','sourcePart']);
// Preserve source evidence and requirement references while moving concept/scene/beat
// references to semantic keys. Runtime IDs are generated after this boundary.
export const teachingIntentSchema=structuredClone(teachingPlanSchema);
const tp=teachingIntentSchema.properties!;
tp.conceptRegistry.items=rename(tp.conceptRegistry.items!,{id:'key'});
tp.requiredMechanisms.items=rename(tp.requiredMechanisms.items!,{conceptIds:'conceptKeys'});
tp.scenes.items=rename(tp.scenes.items!,{id:'key',centralConceptId:'centralConceptKey',requiredConceptIds:'requiredConceptKeys'});
const sp=tp.scenes.items!.properties!;
sp.beats.items=rename(sp.beats.items!,{id:'key'});
sp.beats.items!.properties!.transform.items=rename(sp.beats.items!.properties!.transform.items!,{conceptId:'conceptKey'});
// A semantic relation key remains only to identify the teaching requirement.
sp.requiredRelations.items=rename(sp.requiredRelations.items!,{id:'key',fromConceptId:'fromConcept',toConceptId:'toConcept',relationType:'relation',targetAnchor:'targetPart'});
const op=structuredClone(visualObjectSchema.properties!);
for(const k of ['id','conceptId','parentId','children'])delete op[k];
op.conceptKey=key;op.parentConceptKey=key;
op.children=array(key,32);
const semanticObjectSchema=object(op,['representation','assetRef','primitiveRef','preferredZone','parentConceptKey','children']);
const ap=structuredClone(visualActionSchema.properties!);
for(const k of ['id','objectIds','relationIds'])delete ap[k];
ap.conceptKeys=array(key,32);ap.relationRefs=array(relationRefSchema);
export const resolvedDirectionSchema=object({
 title:text,teachingGoal:text,mentalModel:text,archetype:{type:'string',enum:SUPPORTED_ARCHETYPES},
 objects:array(semanticObjectSchema,32,1),relations:array(relationRefSchema),
 beats:array(object({key,narration:text,actions:array(object(ap,['anchor','fromState','toState']),32,1),intentionalPause:text},['intentionalPause']),24,1)
});

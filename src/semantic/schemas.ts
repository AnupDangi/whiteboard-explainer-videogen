import {ARCHETYPES,MOTIONS,ROLES,ZONES,RELATIONS} from './types.js';
import type {TeachingPlanV2,VisualSceneV2} from './types.js';
/** Deliberately small JSON Schema subset; all generated contracts use only these keywords. */
export interface Schema {type:'object'|'array'|'string'|'number'|'integer'|'boolean';properties?:Record<string,Schema>;required?:string[];additionalProperties?:false;items?:Schema;minItems?:number;maxItems?:number;minLength?:number;maxLength?:number;pattern?:string;enum?:readonly (string|number)[];minimum?:number;maximum?:number}
const str=(maxLength=500):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={...str(64),pattern:'^[a-z][a-z0-9_-]*$'};
const asset:Schema={...str(100),pattern:'^[a-z][a-z0-9_-]*(\\.[a-z0-9_-]+)+$'};
const anchor:Schema={...str(64),pattern:'^[a-z][a-z0-9_.-]*$'};
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const arr=(items:Schema,maxItems=32,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:false});
const num=(minimum:number,maximum:number):Schema=>({type:'number',minimum,maximum});
const states=en(['neutral','highlighted','activated','before','after','hidden']);
const evidenceIds=arr(id);
const claim={id,statement:str(1000),critical:{type:'boolean'} as Schema,evidenceRefs:evidenceIds};
const continuity=obj({keepFromPrevious:arr(id),prepareForNext:arr(id)});
export const conceptSchema=obj({id,canonicalName:str(120),aliases:arr(str(120),12),semanticType:en(['entity','material','process','state','quantity','equation','location','role']),visualFamily:str(80),preferredColorRole:str(40),evidenceRefs:evidenceIds},['visualFamily','preferredColorRole']);
export const semanticBeatSchema=obj({id,purpose:str(),narrationDraft:str(1800),requirementIds:arr(id),introduce:arr(id),reinforce:arr(id),transform:arr(obj({conceptId:id,fromState:str(80),toState:str(80)})),relationFocus:arr(id),evidenceRefs:evidenceIds,intentionalPause:str(200)},['intentionalPause']);
export const semanticSceneSchema=obj({id,centralConceptId:id,teachingGoal:str(),learnerShouldUnderstand:str(),mentalModel:str(),beats:arr(semanticBeatSchema,24,1),requiredConceptIds:arr(id,48,1),requiredRelations:arr(obj({id,fromConceptId:id,toConceptId:id,relationType:en(RELATIONS),targetAnchor:anchor},['targetAnchor']),48),candidateArchetypes:arr(en(ARCHETYPES),4,1),continuity});
export const teachingPlanSchema=obj({version:{type:'integer',enum:[2]},lessonGoal:str(),learnerAssumption:str(),centralQuestion:str(),requiredClaims:arr(obj(claim),48,1),requiredMechanisms:arr(obj({...claim,conceptIds:arr(id,16,1),requiresStateChange:{type:'boolean'}}),32),conceptRegistry:arr(conceptSchema,100,1),scenes:arr(semanticSceneSchema,24,1),misconceptions:arr(obj({claim:str(),correction:str()}),12),evidenceRefs:arr(obj({id,sourceId:id,quote:str(3000)}),100)});
export const visualObjectSchema=obj({id,conceptId:id,label:str(120),role:en(ROLES),assetRef:asset,primitiveRef:en(['label','rectangle','circle','equation']),parentId:id,children:arr(id),state:states,allowedStates:arr(states,6,1),importance:en(['primary','secondary','tertiary']),preferredZone:en(ZONES),collisionPolicy:en(['forbid','allow','contain','overlay','touch'])},['conceptId','assetRef','primitiveRef','parentId','preferredZone']);
export const visualRelationSchema=obj({id,from:obj({objectId:id,anchor}),to:obj({objectId:id,anchor}),relationType:en(RELATIONS),visualForm:en(['arrow','flow','leader','brace','containment','none']),label:str(80)},['label']);
export const visualActionSchema=obj({id,type:en(MOTIONS),objectIds:arr(id,32),relationIds:arr(id,48),anchor:obj({text:str(120),occurrence:{type:'integer',minimum:0,maximum:30}}),durationMs:num(100,10000),leadMs:num(-300,300),easing:en(['linear','ease_in_out']),fromState:states,toState:states,destination:en(ZONES)},['anchor','fromState','toState','destination']);
export const visualSceneSchema=obj({version:{type:'integer',enum:[2]},id,title:str(100),teachingGoal:str(),mentalModel:str(),archetype:en(ARCHETYPES),objects:arr(visualObjectSchema,32,1),relations:arr(visualRelationSchema,48),beats:arr(obj({id,narration:str(1800),actions:arr(visualActionSchema,32,1),intentionalPause:str(200)},['intentionalPause']),24,1),continuity});
export function assertSchema(value:unknown,schema:Schema,path='$',depth=0):void {
  if(depth>30)throw new Error(`${path}: nesting limit`);
  if(schema.enum&&!schema.enum.includes(value as string))throw new Error(`${path}: invalid enum`);
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${path}: expected object`);
    const record=value as Record<string,unknown>;
    for(const key of Object.keys(record))if(!Object.hasOwn(schema.properties!,key))throw new Error(`${path}.${key}: additional property`);
    for(const key of schema.required!)if(!Object.hasOwn(record,key))throw new Error(`${path}.${key}: required`);
    for(const key of Object.keys(record))assertSchema(record[key],schema.properties![key],`${path}.${key}`,depth+1);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<schema.minItems!||value.length>schema.maxItems!)throw new Error(`${path}: array bounds`);
    value.forEach((v,i)=>assertSchema(v,schema.items!,`${path}[${i}]`,depth+1));
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||(schema.pattern&&!new RegExp(schema.pattern).test(value)))throw new Error(`${path}: invalid string`);
  }else if(schema.type==='boolean'){
    if(typeof value!=='boolean')throw new Error(`${path}: expected boolean`);
  }else if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))throw new Error(`${path}: invalid number`);
}
export function parseTeachingPlan(value:unknown):TeachingPlanV2 {assertSchema(value,teachingPlanSchema);return structuredClone(value) as TeachingPlanV2;}
export function parseVisualScene(value:unknown):VisualSceneV2 {assertSchema(value,visualSceneSchema);return structuredClone(value) as VisualSceneV2;}

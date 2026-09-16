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
const continuityDecision=obj({conceptId:id,action:en(['KEEP','MOVE','TRANSFORM','REPLACE','REMOVE','REINTRODUCE']),fromRepresentation:str(120),toRepresentation:str(120),fromState:states,toState:states},['fromRepresentation','toRepresentation','fromState','toState']);
const continuity=obj({keepFromPrevious:arr(id),prepareForNext:arr(id),transitions:arr(continuityDecision,48)},['transitions']);
export const conceptSchema=obj({id,canonicalName:str(120),aliases:arr(str(120),12),semanticType:en(['entity','material','process','state','quantity','equation','location','role']),visualFamily:str(80),preferredColorRole:str(40),evidenceRefs:evidenceIds},['visualFamily','preferredColorRole']);
export const semanticBeatSchema=obj({id,purpose:str(),narrationDraft:str(1800),requirementIds:arr(id),introduce:arr(id),reinforce:arr(id),transform:arr(obj({conceptId:id,fromState:str(80),toState:str(80)})),relationFocus:arr(id),evidenceRefs:evidenceIds,intentionalPause:str(200)},['intentionalPause']);
export const semanticSceneSchema=obj({id,centralConceptId:id,teachingGoal:str(),learnerShouldUnderstand:str(),mentalModel:str(),beats:arr(semanticBeatSchema,24,1),requiredConceptIds:arr(id,48,1),requiredRelations:arr(obj({id,fromConceptId:id,toConceptId:id,relationType:en(RELATIONS),targetAnchor:anchor},['targetAnchor']),48),candidateArchetypes:arr(en(ARCHETYPES),4,1),continuity});
export const teachingPlanSchema=obj({version:{type:'integer',enum:[2]},lessonGoal:str(),learnerAssumption:str(),centralQuestion:str(),requiredClaims:arr(obj(claim),48,1),requiredMechanisms:arr(obj({...claim,conceptIds:arr(id,16,1),requiresStateChange:{type:'boolean'}}),32),conceptRegistry:arr(conceptSchema,100,1),scenes:arr(semanticSceneSchema,24,1),misconceptions:arr(obj({claim:str(),correction:str()}),12),evidenceRefs:arr(obj({id,sourceId:id,quote:str(3000)},['sourceId','quote']),100)},['lessonGoal','learnerAssumption','centralQuestion']);
export const representationSchema=obj({family:en(['signal','quantity','component_group','container','system']),count:{type:'integer',minimum:1,maximum:12},value:num(0,1),phase:num(-1,1),cycles:{type:'integer',minimum:1,maximum:6},afterValue:num(0,1),afterPhase:num(-1,1)},['count','value','phase','cycles','afterValue','afterPhase']);
export const visualObjectSchema=obj({representation:representationSchema,id,conceptId:id,label:str(120),role:en(ROLES),assetRef:asset,primitiveRef:en(['label','rectangle','circle','equation']),parentId:id,children:arr(id),state:states,allowedStates:arr(states,6,1),importance:en(['primary','secondary','tertiary']),preferredZone:en(ZONES),collisionPolicy:en(['forbid','allow','contain','overlay','touch'])},['representation','conceptId','assetRef','primitiveRef','parentId','preferredZone']);
export const visualRelationSchema=obj({layoutFeedback:{type:"boolean"},id,from:obj({objectId:id,anchor}),to:obj({objectId:id,anchor}),relationType:en(RELATIONS),visualForm:en(['arrow','flow','leader','brace','containment','none']),label:str(80)},['label','layoutFeedback']);
export const visualActionSchema=obj({id,type:en(MOTIONS),objectIds:arr(id,32),relationIds:arr(id,48),anchor:obj({text:str(120),occurrence:{type:'integer',minimum:0,maximum:30}}),durationMs:num(100,10000),leadMs:num(-300,300),easing:en(['linear','ease_in_out']),fromState:states,toState:states},['anchor','fromState','toState']);
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
/** Deterministic heal before schema assertion: models in json_object mode sometimes
 *  emit an object-of-ids where the schema wants an array of ids, or an out-of-enum
 *  semanticType like 'part_of' for a subpart concept. Keys become values (for id
 *  arrays) or values pass through; unknown keys drop instead of failing. */
const SEMANTIC_TYPES=['entity','material','process','state','quantity','equation','location','role'];
/** Near-miss motion verbs models emit, mapped onto the implemented vocabulary.
 *  Every target MUST be a member of MOTIONS: an alias to a motion the renderer
 *  cannot animate heals valid-looking output into an invalid value. `move` was
 *  removed from MOTIONS, so a `move_to` alias would now point at nothing. */
const MOTION_ALIASES:Record<string,string>={activate:'fill',activation:'fill',emphasize:'highlight',emphasis:'highlight',transport:'flow',appear:'reveal',disappear:'fade',erase:'fade',draw_arrow:'trace'};

/** How a deterministic correction changes the model's meaning.
 *   NORMALIZATION       shape only — same meaning (unknown key dropped, list joined)
 *   SAFE_DETERMINISTIC  the contract already implied it (parent/child sync, clamping)
 *   SEMANTIC            the correction invents or alters instructional content */
export type HealClass='NORMALIZATION'|'SAFE_DETERMINISTIC'|'SEMANTIC';
export interface HealEvent{path:string;rule:string;classification:HealClass;before:unknown;after:unknown}
export type HealReporter=(event:HealEvent)=>void;

export function healSchema(value:unknown,schema:Schema,path='$',report?:HealReporter):unknown{
 const note=(rule:string,classification:HealClass,before:unknown,after:unknown)=>report?.({path,rule,classification,before,after});
 if(schema.type==='array'){
  if(Array.isArray(value))return value.map((v,i)=>healSchema(v,schema.items!,`${path}[${i}]`,report));
  if(value&&typeof value==='object'){
   note('object-to-array','NORMALIZATION',value,undefined);
   return Object.entries(value).map(([k,v])=>schema.items!.type==='string'?k:v).map(v=>healSchema(v,schema.items!,path,report));
  }
  return value;
 }
 if(schema.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value)){
  const record=value as Record<string,unknown>,out:Record<string,unknown>={};
  for(const key of Object.keys(record)){
   if(!Object.hasOwn(schema.properties!,key)){note('unknown-key-dropped','NORMALIZATION',{[key]:record[key]},undefined);continue;}
   out[key]=healSchema(record[key],schema.properties![key],`${path}.${key}`,report);
  }
  // Models emit "" for "not applicable" on optional fields (intentionalPause,
  // decisions): an empty string carries no meaning, so non-required fields
  // holding one are omitted instead of failing the whole call.
  for(const key of Object.keys(out))if(typeof out[key]==='string'&&!(out[key] as string).trim()&&!(schema.required??[]).includes(key)){note('empty-optional-dropped','NORMALIZATION',out[key],undefined);delete out[key];}
  // Subpart concepts arrive typed 'part_of' (a relation, not a type); they are entities.
  if(typeof out.semanticType==='string'&&!SEMANTIC_TYPES.includes(out.semanticType)){note('semantic-type-defaulted','SEMANTIC',out.semanticType,'entity');out.semanticType='entity';}
  // Missing required array fields default to empty arrays (never missing required scalars).
  for(const key of schema.required??[])if(!(key in out)&&schema.properties![key].type==='array'){note('required-array-defaulted','NORMALIZATION',undefined,[]);out[key]=[];}
  // A version field with a single-value enum defaults to that value when omitted.
  if(!('version' in out)){const v=schema.properties?.version;if(v?.type==='integer'&&v.enum?.length===1){note('version-defaulted','NORMALIZATION',undefined,v.enum[0]);out.version=v.enum[0];}}
  // A relative collision policy without a parent degrades to 'forbid' (standalone object).
  if(typeof out.collisionPolicy==='string'&&['contain','overlay','touch'].includes(out.collisionPolicy)&&!out.parentId){note('relative-policy-degraded','SAFE_DETERMINISTIC',out.collisionPolicy,'forbid');out.collisionPolicy='forbid';}
  // 'hidden' initial state normalizes to 'neutral': visibility is controlled by reveal
  // timing, and assets do not declare a hidden part set.
  if(out.state==='hidden'){note('hidden-state-normalised','NORMALIZATION','hidden','neutral');out.state='neutral';}
  if(Array.isArray(out.allowedStates)&&out.allowedStates.includes('hidden')){note('hidden-state-removed','NORMALIZATION',[...out.allowedStates],out.allowedStates.filter(st=>st!=='hidden'));out.allowedStates=out.allowedStates.filter(st=>st!=='hidden');}
  // Sync parent/child links: a parentId without a matching children entry is repaired.
  if(Array.isArray(out.objects)&&Array.isArray(out.beats)){
   const byId=new Map((out.objects as Array<{id:string;parentId?:string;children:string[]}>).map(o=>[o.id,o]));
   for(const o of out.objects as Array<{id:string;parentId?:string;children:string[]}>){
    if(o.parentId&&byId.has(o.parentId)){const parent=byId.get(o.parentId)!;if(!parent.children.includes(o.id)){note('parent-child-linked','SAFE_DETERMINISTIC',{child:o.id},parent.id);parent.children.push(o.id);}}
    const kept=(o.children??[]).filter(c=>byId.has(c)&&(byId.get(c)!.parentId===o.id));
    if(kept.length!==(o.children??[]).length)note('orphan-children-dropped','SAFE_DETERMINISTIC',o.children,kept);
    o.children=kept;
   }
  }
  // Action target purity: draw/reveal/fill carry objectIds only; trace/flow carry
  // relationIds only. Mixed targets are pruned to the primary side; a draw/reveal/fill
  // with relation targets only becomes a trace (the relation-motion verb).
  if(typeof out.type==='string'&&Array.isArray(out.objectIds)&&Array.isArray(out.relationIds)){
   const target=out as Record<string,unknown>;
   if(['draw','reveal','fill'].includes(out.type)){
    if(out.objectIds.length){if(out.relationIds.length){note('mixed-target-pruned','SAFE_DETERMINISTIC',{type:out.type,relationIds:out.relationIds},[]);target.relationIds=[];}}
    else if(out.relationIds.length){note('object-action-to-trace','SAFE_DETERMINISTIC',out.type,'trace');target.type='trace';}
   }
   if(['trace','flow'].includes(out.type)){
    if(out.relationIds.length){if(out.objectIds.length){note('mixed-target-pruned','SAFE_DETERMINISTIC',{type:out.type,objectIds:out.objectIds},[]);target.objectIds=[];}}
    else if(out.objectIds.length){note('relation-action-to-reveal','SAFE_DETERMINISTIC',out.type,'reveal');target.type='reveal';}
   }
  }
  // A scene with an empty requiredConceptIds inventory derives it from its beats'
  // introduce/reinforce/transform references plus the central concept.
  if(Array.isArray(out.requiredConceptIds)&&!out.requiredConceptIds.length&&Array.isArray(out.beats)){
   const derived=new Set<string>([out.centralConceptId as string]);
   for(const b of out.beats as Array<{introduce?:string[];reinforce?:string[];transform?:Array<{conceptId:string}>}>)
    for(const c of [...(b.introduce??[]),...(b.reinforce??[]),...(b.transform??[]).map(t=>t.conceptId)])derived.add(c);
   note('required-concepts-derived','SEMANTIC',[], [...derived]);
   out.requiredConceptIds=[...derived];
  }
  return out;
 }
 if(schema.type==='number'||schema.type==='integer'){
  // Out-of-bounds numbers clamp instead of failing (e.g. leadMs 1600 vs max 300).
  if(typeof value==='number'&&Number.isFinite(value)&&(schema.minimum!==undefined||schema.maximum!==undefined)){
   const clamped=Math.min(schema.maximum??Infinity,Math.max(schema.minimum??-Infinity,value));
   const result=schema.type==='integer'?Math.round(clamped):clamped;
   if(result!==value)note('number-clamped','NORMALIZATION',value,result);
   return result;
  }
 }
 if(schema.type==='string'&&schema.enum&&!schema.enum.includes(value as string)){
  if(value==='part_of'){note('part-of-normalised','NORMALIZATION',value,'entity');return 'entity';}
  const alias=MOTION_ALIASES[value as string];
  if(alias&&schema.enum.includes(alias)){note('motion-alias','NORMALIZATION',value,alias);return alias;}
  if(alias)note('motion-alias-unavailable','SEMANTIC',value,null);
 }
 if(schema.type==='string'&&Array.isArray(value)){
  // Models often emit a list where the contract wants one display string
  // (e.g. director decisions). Join deterministically; never invent content.
  const joined=value.filter(item=>typeof item==='string'&&item.trim()).map(item=>(item as string).trim()).join(', ');
  const result=joined.slice(0,(schema.maxLength??1000));
  note('list-joined','NORMALIZATION',value,result);
  return result;
 }
 return value;
}

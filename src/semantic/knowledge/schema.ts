import type {Schema} from '../schemas.js';
import {RELATIONS} from '../types.js';
import {SEMANTIC_TYPES} from './types.js';

/** Model-facing JSON schemas for the knowledge stage. Kept beside the types so
 *  the contract and the validator cannot drift. Images/coords/code are absent
 *  by construction (`Architecture_plan.md` §1, §68). */
const str=(maxLength:number):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]*$'};
const arr=(items:Schema,maxItems=48,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(key=>!optional.includes(key)),additionalProperties:false});

const evidence=obj({id,quote:str(600),section:str(120),chunkId:str(64)},['section','chunkId']);
const concept=obj({key:id,canonicalName:str(120),aliases:arr(str(120),12),semanticType:en(SEMANTIC_TYPES),evidenceRefs:arr(id)},['aliases','evidenceRefs']);
const relation=obj({from:id,to:id,type:en(RELATIONS),evidenceRefs:arr(id)},['evidenceRefs']);
const claim=obj({id,statement:str(500),critical:{type:'boolean'},evidenceRefs:arr(id,16,1),conceptKeys:arr(id,16)},['conceptKeys']);
const mechanism=obj({id,statement:str(500),conceptKeys:arr(id,16,1),evidenceRefs:arr(id,16,1)});
const prerequisite=obj({before:id,after:id,reason:str(200)},['reason']);
const term=obj({key:id,definition:str(240)});

export const graphFragmentSchema:Schema=obj({
  concepts:arr(concept,48,1),
  relations:arr(relation,48),
  claims:arr(claim,48),
  mechanisms:arr(mechanism,24),
  prerequisites:arr(prerequisite,48),
  terminology:arr(term,48),
  evidence:arr(evidence,48),
});

/** The reducer returns the same shape plus central concepts and a thesis. */
export const baseConceptGraphSchema:Schema=obj({
  version:{type:'integer',enum:[1]},
  concepts:arr(concept,64,1),
  relations:arr(relation,64),
  claims:arr(claim,64),
  mechanisms:arr(mechanism,32),
  prerequisites:arr(prerequisite,64),
  terminology:arr(term,64),
  evidence:arr(evidence,64),
  centralConcepts:arr(id,8),
  thesis:{type:'string',maxLength:600},
});

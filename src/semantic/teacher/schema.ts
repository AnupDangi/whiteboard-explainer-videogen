import type {Schema} from '../schemas.js';
import {RELATIONS} from '../types.js';
import {SUPPORTED_ARCHETYPES} from '../compiler/zones.js';

/** Model-facing teacher contract. Records are arrays of keyed entries because
 *  strict JSON schema structured output is more reliable with arrays than with
 *  arbitrary-key maps; the planner converts them to the record types. */
const str=(maxLength:number):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]*$'};
const arr=(items:Schema,maxItems=64,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(key=>!optional.includes(key)),additionalProperties:false});

const sceneContract=obj({
  id,
  sequence:{type:'integer',minimum:1,maximum:120},
  learningDelta:str(240),
  requiredConceptIds:arr(id,24,1),
  requiredRelations:arr(en(RELATIONS),48),
  mechanismIds:arr(id,16),
  evidenceRefs:arr(id,24),
  targetDurationSec:{type:'number',minimum:3,maximum:600},
  narrationIntent:str(400),
  candidateArchetypes:arr(en(SUPPORTED_ARCHETYPES),4,1),
  continuityIn:arr(id,24),
  continuityOut:arr(id,24),
});
const continuity=obj({throughline:str(300),persistentConceptIds:arr(id,24)});
const lessonGraph=obj({
  title:str(120),
  lessonGoal:str(300),
  targetDurationSec:{type:'number',minimum:3,maximum:3600},
  scenes:arr(sceneContract,120,1),
  continuity,
  endingGoal:str(240),
});
const lessonBible=obj({
  canonicalTerminology:arr(obj({key:id,definition:str(200)}),64),
  conceptIdentity:arr(obj({conceptId:id,canonicalName:str(120),aliases:arr(str(120),12)}),64),
  visualIdentity:arr(obj({conceptId:id,representationFamily:str(80),colorRole:str(40)},['colorRole']),64),
  analogies:arr(obj({conceptId:id,analogy:str(300)}),24),
  narrativeStyle:str(200),
  learnerLevel:str(60),
  persistentObjects:arr(id,24),
  introducedConceptsByScene:arr(obj({sceneId:id,conceptIds:arr(id,24)}),120),
  forbiddenRepetition:arr(str(200),24),
});
export const lessonPlanSchema:Schema=obj({lessonGraph,lessonBible});

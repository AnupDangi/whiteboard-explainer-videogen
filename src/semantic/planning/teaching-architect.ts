import {assertSchema,type Schema} from '../schemas.js';
import type {ConceptGraph,LearnerState,TeachingContract} from '../harness/contracts.js';
import type {SemanticScenePlan,TeachingPlanV2} from '../types.js';
import {contractsFromScene} from '../harness/state.js';
import type {JsonModel} from './model-adapter.js';
import type {ArchitectPromptOptions} from './prompt-builder.js';
import {architectPrompt} from './prompt-builder.js';

/** teaching-architect skill contract. Narration is deliberately absent: the
 *  architect never writes narration, the semantic beats own it. */
const str=(maxLength:number):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]*$'};
const arr=(items:Schema,maxItems=32,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:false});
const STRATEGIES=['intuition','analogy','worked-example','comparison','derivation','demonstration','causal-explanation','prediction','retrieval'] as const;
const contract=obj({
 beatKey:id,
 objective:str(300),
 motivation:str(300),
 prerequisites:arr(id),
 learnerDelta:obj({before:str(300),after:str(300),newConcepts:arr(id,8),reinforcedConcepts:arr(id,8)}),
 strategy:en(STRATEGIES),
 mechanismIds:arr(id,8),
 misconception:obj({claim:str(300),correction:str(300)}),
 checkpoint:obj({prompt:str(300),expectedUnderstanding:str(300),kind:en(['prediction','retrieval','explanation'])}),
 evidenceRefs:arr(id,16)
},['misconception','checkpoint']);
export const architectSchema=obj({contracts:arr(contract,24,1)});

export interface ArchitectStageInput {scene:TeachingPlanV2['scenes'][number];learnerState:LearnerState;conceptGraph:ConceptGraph;language?:string;chapter?:string;repairFindings?:string[]}

/** Validates the model contract list against the scene, graph and learner state. */
export function validateArchitectOutput(raw:unknown,input:ArchitectStageInput):TeachingContract[]{
 assertSchema(raw,architectSchema);
 const scene=input.scene,graph=input.conceptGraph;
 const concepts=new Set(graph.concepts.map(c=>c.id)),mechanisms=new Set(graph.mechanisms.map(m=>m.id)),evidence=new Set(graph.evidence.map(e=>e.id));
 const value=raw as {contracts:{beatKey:string;objective:string;motivation:string;prerequisites:string[];learnerDelta:{before:string;after:string;newConcepts:string[];reinforcedConcepts:string[]};strategy:TeachingContract['strategy'];mechanismIds:string[];misconception?:{claim:string;correction:string};checkpoint?:{prompt:string;expectedUnderstanding:string;kind:'prediction'|'retrieval'|'explanation'};evidenceRefs:string[]}[]};
 if(value.contracts.length!==scene.beats.length)throw new Error(`Architect returned ${value.contracts.length} contracts for ${scene.beats.length} beats`);
 return value.contracts.map((entry,index)=>{
  const beat=scene.beats[index];
  if(entry.beatKey!==beat.id)throw new Error(`Architect contract ${index} targets ${entry.beatKey}, expected ${beat.id}`);
  const allowed=new Set([...beat.introduce,...beat.reinforce,...beat.transform.map(t=>t.conceptId)]);
  for(const concept of [...entry.learnerDelta.newConcepts,...entry.learnerDelta.reinforcedConcepts])if(!allowed.has(concept))throw new Error(`Contract ${beat.id} references concept ${concept} outside its beat`);
  for(const prerequisite of entry.prerequisites)if(!concepts.has(prerequisite))throw new Error(`Unknown prerequisite ${prerequisite}`);
  for(const mechanism of entry.mechanismIds)if(!mechanisms.has(mechanism))throw new Error(`Unknown mechanism ${mechanism}`);
  for(const ref of entry.evidenceRefs)if(!evidence.has(ref))throw new Error(`Unknown evidence ${ref}`);
  return {
   id:`contract:${scene.id}:${index+1}`,sceneId:scene.id,objective:entry.objective,motivation:entry.motivation,
   prerequisites:[...new Set(entry.prerequisites)],learnerDelta:{before:entry.learnerDelta.before,after:entry.learnerDelta.after,newConcepts:[...new Set(entry.learnerDelta.newConcepts)],reinforcedConcepts:[...new Set(entry.learnerDelta.reinforcedConcepts)]},
   strategy:entry.strategy,mechanismIds:[...new Set(entry.mechanismIds)],
   misconception:entry.misconception?structuredClone(entry.misconception):undefined,
   checkpoint:entry.checkpoint?{beatId:`contract:${scene.id}:${index+1}`,...structuredClone(entry.checkpoint)}:undefined,
   evidenceRefs:[...new Set(entry.evidenceRefs)],narrationDraft:beat.narrationDraft,relationIds:[...beat.relationFocus]
  } satisfies TeachingContract;
 });
}

/** Grounded teaching-architect stage: one model call producing validated contracts. */
export async function architectContracts(input:ArchitectStageInput,model:JsonModel):Promise<TeachingContract[]>{
 const value=await model.generate('architect',architectPrompt({language:input.language,repairNotes:input.repairFindings,chapter:input.chapter}),{scene:input.scene,learnerState:input.learnerState,conceptGraph:{concepts:input.conceptGraph.concepts,aliases:input.conceptGraph.aliases,claims:input.conceptGraph.claims,mechanisms:input.conceptGraph.mechanisms,terminology:input.conceptGraph.terminology}},architectSchema,raw=>validateArchitectOutput(raw,input));
 return value as TeachingContract[];
}

/** Deterministic fallback keeps the prompt-only pipeline and mock fixtures intact. */
export function projectContracts(scene:TeachingPlanV2['scenes'][number],plan:TeachingPlanV2,state:LearnerState):TeachingContract[]{return contractsFromScene(scene,plan,state);}

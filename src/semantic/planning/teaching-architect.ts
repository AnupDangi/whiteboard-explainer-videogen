import {assertSchema,type Schema} from '../schemas.js';
import type {ConceptGraph,LearnerState,TeachingContract} from '../harness/contracts.js';
import type {SemanticScenePlan,TeachingPlanV2} from '../types.js';
import {contractsFromScene} from '../harness/state.js';
import type {JsonModel} from './model-adapter.js';
import type {ArchitectPromptOptions} from './prompt-builder.js';
import {architectPrompt} from './prompt-builder.js';
import {skillInstruction} from '../skills.js';

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
 objective:str(160),
 motivation:str(160),
 prerequisites:arr(id),
 learnerDelta:obj({before:str(160),after:str(160),newConcepts:arr(id,8),reinforcedConcepts:arr(id,8)}),
 strategy:en(STRATEGIES),
 mechanismIds:arr(id,8),
 misconception:obj({claim:str(200),correction:str(200)}),
 checkpoint:obj({prompt:str(200),expectedUnderstanding:str(200),kind:en(['prediction','retrieval','explanation'])}),
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
  /** Architect evidence references outside the compiled inventory are dropped
   *  (recorded) - the contract keeps its beat, timing and concepts; the
   *  grounding that the knowledge compiler could not provide was never real. */
  const knownEvidenceRefs=entry.evidenceRefs.filter(ref=>evidence.has(ref));
  if(knownEvidenceRefs.length<entry.evidenceRefs.length)log('v2.architect.evidence-heal',{contract:beat.id,dropped:entry.evidenceRefs.filter(ref=>!evidence.has(ref))},'warn');
  entry={...entry,evidenceRefs:knownEvidenceRefs};
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
export async function architectContracts(input:ArchitectStageInput,model:JsonModel,signal?:AbortSignal):Promise<TeachingContract[]>{
 const instructions=[architectPrompt({language:input.language,repairNotes:input.repairFindings,chapter:input.chapter}),skillInstruction('teaching-architect')].filter(Boolean).join(' ');
 const value=await model.generate('architect',instructions,{scene:input.scene,learnerState:input.learnerState,conceptGraph:{concepts:input.conceptGraph.concepts,aliases:input.conceptGraph.aliases,claims:input.conceptGraph.claims,mechanisms:input.conceptGraph.mechanisms,terminology:input.conceptGraph.terminology}},architectSchema,raw=>validateArchitectOutput(raw,input),{signal});
 return value as TeachingContract[];
}

/** Deterministic fallback keeps the prompt-only pipeline and mock fixtures intact. */
export function projectContracts(scene:TeachingPlanV2['scenes'][number],plan:TeachingPlanV2,state:LearnerState):TeachingContract[]{return contractsFromScene(scene,plan,state);}

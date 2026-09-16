import {createHash} from 'node:crypto';
import type {ConceptGraph,LearnerProfile,LearnerState,SemanticRegistrySnapshot,TeachingContract,WhiteboardPlan} from './contracts.js';
import type {CompiledSceneV2,ContinuityDecision,ObjectState,SemanticBeat,SemanticScenePlan,TeachingPlanV2,VisualObject,VisualSceneV2} from '../types.js';
import {normalizeSemanticKey} from '../identity/types.js';

export const stableHash=(value:unknown)=>createHash('sha256').update(stableJson(value)).digest('hex');
function stableJson(value:unknown):string{
 if(Array.isArray(value))return `[${value.filter(item=>item!==undefined).map(stableJson).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
const unique=(values:string[])=>[...new Set(values)];

export function defaultLearnerProfile(language='en'):LearnerProfile{return {level:'beginner',goals:[],language,assumedKnowledge:[]};}
export function initialLearnerState(profile:LearnerProfile):LearnerState{return {establishedConcepts:profile.assumedKnowledge.map(normalizeSemanticKey),activeMentalModels:[],terminology:{},unresolvedQuestions:[],misconceptionsAddressed:[],checkpoints:[],provenance:[]};}

export function conceptGraphFromPlan(plan:TeachingPlanV2,sourceVisuals:ConceptGraph['sourceVisuals']=[]):ConceptGraph{
 const aliases:Record<string,string>={};
 for(const concept of plan.conceptRegistry)for(const alias of [concept.id,concept.canonicalName,...concept.aliases]){const normalized=normalizeSemanticKey(alias),existing=aliases[normalized];if(existing&&existing!==concept.id)throw new Error(`Ambiguous canonical alias ${alias}: ${existing} or ${concept.id}`);aliases[normalized]=concept.id;}
 const prerequisites:ConceptGraph['prerequisites']=[],established=new Set<string>();
 for(const scene of plan.scenes)for(const beat of scene.beats){const introduced=beat.introduce.filter(c=>!established.has(c));for(const next of introduced)for(const before of beat.reinforce.filter(c=>established.has(c)))prerequisites.push({before,after:next,reason:`${beat.purpose}: ${before} is reinforced before ${next} is introduced`});for(const concept of [...beat.introduce,...beat.reinforce])established.add(concept);}
 return {version:1,concepts:structuredClone(plan.conceptRegistry),aliases,prerequisites:prerequisites.filter((edge,index,all)=>all.findIndex(other=>other.before===edge.before&&other.after===edge.after)===index),mechanisms:plan.requiredMechanisms.map(m=>({id:m.id,statement:m.statement,conceptIds:[...m.conceptIds],requiresStateChange:m.requiresStateChange,evidenceRefs:[...m.evidenceRefs]})),claims:plan.requiredClaims.map(c=>({id:c.id,statement:c.statement,critical:c.critical,evidenceRefs:[...c.evidenceRefs]})),terminology:Object.fromEntries(plan.conceptRegistry.map(c=>[c.id,{definition:c.canonicalName}])),quantities:plan.conceptRegistry.filter(c=>c.semanticType==='quantity').map(c=>({conceptId:c.id,value:c.canonicalName,evidenceRefs:[...c.evidenceRefs]})),evidence:structuredClone(plan.evidenceRefs),sourceVisuals:structuredClone(sourceVisuals)};
}

function inferStrategy(beat:SemanticBeat):TeachingContract['strategy']{
 const text=`${beat.purpose} ${beat.narrationDraft}`.toLowerCase();
 if(/calculate|solve|example|step/.test(text))return 'worked-example';if(/compare|versus|difference/.test(text))return 'comparison';if(/why|cause|because|leads to/.test(text))return 'causal-explanation';if(/imagine|think of|like a/.test(text))return 'analogy';return 'intuition';
}
export function contractsFromScene(scene:SemanticScenePlan,plan:TeachingPlanV2,state:LearnerState):TeachingContract[]{
 const requirements=new Map([...plan.requiredClaims,...plan.requiredMechanisms].map(r=>[r.id,r]));
 return scene.beats.map((beat,index)=>{
  const newConcepts=beat.introduce.filter(c=>!state.establishedConcepts.includes(c));
  const mechanismIds=beat.requirementIds.filter(id=>plan.requiredMechanisms.some(m=>m.id===id));
  const misconception=plan.misconceptions.find(m=>beat.narrationDraft.toLowerCase().includes(m.correction.toLowerCase().split(/\s+/)[0]??''));
  const checkpoint=mechanismIds.length||index===scene.beats.length-1?{beatId:`contract:${scene.id}:${index+1}`,prompt:`Explain ${beat.purpose.toLowerCase()} in your own words.`,expectedUnderstanding:scene.learnerShouldUnderstand,kind:'explanation' as const}:undefined;
  return {id:`contract:${scene.id}:${index+1}`,sceneId:scene.id,objective:beat.purpose,motivation:index===0?scene.teachingGoal:`This follows the established lesson model for ${scene.centralConceptId}.`,prerequisites:unique(beat.reinforce.filter(c=>!newConcepts.includes(c))),learnerDelta:{before:index===0?state.establishedConcepts.join(', ')||'lesson starting state':scene.beats[index-1].purpose,after:beat.purpose,newConcepts,reinforcedConcepts:unique(beat.reinforce)},strategy:inferStrategy(beat),mechanismIds,misconception:misconception?structuredClone(misconception):undefined,checkpoint,evidenceRefs:unique([...beat.evidenceRefs,...beat.requirementIds.flatMap(id=>requirements.get(id)?.evidenceRefs??[])]),narrationDraft:beat.narrationDraft,relationIds:[...beat.relationFocus]};
 });
}
export function whiteboardPlanFromContracts(scene:SemanticScenePlan,contracts:TeachingContract[]):WhiteboardPlan{
 return {sceneId:scene.id,archetypes:[...scene.candidateArchetypes],beats:contracts.map((contract,index)=>{
  const semanticKeys=unique([...contract.learnerDelta.newConcepts,...contract.learnerDelta.reinforcedConcepts]);
  const preserve=index===0?scene.continuity.keepFromPrevious:contract.learnerDelta.reinforcedConcepts;
  const introduce=contract.learnerDelta.newConcepts;
  const transforms=scene.beats[index].transform;
  return {contractId:contract.id,narration:contract.narrationDraft,semanticKeys,relations:scene.requiredRelations.filter(r=>contract.relationIds.includes(r.id)),diffs:[...(preserve.length?[{operation:'PRESERVE' as const,semanticKeys:unique(preserve),reason:'Retain established visual vocabulary'}]:[]),...(introduce.length?[{operation:'INTRODUCE' as const,semanticKeys:unique(introduce),reason:'Introduce this beat learner delta'}]:[]),...transforms.map(t=>({operation:'TRANSFORM' as const,semanticKeys:[t.conceptId],reason:'Teaching contract requires a state change',fromState:bridgeVisualState(t.fromState) as any,toState:bridgeVisualState(t.toState) as any}))]};
 })};
}
/** The teaching plan may declare domain-specific states (e.g.
 *  'high-pressure-gas'); the visual layer animates the six ObjectStates.
 *  A domain state maps to 'activated' - the object visibly changed - and the
 *  specific state is carried by narration and captions. */
export function bridgeVisualState(state?:string):ObjectState{return state&&(['neutral','highlighted','activated','before','after','hidden'] as string[]).includes(state)?state as ObjectState:'activated';}
export function advanceLearnerState(before:LearnerState,contracts:TeachingContract[],graph:ConceptGraph):LearnerState{
 const next=structuredClone(before);
 for(const contract of contracts){
  next.establishedConcepts=unique([...next.establishedConcepts,...contract.learnerDelta.newConcepts,...contract.learnerDelta.reinforcedConcepts]);
  next.provenance.push({beatId:contract.id,conceptIds:unique([...contract.learnerDelta.newConcepts,...contract.learnerDelta.reinforcedConcepts])});
  if(contract.checkpoint)next.checkpoints.push(contract.checkpoint);
  if(contract.misconception)next.misconceptionsAddressed=unique([...next.misconceptionsAddressed,contract.misconception.claim]);
  for(const concept of contract.learnerDelta.newConcepts){const term=graph.terminology[concept];if(term)next.terminology[concept]={definition:term.definition,introducedAt:contract.id};}
 }
 return next;
}
export function registryFromGraph(graph:ConceptGraph):SemanticRegistrySnapshot{return {version:1,entries:graph.concepts.map(c=>({semanticKey:c.id,canonicalName:c.canonicalName,aliases:[...c.aliases],persistentId:`concept:${c.id}`,representationFamily:c.visualFamily,colorRole:c.preferredColorRole,semanticParts:[],sceneInstances:[]}))};}

const representation=(object:VisualObject)=>object.representation?.family??object.assetRef??object.primitiveRef;
export function deriveContinuityDecisions(scene:VisualSceneV2,previous:CompiledSceneV2|undefined,registry:SemanticRegistrySnapshot):ContinuityDecision[]{
 if(!previous)return [];
 const decisions:ContinuityDecision[]=[],currentByConcept=new Map(scene.objects.filter(o=>o.conceptId).map(o=>[o.conceptId!,o])),previousByConcept=new Map(previous.objects.filter(o=>o.conceptId).map(o=>[o.conceptId!,o]));
 for(const [conceptId,current] of currentByConcept){const before=previousByConcept.get(conceptId),seenBefore=registry.entries.find(entry=>entry.semanticKey===conceptId)?.sceneInstances.length;
  if(!before){if(seenBefore)decisions.push({conceptId,action:'REINTRODUCE',toRepresentation:representation(current)});continue;}
  const fromRepresentation=representation(before),toRepresentation=representation(current);
  if(fromRepresentation!==toRepresentation){decisions.push({conceptId,action:'REPLACE',fromRepresentation,toRepresentation});continue;}
  if(before.state!==current.state){decisions.push({conceptId,action:'TRANSFORM',fromState:before.state,toState:current.state,fromRepresentation,toRepresentation});continue;}
  const requestedKeep=scene.continuity.keepFromPrevious.includes(current.id),moved=requestedKeep&&before.preferredZone!==current.preferredZone;
  decisions.push({conceptId,action:moved?'MOVE':requestedKeep?'KEEP':'REINTRODUCE',fromRepresentation,toRepresentation});
 }
 for(const [conceptId,before] of previousByConcept)if(!currentByConcept.has(conceptId))decisions.push({conceptId,action:'REMOVE',fromRepresentation:representation(before)});
 return decisions;
}

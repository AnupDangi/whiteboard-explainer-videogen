import {assertSchema,visualSceneSchema,type Schema} from '../schemas.js';
import {mapConcurrent} from '../harness/concurrency.js';
import {log} from '../../shared/logger.js';
import type {JsonModel} from '../planning/model-adapter.js';
import type {SemanticChunk} from '../source/chunker.js';
import type {BaseConceptGraph} from '../knowledge/types.js';
import type {SceneContract,LessonBible} from '../teacher/types.js';
import type {VisualSceneV2} from '../types.js';
import {RELATIONS} from '../types.js';
import {NARRATION_WPM} from '../../shared/language.js';

/** One Scene Worker call decides narration AND semantic visual intent for a
 *  small batch of scenes (`Architecture_plan.md` §23-27, §31). There is no
 *  per-scene narration agent or visual agent. Output reuses the existing
 *  `VisualSceneV2` contract so the trusted compiler/runtime is unchanged. */
export interface SceneWorkerInput {
  graph:BaseConceptGraph;
  bible:LessonBible;
  /** Per-scene evidence chunks (5-10). Missing scenes degrade to no evidence. */
  evidence:Record<string,SemanticChunk[]>;
  language?:string;
  signal?:AbortSignal;
  /** One bounded length/repair note from the orchestrator (§61). */
  repairNote?:string;
}

const sceneBatchSchema:Schema={type:'object',properties:{scenes:{type:'array',items:visualSceneSchema,minItems:1,maxItems:4}},required:['scenes'],additionalProperties:false};

const INVARIANTS=[
  'Decide narration and semantic visual intent together in one pass.',
  'Use only concept keys, mechanism ids and evidence refs supplied for each scene; never invent a concept.',
  'Give every object a primitiveRef (label|rectangle|circle|equation). A representation may accompany it but does not replace it. Do not use assetRef: no representation candidates are supplied in this run.',
  'A structural_diagram or convergence scene must have exactly one object with role "hero".',
  `Relation types must be one of: ${RELATIONS.join(', ')}.`,
  'If an action uses fromState or toState, list that state in the target object allowedStates.',
  'Do not emit coordinates, sizes, SVG, URLs or executable code.',
  'One idea per beat; beat narration must be speakable prose.',
  'Each scene\'s narration must total AT LEAST its narrationWordTarget words; duration follows words, not speaking speed. Count words before responding.',
].join(' ');

/** Scene 1 alone (latency-critical), then pairs (`Architecture_plan.md` §25, §31). */
export function sceneBatches(contracts:SceneContract[],laterBatchSize=2):SceneContract[][]{
  if(!contracts.length)return [];
  const size=Number.isInteger(laterBatchSize)&&laterBatchSize>=1?laterBatchSize:2;
  const sorted=[...contracts].sort((a,b)=>a.sequence-b.sequence);
  const batches:SceneContract[][]=[[sorted[0]]];
  for(let i=1;i<sorted.length;i+=size)batches.push(sorted.slice(i,i+size));
  return batches;
}

export interface SceneGate {passed:boolean;findings:string[]}

export function gateSceneIntent(scene:VisualSceneV2,contract:SceneContract,input:{graph:BaseConceptGraph}):SceneGate{
  const findings:string[]=[];
  const conceptKeys=new Set(input.graph.concepts.map(concept=>concept.key));
  const objectIds=new Set(scene.objects.map(object=>object.id));
  const relationIds=new Set(scene.relations.map(relation=>relation.id));
  if(scene.id!==contract.id)findings.push(`Worker returned scene ${scene.id} for contract ${contract.id}`);
  if(!contract.candidateArchetypes.includes(scene.archetype))findings.push(`Scene ${scene.id} archetype ${scene.archetype} is not a candidate`);
  if(!scene.beats.length)findings.push(`Scene ${scene.id} has no beats`);
  if(['structural_diagram','convergence'].includes(scene.archetype)){
    const heroes=scene.objects.filter(object=>object.role==='hero').length;
    if(heroes!==1)findings.push(`Scene ${scene.id} archetype ${scene.archetype} needs exactly one hero (has ${heroes})`);
  }
  if(new Set(scene.objects.map(object=>object.id)).size!==scene.objects.length)findings.push(`Scene ${scene.id} has duplicate object ids`);
  for(const object of scene.objects){
    if(object.conceptId&&!conceptKeys.has(object.conceptId))findings.push(`Scene ${scene.id} object ${object.id} has unknown concept ${object.conceptId}`);
    // The compiler accepts exactly one of assetRef/primitiveRef (`validate.ts`),
    // and `representation` alone is not a carrier.
    const hasPrimitive=Boolean(object.primitiveRef),hasAsset=Boolean(object.assetRef);
    if(hasPrimitive===hasAsset)findings.push(`Scene ${scene.id} object ${object.id} needs exactly one primitiveRef or assetRef`);
    if(hasAsset)findings.push(`Scene ${scene.id} object ${object.id} uses assetRef but no representation candidates were supplied`);
  }
  for(const relation of scene.relations){if(!objectIds.has(relation.from.objectId)||!objectIds.has(relation.to.objectId))findings.push(`Scene ${scene.id} relation ${relation.id} references an unknown object`);}
  for(const beat of scene.beats){
    if(!beat.narration.trim())findings.push(`Scene ${scene.id} beat ${beat.id} has empty narration`);
    for(const action of beat.actions){
      for(const objectId of action.objectIds)if(!objectIds.has(objectId))findings.push(`Scene ${scene.id} action ${action.id} references unknown object ${objectId}`);
      for(const relationId of action.relationIds)if(!relationIds.has(relationId))findings.push(`Scene ${scene.id} action ${action.id} references unknown relation ${relationId}`);
      for(const objectId of action.objectIds){
        const target=scene.objects.find(object=>object.id===objectId);
        for(const state of [action.fromState,action.toState])if(state&&target&&!target.allowedStates.includes(state))findings.push(`Scene ${scene.id} action ${action.id} uses state ${state} not in allowedStates of ${objectId}`);
      }
    }
  }
  for(const required of contract.requiredConceptIds)if(!scene.objects.some(object=>object.conceptId===required))findings.push(`Scene ${scene.id} does not represent required concept ${required}`);
  return {passed:findings.length===0,findings};
}

function payloadFor(contracts:SceneContract[],input:SceneWorkerInput){
  const allowedConceptKeys=new Set(input.graph.concepts.map(concept=>concept.key));
  const allowedMechanisms=new Set(input.graph.mechanisms.map(mechanism=>mechanism.id));
  return {
    bible:input.bible,
    scenes:contracts.map(contract=>({
      contract,
      narrationWordTarget:Math.max(8,Math.round(contract.targetDurationSec*NARRATION_WPM/60)),
      allowedConceptIds:contract.requiredConceptIds.filter(key=>allowedConceptKeys.has(key)),
      allowedMechanismIds:contract.mechanismIds.filter(key=>allowedMechanisms.has(key)),
      allowedArchetypes:contract.candidateArchetypes,
      evidence:(input.evidence[contract.id]??[]).map(chunk=>({id:chunk.id,section:chunk.sectionPath.join(' / '),text:chunk.text})),
    })),
  };
}

/** Deterministic, representational heal: an action may only use states the
 *  object declares. A missing declaration is widened rather than failing the
 *  lesson (this is not instructional content), and the heal is logged so it is
 *  never silent (V2's S2 rule). Semantic states still face the hard gate. */
function healSceneStates(scene:VisualSceneV2):boolean{
  let healed=false;
  /** One object per concept: two objects for the same concept overlap in the
   *  compiler and cannot be separated. Keep the most prominent, remap every
   *  reference, and log. */
  const byConcept=new Map<string,VisualSceneV2['objects'][number]>();
  const dropped=new Set<string>();
  const prominence=(object:VisualSceneV2['objects'][number])=>object.role==='hero'?-1:object.importance==='primary'?0:object.importance==='secondary'?1:2;
  for(const object of scene.objects){
    if(!object.conceptId)continue;
    const existing=byConcept.get(object.conceptId);
    if(!existing){byConcept.set(object.conceptId,object);continue;}
    if(prominence(object)<prominence(existing)){dropped.add(existing.id);byConcept.set(object.conceptId,object);}
    else dropped.add(object.id);
  }
  if(dropped.size){
    const remap=(id:string)=>dropped.has(id)?undefined:id;
    scene.objects=scene.objects.filter(object=>!dropped.has(object.id));
    for(const object of scene.objects){object.children=object.children.map(child=>remap(child)).filter((id):id is string=>Boolean(id));if(object.parentId&&dropped.has(object.parentId))delete object.parentId;}
    scene.relations=scene.relations.filter(relation=>!dropped.has(relation.from.objectId)&&!dropped.has(relation.to.objectId));
    for(const beat of scene.beats)for(const action of beat.actions){action.objectIds=action.objectIds.map(remap).filter((id):id is string=>Boolean(id));action.relationIds=action.relationIds.filter(id=>scene.relations.some(relation=>relation.id===id));}
    healed=true;
  }
  /** Transitions are optional and carry compiler rules; drop malformed ones
   *  rather than failing the lesson (they are continuity metadata, not content). */
  if(scene.continuity.transitions?.length){
    const concepts=new Set(scene.objects.map(object=>object.conceptId).filter((id):id is string=>Boolean(id)));
    const seen=new Set<string>();
    const kept=scene.continuity.transitions.filter(transition=>{
      if(transition.action!=='REMOVE'&&!concepts.has(transition.conceptId))return false;
      if(seen.has(transition.conceptId))return false;
      seen.add(transition.conceptId);
      if(transition.action==='TRANSFORM'&&(!transition.fromState||!transition.toState||transition.fromState===transition.toState))return false;
      if(transition.action==='REPLACE'&&!transition.toRepresentation)return false;
      return true;
    });
    if(kept.length!==scene.continuity.transitions.length)healed=true;
    scene.continuity.transitions=kept;
  }
  for(const object of scene.objects)if(!object.allowedStates.includes(object.state)){object.allowedStates.push(object.state);healed=true;}
  for(const beat of scene.beats)for(const action of beat.actions)for(const objectId of action.objectIds){
    const target=scene.objects.find(object=>object.id===objectId);
    if(!target)continue;
    for(const state of [action.fromState,action.toState])if(state&&!target.allowedStates.includes(state)){target.allowedStates.push(state);healed=true;}
  }
  /** An object nobody draws is rejected by the compiler ("Required object never
   *  appears"). Reveal it in the first beat rather than failing the lesson; the
   *  heal is logged so it is never silent. */
  const beat=scene.beats[0];
  if(beat){
    const targeted=new Set(scene.beats.flatMap(entry=>entry.actions.flatMap(action=>action.objectIds)));
    for(const object of scene.objects){
      if(object.role==='decorative_support'||targeted.has(object.id))continue;
      beat.actions.unshift({id:`reveal_${object.id}`,type:'reveal',objectIds:[object.id],relationIds:[],durationMs:800,leadMs:-180,easing:'linear'});
      targeted.add(object.id);
      healed=true;
    }
  }
  /** Structural archetypes require exactly one hero (compiler rule). Choose one
   *  deterministically rather than failing the lesson. */
  if(['structural_diagram','convergence'].includes(scene.archetype)&&scene.objects.length){
    const heroes=scene.objects.filter(object=>object.role==='hero');
    if(heroes.length!==1){
      const chosen=heroes[0]??scene.objects.find(object=>object.importance==='primary')??scene.objects[0];
      for(const object of scene.objects)if(object.role==='hero'&&object!==chosen)object.role='support';
      if(chosen.role!=='hero')chosen.role='hero';
      healed=true;
    }
  }
  return healed;
}

export async function runSceneWorkers(contracts:SceneContract[],input:SceneWorkerInput,options:{model:JsonModel;concurrency?:number;sessionId?:string}):Promise<VisualSceneV2[]>{
  const batches=sceneBatches(contracts);
  if(!batches.length)return [];
  const limit=Math.max(1,Math.min(8,options.concurrency??batches.length));
  const groups=await mapConcurrent(batches,limit,async(batch,index)=>{
    const value=await options.model.generate('sceneWorker',`${INVARIANTS} Language: ${input.language??'en'}. Return exactly one scene per supplied contract, keyed by contract id.${input.repairNote?` ${input.repairNote}`:''}`,payloadFor(batch,input),sceneBatchSchema,(output)=>{assertSchema(output,sceneBatchSchema);return output;},{...(input.signal?{signal:input.signal}:{}),...(options.sessionId?{sessionId:options.sessionId}:{})});
    const scenes=(value as {scenes:VisualSceneV2[]}).scenes;
    const expected=batch.map(contract=>contract.id).sort();
    const returned=scenes.map(scene=>scene.id).sort();
    if(returned.length!==expected.length||returned.some((id,i)=>id!==expected[i]))throw new Error(`Scene worker batch ${index} returned [${returned.join(', ')}] for contracts [${expected.join(', ')}]`);
    for(const scene of scenes){
      if(healSceneStates(scene))log('v3.scene.state-heal',{scene:scene.id},'warn');
      const contract=batch.find(candidate=>candidate.id===scene.id)??batch[0];
      const gate=gateSceneIntent(scene,contract,input);
      if(!gate.passed)throw new Error(`Scene worker batch ${index} failed its gate: ${gate.findings.join('; ')}`);
    }
    return scenes;
  },input.signal);
  return groups.flat();
}

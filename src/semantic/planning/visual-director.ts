import {stageFailure} from '../repair.js';
import {log} from '../../shared/logger.js';
import {resolvedDirectionSchema} from '../identity/runtime-schemas.js';
import {directionToScene} from '../identity/intent-adapter.js';
import {visualSceneSchema,type Schema} from '../schemas.js';
import {validateVisualScene} from './validate.js';
import {directorPrompt} from './prompt-builder.js';
import {resolveRepresentation,primitiveFallbackNote} from '../identity/representation.js';
import {getAsset,resolveAsset,canonicalAnchor} from '../assets/registry.js';
import type {AssetDefinition} from '../assets/types.js';
import {compileScene} from '../compiler/compile-scene.js';
import {zoneRect} from '../compiler/zones.js';
import {archetypePlacements} from '../compiler/archetypes.js';
import type {ConceptIdentity,SemanticScenePlan,VisualSceneV2,CompiledSceneV2} from '../types.js';
import type {VisualModel} from './visual-model.js';
import type {JsonModel} from './model-adapter.js';
import type {WhiteboardPlan} from '../harness/contracts.js';
import {skillInstruction} from '../skills.js';
export interface DirectionDecisions {centralTeachingObject:string;firstFocus:string;illustratedConcepts:string;labelsOnly:string;movingRelations:string;persistentContext:string;stateChanges:string;omit:string}
const decisionKeys=['centralTeachingObject','firstFocus','illustratedConcepts','labelsOnly','movingRelations','persistentContext','stateChanges','omit'];
const decisionSchema:Schema={type:'object',additionalProperties:false,required:decisionKeys,properties:Object.fromEntries(decisionKeys.map(k=>[k,{type:'string',maxLength:600}]))};
/** The director's full response contract. Exported so a replay (the real-output regression corpus) heals against exactly what the model was asked for. */
export const directorResponseSchema:Schema={type:'object',additionalProperties:false,required:['direction'],properties:{direction:resolvedDirectionSchema,decisions:decisionSchema}};
/** `decisions` is the director's self-report; nothing consumes it, so a model
 *  that omits it entirely is not worth failing a lesson over (measured: the
 *  omission survived its one repair and killed the job). The default is derived
 *  from the scene, and the absence is recorded. */
function defaultDecisions(scene:SemanticScenePlan):DirectionDecisions{
 return {centralTeachingObject:scene.centralConceptId,firstFocus:scene.centralConceptId,illustratedConcepts:scene.requiredConceptIds.join(', '),labelsOnly:'(not reported)',movingRelations:'(not reported)',persistentContext:'(not reported)',stateChanges:'(not reported)',omit:'(not reported)'};
}
/** Deterministic continuity heal: a PRESERVE diff whose visual re-draws the
 *  concept is converted to a highlight, so the preserved object is emphasized
 *  instead of re-introduced (recorded by the caller). */
export function healPreservedRedraws(scene:VisualSceneV2,board:WhiteboardPlan):number{return healBoardContract(scene,board).preserved;}

/** Bring a directed scene up to the whiteboard plan's per-beat contract.
 *
 *  Every diff is a promise about a beat, and the board-alignment gate holds the
 *  director to all three. Two of them are mechanically recoverable and used to
 *  fail a whole lesson on a single omission:
 *   PRESERVE   a re-drawn concept becomes a highlight (it persists, so it must
 *              not be introduced again)
 *   INTRODUCE  a concept the plan introduces in this beat but the direction
 *              never draws gets the reveal it is missing
 *   TRANSFORM  a promised state change with no action reaching it gets a morph
 *  Each is recorded and counted. A concept with no object in the scene is left
 *  alone: that is a coverage failure the director gate already reports. */
export function healBoardContract(scene:VisualSceneV2,board:WhiteboardPlan):{preserved:number;introduced:number;transformed:number}{
 const counts={preserved:0,introduced:0,transformed:0};
 if(board.beats.length!==scene.beats.length)return counts;
 for(const [index,boardBeat] of board.beats.entries()){
  const visual=scene.beats[index];
  const objectFor=(conceptKey:string)=>scene.objects.find(object=>object.conceptId===conceptKey);
  const targets=(key:string)=>(action:VisualSceneV2['beats'][number]['actions'][number])=>action.objectIds.some(id=>scene.objects.find(o=>o.id===id)?.conceptId===key);
  for(const diff of boardBeat.diffs){
   for(const key of diff.semanticKeys){
    const object=objectFor(key);
    if(!object)continue;
    if(diff.operation==='PRESERVE'){
     for(const action of visual.actions){if(action.type!=='draw'||!targets(key)(action))continue;action.type='highlight';action.id=`${action.id}_preserved`;counts.preserved++;}
     continue;
    }
    if(diff.operation==='INTRODUCE'){
     if(visual.actions.some(action=>['draw','reveal'].includes(action.type)&&targets(key)(action)))continue;
     visual.actions.unshift({id:`${visual.id}_introduce_${key}`,type:'reveal',objectIds:[object.id],relationIds:[],durationMs:800,leadMs:0,easing:'linear'});
     counts.introduced++;
     continue;
    }
    if(diff.operation==='TRANSFORM'&&diff.toState){
     if(visual.actions.some(action=>action.toState===diff.toState&&targets(key)(action)))continue;
     object.allowedStates=[...new Set([...object.allowedStates,diff.toState])];
     visual.actions.push({id:`${visual.id}_transform_${key}`,type:'morph',objectIds:[object.id],relationIds:[],durationMs:1500,leadMs:0,easing:'linear',...(diff.fromState?{fromState:diff.fromState}:{}),toState:diff.toState});
     counts.transformed++;
    }
   }
  }
 }
 return counts;
}
/** Resolver results are scoped to the archetype the director will actually use.
 *  Resolving against the whole `candidateArchetypes` union offered assets that
 *  the selected archetype cannot carry (measured: `data.value.v2` for a
 *  `cause_effect` scene), which the compiler then stripped to a label — read
 *  downstream as an unexplained representation degradation. `candidateArchetypes[0]`
 *  is the one the director is instructed to use and the one validate clamps to. */
function archetypeSort(model:VisualModel){const primary=model.candidateArchetypes[0];return (a:{archetypes:string[]},b:{archetypes:string[]})=>(b.archetypes.includes(primary)?1:0)-(a.archetypes.includes(primary)?1:0);}
export function assetCandidates(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel){const selected=[model.candidateArchetypes[0]];return scene.requiredConceptIds.map(id=>{const concept=registry.find(c=>c.id===id)!;const decision=resolveRepresentation({id:concept.id,canonicalName:concept.canonicalName,aliases:concept.aliases,semanticType:concept.semanticType,visualFamily:concept.visualFamily},selected);return {conceptId:id,candidates:decision.candidates.map(c=>{const a=getAsset(c.id);return {id:a.id,aliases:a.aliases,anchors:Object.keys(a.anchors),semanticAnchorAliases:a.anchorAliases??{},states:Object.keys(a.states),archetypes:a.archetypes};}).sort(archetypeSort(model)),fallback:decision.fallback,representation:decision.representation,warnings:decision.warnings};});}
export function representationWarnings(scene:SemanticScenePlan,registry:ConceptIdentity[],model:VisualModel):string[]{return assetCandidates(scene,registry,model).flatMap(c=>c.warnings);}
/** Every initial or repaired direction passes this same teaching contract. */
export function validateDirectedScene(raw:VisualSceneV2,scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,allowedAssets:Set<string>,previous?:CompiledSceneV2,catalog?:Record<string,AssetDefinition>):VisualSceneV2{
 const visual=validateVisualScene(raw,new Set(registry.map(c=>c.id)),new Set(previous?.objects.map(o=>o.id)));
 if(visual.id!==scene.id)throw new Error('Director changed scene identity');
 if(!mentalModel.candidateArchetypes.includes(visual.archetype))throw new Error('Director chose unavailable mental model');
 if(!visual.objects.some(o=>o.role==='hero'&&o.conceptId===scene.centralConceptId))throw new Error('Director changed central teaching object');
 for(const o of visual.objects)if(o.representation&&o.assetRef)throw new Error('Object has two representations');
  /** The archetype is harness-owned (selectVisualModel); the prompt names it, so
   *  a model-returned mismatch is clamped to it (recorded). */
  if(visual.archetype!==mentalModel.candidateArchetypes[0]){log('v2.director.archetype-clamp',{scene:scene.id,from:visual.archetype,to:mentalModel.candidateArchetypes[0]});visual.archetype=mentalModel.candidateArchetypes[0];}
  /** Cycle contract synthesis: a cycle must be exactly one closed ring. When
   *  the model's graph does not form one, close it deterministically over the
   *  plan's primaries in beat order, reusing the plan's own relation type
   *  where one exists between the pair (recorded degradation). */
  if(visual.archetype==='cycle'){
   const primaryIds=visual.objects.filter(o=>!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support').map(o=>o.id);
   const conceptOf=(id:string)=>visual.objects.find(o=>o.id===id)?.conceptId;
   const ringArcs=visual.relations.filter(r=>primaryIds.includes(r.from.objectId)&&primaryIds.includes(r.to.objectId)&&r.visualForm!=='none'&&!r.layoutFeedback&&!['labels','compares_with'].includes(r.relationType));
   const outgoingCount=(id:string)=>ringArcs.filter(r=>r.from.objectId===id).length;
   const visited=new Set<string>();
   let current=[...primaryIds].sort()[0];
   while(visited.size<primaryIds.length){
    visited.add(current);
    const next=ringArcs.filter(r=>r.from.objectId===current&&!visited.has(r.to.objectId));
    if(next.length!==1){break;}
    current=next[0].to.objectId;
   }
   if(visited.size<primaryIds.length||!ringArcs.some(r=>r.from.objectId===current&&r.to.objectId===[...primaryIds].sort()[0])){
    /** Repair: keep exactly one outgoing arc per node along the plan order. */
    const beatOrder=new Map<string,number>();
    scene.beats.forEach((b,i)=>{for(const key of [...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)])if(!beatOrder.has(key))beatOrder.set(key,i);});
    const order=[...primaryIds].sort((a,b)=>(beatOrder.get(conceptOf(a)!)??99)-(beatOrder.get(conceptOf(b)!)??99)||a.localeCompare(b));
    const start=order[0];
    const planArcType=(fromId:string,toId:string)=>{const from=conceptOf(fromId),to=conceptOf(toId);const arc=scene.requiredRelations.find(r=>r.fromConceptId===from&&r.toConceptId===to);return arc?.relationType??'flows_to';};
    for(let i=0;i<order.length;i++){
     const fromId=order[i],toId=order[(i+1)%order.length];
     const existing=ringArcs.filter(r=>r.from.objectId===fromId);
     if(existing.length===1&&existing[0].to.objectId===toId)continue;
     for(const r of existing)if(r.to.objectId!==toId){r.visualForm='none';log('v2.director.ring-heal',{scene:scene.id,dropped:`${r.from.objectId}->${r.to.objectId}`},'warn');}
     if(!ringArcs.some(r=>r.from.objectId===fromId&&r.to.objectId===toId)){
      const from=conceptOf(fromId),to=conceptOf(toId);
      const arc=scene.requiredRelations.find(r=>r.fromConceptId===from&&r.toConceptId===to);
      const newRelation={id:`relation_ring_${i}`,from:{objectId:fromId,anchor:'center'},to:{objectId:toId,anchor:'center'},relationType:arc?.relationType??'flows_to',visualForm:'flow',label:arc?.id??'cycle arc'} as VisualSceneV2['relations'][number];
      visual.relations.push(newRelation);ringArcs.push(newRelation);
      log('v2.director.ring-heal',{scene:scene.id,added:`${fromId}->${toId}`},'warn');
     }
    }
   }
  }
 for(const o of visual.objects)if(o.assetRef&&!allowedAssets.has(o.assetRef))throw new Error(`Director invented asset ${o.assetRef}`);
  /** Defence in depth for the resolver/compiler contract: an asset the selected
   *  archetype cannot carry must be rejected as a director choice (repairable
   *  once) rather than silently stripped by the compiler's fallback. */
  for(const o of visual.objects)if(o.assetRef&&!resolveAsset(o.assetRef,catalog).archetypes.includes(visual.archetype))throw new Error(`${o.assetRef} does not support ${visual.archetype}; choose a candidate whose archetypes include it, or a semantic composition`);
 for(const id of scene.requiredConceptIds)if(!visual.objects.some(o=>o.conceptId===id))throw new Error(`Director omitted concept ${id}`);
 if(visual.beats.length!==scene.beats.length)throw new Error('Director changed beat count');
 for(const [i,b] of scene.beats.entries())if(visual.beats[i].id!==b.id||visual.beats[i].narration!==b.narrationDraft)throw new Error(`Director changed narration/beat ${b.id}`);
 for(const r of visual.relations)for(const ref of [r.from,r.to]){
  const object=visual.objects.find(o=>o.id===ref.objectId)!;
  if(object.assetRef)ref.anchor=canonicalAnchor(object.assetRef,ref.anchor,catalog);
  const anchors=object.assetRef?Object.keys(resolveAsset(object.assetRef,catalog).anchors):['input','output','center','top','bottom'];
  if(!anchors.includes(ref.anchor)){
   /** A named anchor the asset does not implement (the live model said
    *  'exterior') degrades to 'center' with a diagnostic, mirroring the
    *  unroutable-relation degradation, instead of failing the whole stage. */
   log('v2.director.anchor-degraded',{scene:scene.id,object:object.id,from:ref.anchor,to:'center'},'warn');
   ref.anchor='center';
  }
 }
 for(const required of scene.requiredRelations){
  let relation=visual.relations.find(r=>{
   const from=visual.objects.find(o=>o.id===r.from.objectId)!,to=visual.objects.find(o=>o.id===r.to.objectId)!;
   if(from.conceptId!==required.fromConceptId||to.conceptId!==required.toConceptId||r.relationType!==required.relationType)return false;
   if(!required.targetAnchor)return true;
   const target=to.assetRef?canonicalAnchor(to.assetRef,required.targetAnchor,catalog):required.targetAnchor;
   return r.to.anchor===target;
  });
   /** A required relation is part of the teaching contract — the plan asserts
    *  the lesson needs it — so the harness realizes it when the direction omits
    *  it, exactly as cycle ring synthesis closes a ring. Measured: the director
    *  omitted a required relation on both scenes of a live run and the single
    *  targeted repair did not converge, failing the job. Recorded, never silent;
    *  relation coverage is a migration gate (100%). */
   if(!relation){
    const from=visual.objects.find(o=>o.conceptId===required.fromConceptId),to=visual.objects.find(o=>o.conceptId===required.toConceptId);
    if(!from||!to)throw new Error(`Missing semantic relation ${required.id}: a concept object is absent`);
    const anchorNames=to.assetRef?Object.keys(resolveAsset(to.assetRef,catalog).anchors):['input','output','center','top','bottom'];
    const requested=required.targetAnchor?(to.assetRef?canonicalAnchor(to.assetRef,required.targetAnchor,catalog):required.targetAnchor):'center';
    /** Mirrors intent-adapter's relationType -> visualForm mapping. */
    const visualForm=required.relationType==='contains'||required.relationType==='part_of'?'containment':required.relationType==='flows_to'?'flow':required.relationType==='labels'?'leader':required.relationType==='compares_with'?'brace':'arrow';
    /** The pair may already be drawn, but with the wrong type, direction or
     *  anchor. The plan's relation is the contract, so a single existing arc for
     *  the pair is CORRECTED in place rather than duplicated (which would render
     *  two arrows) or fatal. This is a semantic change, so it is recorded; the
     *  alternative measured live was a failed job when the model typed the arc
     *  `flows_to` where the plan required `causes`. More than one candidate arc
     *  stays ambiguous and is left to the targeted repair. */
    const pairArcs=visual.relations.filter(r=>{const a=visual.objects.find(o=>o.id===r.from.objectId),b=visual.objects.find(o=>o.id===r.to.objectId);return Boolean(a&&b&&((a.conceptId===required.fromConceptId&&b.conceptId===required.toConceptId)||(a.conceptId===required.toConceptId&&b.conceptId===required.fromConceptId)));});
    if(pairArcs.length===1){
     const arc=pairArcs[0];
     log('v2.director.relation-corrected',{scene:scene.id,relation:required.id,arc:arc.id,from:arc.relationType,to:required.relationType,target:anchorNames.includes(requested)?requested:'center'},'warn');
     arc.from={objectId:from.id,anchor:'center'};
     arc.to={objectId:to.id,anchor:anchorNames.includes(requested)?requested:'center'};
     arc.relationType=required.relationType;
     arc.visualForm=visualForm;
     relation=arc;
    }else if(pairArcs.length>1){
     throw new Error(`Missing semantic relation ${required.id}: ${pairArcs.length} candidate arcs between the same concepts; direction, type and target part are required`);
    }else{
     relation={id:`relation_synth_${required.id}`,from:{objectId:from.id,anchor:'center'},to:{objectId:to.id,anchor:anchorNames.includes(requested)?requested:'center'},relationType:required.relationType,visualForm} as VisualSceneV2['relations'][number];
    visual.relations.push(relation);
    log('v2.director.relation-synthesis',{scene:scene.id,relation:required.id,from:from.id,to:to.id,type:required.relationType,anchor:relation.to.anchor},'warn');
    }
   }
  for(const b of scene.beats.filter(b=>b.relationFocus.includes(required.id))){
   const beat=visual.beats.find(v=>v.id===b.id)!;
   if(beat.actions.some(a=>a.relationIds.includes(relation.id)))continue;
   /** The plan's relation is its own animation: inject the action referencing
    *  the RUNTIME relation id (recorded) instead of failing the stage. */
   beat.actions.push({id:`${b.id}_rel_${required.id}`,type:'flow',objectIds:[],relationIds:[relation.id],durationMs:1500,leadMs:0,easing:'linear'});
   log('v2.director.relation-heal',{scene:scene.id,beat:b.id,relation:required.id},'warn');
  }
 }
 return visual;
}
/** A directed scene plus everything the deterministic compile step needs. The
 *  two are deliberately separate so the MODEL calls for several scenes can run
 *  concurrently while compilation stays ordered: compilation is the only step
 *  that depends on the previous scene (geometry reuse), and it costs nothing. */
export interface DirectedScene{scene:VisualSceneV2;decisions:DirectionDecisions;plan:SemanticScenePlan;registry:ConceptIdentity[];mentalModel:VisualModel;allowedAssets:Set<string>;catalog?:Record<string,AssetDefinition>}

/** Direct one scene: build the contract the model must echo, call it, validate
 *  the direction. No compilation, so this is safe to run for every scene at
 *  once. `previousContinuity` lets the caller supply the semantic continuity
 *  from the plan when the previous compiled scene does not exist yet. */
export async function directScene(scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,model:JsonModel,previous?:CompiledSceneV2,language?:string,resolved?:{candidates?:ReturnType<typeof assetCandidates>;sourceVisualIds?:string[];repairNotes?:string[];whiteboardPlan?:WhiteboardPlan;catalog?:Record<string,AssetDefinition>;previousContinuity?:VisualSceneV2['continuity']|null;prefetched?:{scene:VisualSceneV2;decisions:DirectionDecisions};signal?:AbortSignal}):Promise<DirectedScene>{
 const candidates=resolved?.candidates??assetCandidates(scene,registry,mentalModel),allowedAssets=new Set(candidates.flatMap(c=>c.candidates.map(a=>a.id)));
  /** The teaching contract the validator enforces, given to the model in the
   *  EXACT shape it must echo. Previously these were serialised into a sentence
   *  and the model had to translate `fromConceptId`/`relationType`/`targetAnchor`
   *  into `fromConcept`/`relation`/`targetPart`; measured failure: the model
   *  emitted the right concept pair with the wrong relation type and the single
   *  targeted repair did not converge. Field names now match the output schema,
   *  so prompt, schema, validator and compiler express one shape. */
  const requiredRelations=scene.requiredRelations.map(required=>({fromConcept:required.fromConceptId,relation:required.relationType,toConcept:required.toConceptId,...(required.targetAnchor?{targetPart:required.targetAnchor}:{})}));
  const requiredObjects=[{conceptKey:scene.centralConceptId,role:'hero'},...scene.requiredConceptIds.filter(id=>id!==scene.centralConceptId).map(id=>({conceptKey:id,role:'support'}))];
  const contractNote=requiredRelations.length?'Every entry of requiredRelations must appear in some beat\'s relationRefs with exactly those fromConcept, relation and toConcept values. Every entry of requiredObjects must appear once with that role.':'';const fallbackNote=primitiveFallbackNote(candidates.filter(c=>!c.candidates.length&&!c.representation).map(c=>c.conceptId));
   const repairNote=resolved?.repairNotes?.length?`A previous direction failed these visual checks: ${resolved.repairNotes.join('; ')}. Correct exactly those objects, relations, anchors, states or actions and keep narration, beat IDs and concept coverage unchanged.`:'';
  const instructions=[directorPrompt({archetype:mentalModel.candidateArchetypes[0],language,whiteboard:Boolean(resolved?.whiteboardPlan)}),contractNote,fallbackNote,repairNote,skillInstruction('visual-director')].filter(Boolean).join(' ');
   /** `prefetched` is the response from an earlier, concurrent issue of this
    *  exact request. Everything after it — validation, compilation, the
    *  integrity checks — is unchanged, so a prefetched scene and an inline one
    *  are indistinguishable apart from when the latency was paid. */
   const directed=resolved?.prefetched as {scene:VisualSceneV2;decisions:DirectionDecisions}|undefined??await model.generate('director',instructions,{semanticScene:scene,requiredRelations,requiredObjects,mentalModel,conceptRegistry:registry,candidateAssets:candidates,sourceVisualIds:resolved?.sourceVisualIds??[],whiteboardPlan:resolved?.whiteboardPlan??null,previousContinuity:resolved?.previousContinuity??previous?.scene.continuity??null},directorResponseSchema,value=>{
   const response=value as {scene?:VisualSceneV2;direction?:unknown;decisions:DirectionDecisions};
   /** The model may invent a concept that is not in the teaching graph. The
    *  identity is what is wrong, not the shape: leaving it in makes
    *  `validateVisualScene` reject the whole direction with "Unknown concept",
    *  which costs the lesson over a single hallucinated key. The invented object
    *  and every relation touching it are dropped, recorded, and the required
    *  concepts (which ARE in the registry) are untouched. */
   const direction=response.direction as {objects?:{conceptKey?:string}[];relations?:{fromConcept?:string;toConcept?:string}[]}|undefined;
   if(direction?.objects){
    const known=new Set(registry.map(c=>c.id)),before=direction.objects.length;
    direction.objects=direction.objects.filter(o=>!o.conceptKey||known.has(o.conceptKey));
    const kept=new Set(direction.objects.map(o=>o.conceptKey));
    direction.relations=(direction.relations??[]).filter(r=>kept.has(r.fromConcept??'')&&kept.has(r.toConcept??''));
    if(direction.objects.length!==before)log('v2.director.invented-concept-dropped',{scene:scene.id,dropped:before-direction.objects.length},'warn');
   }
   if(response.scene){
    // Instrumented legacy passthrough (plan heal rule 24): kept for model
    // compatibility, recorded here so removal has data. Not silent.
    log('v2.director.legacy-scene-passthrough',{scene:scene.id,hasDirection:'direction' in response});
   }
   const result={scene:response.scene??directionToScene(response.direction,scene),decisions:response.decisions??(log('v2.director.decisions-absent',{scene:scene.id},'warn'),defaultDecisions(scene))};
  for(const o of result.scene.objects){
   if(scene.requiredConceptIds.includes(o.conceptId??''))o.importance='primary';
   const choice=candidates.find(c=>c.conceptId===o.conceptId);
   if(choice?.representation&&!o.assetRef){o.representation=o.representation??choice.representation;if(o.representation.family!==choice.representation.family)throw new Error('Representation family changed');o.primitiveRef='rectangle';}
  }
  return {...result,scene:validateDirectedScene(result.scene,scene,registry,mentalModel,allowedAssets,previous,resolved?.catalog)};
 },{signal:resolved?.signal}) as {scene:VisualSceneV2;decisions:DirectionDecisions};
  return {scene:directed.scene,decisions:directed.decisions,plan:scene,registry,mentalModel,allowedAssets,catalog:resolved?.catalog};
}

/** Compile an already-directed scene. Deterministic geometry belongs to the
 *  compiler, never another model call, and this is the one step that needs the
 *  previous compiled scene. */
export function compileDirected(directed:DirectedScene,previous?:CompiledSceneV2):DirectedScene{
  const {plan:scene,registry,mentalModel,allowedAssets,catalog}=directed;
 // Deterministic geometry repair belongs to the compiler, never another model call.
 let compiled;try{compiled=compileScene(directed.scene,undefined,previous,catalog);}catch(e){
   /** Phase 8: failed critical gates retain diagnostic partial artifacts. The
    *  directed geometry is dumped compactly so a layout wall can be analyzed
    *  without re-paying for the model call. */
   /** The placement pass runs the same layout that just failed, so it can throw
    *  again and swallow the original diagnostic. A missing placement map only
    *  costs the zone-rect fallback in the dump. */
   let placementMap;try{placementMap=archetypePlacements(directed.scene);}catch{placementMap=new Map();}
   log('v2.director.compile-failure',{scene:scene.id,archetype:directed.scene.archetype,error:e instanceof Error?e.message:String(e),objects:directed.scene.objects.map(o=>{const rect=placementMap.get(o.id);const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const hero=o.role==='hero',structuralHero=hero&&['structural_diagram','convergence'].includes(directed.scene.archetype);const w=structuralHero?330:labelOnly?250:132,h=structuralHero?440:labelOnly?44:132;const zone=o.preferredZone??(o.role==='hero'?'center':'upper_left');return {id:o.id,role:o.role,parentId:o.parentId,zone:o.preferredZone,primitive:o.primitiveRef,asset:o.assetRef,root:!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support',placed:Boolean(rect),rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)}:zoneRect(zone,w,h)};}),relations:directed.scene.relations.map(r=>`${r.from.objectId}->${r.to.objectId}:${r.relationType}:${r.visualForm}`),directedScene:directed.scene,compiledObjects:(e as {compiledObjects?:unknown}).compiledObjects??null},'error');
   /** Ownership split. A GEOMETRY invariant (overlap, canvas escape) is the
    *  compiler's and is not repairable by another model call — retries produced
    *  byte-identical output. A STRUCTURAL contract violation is the director's:
    *  it chose the archetype and the relation graph, and restructuring the
    *  graph is exactly what a targeted repair can do. Without this split a
    *  cyclic relation graph in a `cause_effect` scene failed the whole job.
    *  Measured on a live run. */
   const message=e instanceof Error?e.message:String(e);
   /** Only a pure GEOMETRY invariant is the compiler's own and therefore not
    *  repairable: retries for those produced byte-identical output. Everything
    *  else thrown during compilation is a contract the director wrote — a
    *  structural archetype violation, a spoken anchor that does not exist in
    *  its own narration, an invented asset — and a targeted repair is exactly
    *  the right response. Measured live: a cyclic graph and an unresolvable
    *  anchor each failed a whole job while being director-fixable. */
   const geometryInvariant=/^(Illegal overlap|Canvas escape)/.test(message);
   throw stageFailure(e,geometryInvariant?'compile':'director');}
 validateDirectedScene(compiled.scene,scene,registry,mentalModel,allowedAssets,previous,catalog);
  /** Post-compile integrity checks are owned by the representation resolver and
   *  the compiler, not by the director: the director cannot redraw pixels, and a
   *  repair call reproduced this failure byte-identically on the live run while
   *  costing another 15s. Routing it (typed REPRESENTATION) stops the director
   *  retry and surfaces the degradation where it belongs. */
  for(const o of directed.scene.objects)if(scene.requiredConceptIds.includes(o.conceptId??'')){const actual=compiled.objects.find(c=>c.id===o.id);if(actual?.assetRef!==o.assetRef||actual?.representation?.family!==o.representation?.family)throw stageFailure(new Error(`Critical representation degraded: ${o.id}`),'representation');}
  const hero=compiled.objects.find(o=>o.role==='hero');
  if(hero?.primitiveRef==='label'&&!['numbered_steps','timeline','trajectory'].includes(compiled.scene.archetype))throw stageFailure(new Error('Unrepresented structural hero: choose a semantic composition'),'representation');
 return directed;
}

/** Direct and compile in one step, the single-scene entry point. The
 *  orchestrator calls `directScene` concurrently and `compileDirected` in order. */
export async function directVisual(scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,model:JsonModel,previous?:CompiledSceneV2,language?:string,resolved?:Parameters<typeof directScene>[6]):Promise<DirectedScene>{
 return compileDirected(await directScene(scene,registry,mentalModel,model,previous,language,resolved),previous);
}

/** Issue the director request for one scene without compiling it, so the model
 *  calls for several scenes can overlap. Uses `previousContinuity` supplied by
 *  the caller because the previous compiled scene does not exist yet. */
export async function prefetchDirection(scene:SemanticScenePlan,registry:ConceptIdentity[],mentalModel:VisualModel,model:JsonModel,language?:string,resolved?:Parameters<typeof directScene>[6]):Promise<{scene:VisualSceneV2;decisions:DirectionDecisions}>{
 const full=await directScene(scene,registry,mentalModel,model,undefined,language,{...resolved,prefetched:undefined});
 return {scene:full.scene,decisions:full.decisions};
}

import type {ConceptIdentity,SemanticScenePlan,VisualArchetype,SceneContinuity} from '../types.js';
/** True when the plan's required relations form exactly one closed ring over
 *  every concept the scene must represent: each concept has one outgoing
 *  relation within the set and the walk returns to its start after visiting
 *  all of them. */
function cycleRelationsClose(scene:SemanticScenePlan):boolean{
 const ids=new Set(scene.requiredConceptIds);
 const arcs=scene.requiredRelations.filter(relation=>ids.has(relation.fromConceptId)&&ids.has(relation.toConceptId)&&relation.fromConceptId!==relation.toConceptId);
 if(ids.size<3)return false;
 const outgoing=(id:string)=>arcs.filter(arc=>arc.fromConceptId===id);
 const start=[...ids].sort()[0];const visited=new Set<string>();let current=start;
 for(let step=0;step<ids.size;step++){
  if(visited.has(current))return false;
  visited.add(current);
  const next=outgoing(current);
  if(next.length!==1)return false;
  current=next[0].toConceptId;
 }
 return current===start;
}
import {archetypeFits} from '../compiler/archetypes.js';
import {supportedArchetype} from '../compiler/zones.js';
export interface VisualModel {mentalModel:string;candidateArchetypes:VisualArchetype[];heroConceptIds:string[];supportConceptIds:string[];relationStrategy:string[];requiredObjectStates:{conceptId:string;fromState:string;toState:string}[]}
/** Scene semantics and benchmark constraints determine eligibility, never topic regexes. */
export function selectVisualModel(scene:SemanticScenePlan,registry:ConceptIdentity[],previous:SceneContinuity,allowed:readonly VisualArchetype[],forbidden:readonly VisualArchetype[]=[]):VisualModel{
  const requested=scene.candidateArchetypes.filter(a=>!forbidden.includes(a));
  /** Preflight: an archetype the compiler cannot lay out is never selectable,
   *  so the director model call is not spent on a scene that cannot compile. */
  const unsupported=requested.filter(a=>!supportedArchetype(a));
  const candidates=requested.filter(a=>supportedArchetype(a)&&allowed.includes(a));
  /** The director directs the first candidate: put one that can hold every
   *  primary representation first, so a scene is never sent to a family whose
   *  compiler will reject its object count. */
  const count=scene.requiredConceptIds.length;
  /** A cycle must close: if the plan's own relations cannot express one
   *  outgoing arc per concept in a single ring, choosing cycle guarantees a
   *  compile failure, so the family is deprioritised (never invented). */
  const closes=cycleRelationsClose(scene);
  const ranked=(a:VisualArchetype)=>archetypeFits(a,count)&&(a!=='cycle'||closes);
  const ordered=[...candidates.filter(ranked),...candidates.filter(a=>!ranked(a))];
  if(!candidates.length)throw new Error(unsupported.length?`No supported archetype for ${scene.id}: ${[...new Set(unsupported)].join(', ')} declared but not implemented by the compiler`:`No feasible archetype for ${scene.id}`);
  const concepts=scene.requiredConceptIds.map(id=>{const c=registry.find(c=>c.id===id);if(!c)throw new Error(`Unknown concept: ${id}`);return c;});
  for(const id of scene.continuity.keepFromPrevious)if(!previous.prepareForNext.includes(id))throw new Error(`Continuity unavailable: ${id}`);
  const hero=scene.centralConceptId;
  if(!concepts.some(c=>c.id===hero))throw new Error('Central concept is not present');
  return {mentalModel:scene.mentalModel,candidateArchetypes:ordered,heroConceptIds:[hero],supportConceptIds:concepts.filter(c=>c.id!==hero).map(c=>c.id),relationStrategy:scene.requiredRelations.map(r=>`${r.fromConceptId} ${r.relationType} ${r.toConceptId}${r.targetAnchor?'.'+r.targetAnchor:''}`),requiredObjectStates:scene.beats.flatMap(b=>b.transform)};
}

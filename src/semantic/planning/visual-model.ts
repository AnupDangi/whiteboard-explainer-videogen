import type {ConceptIdentity,SemanticScenePlan,VisualArchetype,SceneContinuity} from '../types.js';
import {archetypeFits} from '../compiler/archetypes.js';
export interface VisualModel {mentalModel:string;candidateArchetypes:VisualArchetype[];heroConceptIds:string[];supportConceptIds:string[];relationStrategy:string[];requiredObjectStates:{conceptId:string;fromState:string;toState:string}[]}
/** Scene semantics and benchmark constraints determine eligibility, never topic regexes. */
export function selectVisualModel(scene:SemanticScenePlan,registry:ConceptIdentity[],previous:SceneContinuity,allowed:readonly VisualArchetype[],forbidden:readonly VisualArchetype[]=[]):VisualModel{
  const candidates=scene.candidateArchetypes.filter(a=>allowed.includes(a)&&!forbidden.includes(a));
  /** The director directs the first candidate: put one that can hold every
   *  primary representation first, so a scene is never sent to a family whose
   *  compiler will reject its object count. */
  const count=scene.requiredConceptIds.length;
  const ordered=[...candidates.filter(a=>archetypeFits(a,count)),...candidates.filter(a=>!archetypeFits(a,count))];
  if(!candidates.length)throw new Error(`No feasible archetype for ${scene.id}`);
  const concepts=scene.requiredConceptIds.map(id=>{const c=registry.find(c=>c.id===id);if(!c)throw new Error(`Unknown concept: ${id}`);return c;});
  for(const id of scene.continuity.keepFromPrevious)if(!previous.prepareForNext.includes(id))throw new Error(`Continuity unavailable: ${id}`);
  const hero=scene.centralConceptId;
  if(!concepts.some(c=>c.id===hero))throw new Error('Central concept is not present');
  return {mentalModel:scene.mentalModel,candidateArchetypes:ordered,heroConceptIds:[hero],supportConceptIds:concepts.filter(c=>c.id!==hero).map(c=>c.id),relationStrategy:scene.requiredRelations.map(r=>`${r.fromConceptId} ${r.relationType} ${r.toConceptId}${r.targetAnchor?'.'+r.targetAnchor:''}`),requiredObjectStates:scene.beats.flatMap(b=>b.transform)};
}

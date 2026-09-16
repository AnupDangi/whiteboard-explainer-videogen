/** Translation utility: canonical schemas -> internal TeachingPlanV2 /
 *  SemanticScenePlan. Not the identity authority (`harness/registry.ts`).
 */
import type { TeachingIntent, SceneTeachingIntent, SemanticBeatV2 } from './canonical-schemas.js';
import type { TeachingPlanV2, SemanticBeat, SemanticScenePlan, SemanticRelationRequirement, ConceptIdentity, EvidenceRef } from '../types.js';

export function canonicalToPlan(intent: TeachingIntent): TeachingPlanV2 {
  const evidenceRefs: EvidenceRef[] = [];
  return {
    version: 2,
    lessonGoal: intent.lessonGoal,
    learnerAssumption: intent.learnerAssumption ?? '',
    centralQuestion: intent.centralQuestion ?? '',
    requiredClaims: intent.requiredClaims.map(c => ({ ...c, evidenceRefs: [] })),
    requiredMechanisms: intent.requiredMechanisms.map(m => ({ ...m, evidenceRefs: [], conceptIds: [...m.conceptKeys], requiresStateChange: m.requiresStateChange })),
    conceptRegistry: intent.conceptRegistry.map(c => canonicalToConcept(c)),
    scenes: intent.scenes.map((s, i) => canonicalToScene(s, i)),
    misconceptions: [],
    evidenceRefs,
  };
}

function canonicalToConcept(c: TeachingIntent['conceptRegistry'][number]): ConceptIdentity {
  return {
    id: c.key,
    canonicalName: c.canonicalName,
    aliases: c.aliases,
    semanticType: c.semanticType as ConceptIdentity['semanticType'],
    visualFamily: c.visualFamily,
    preferredColorRole: c.preferredColorRole,
    evidenceRefs: [],
  };
}

function canonicalToScene(scene: SceneTeachingIntent, index: number): SemanticScenePlan {
  return {
    id: scene.key,
    centralConceptId: scene.centralConceptKey,
    teachingGoal: scene.teachingGoal,
    learnerShouldUnderstand: scene.learnerShouldUnderstand,
    mentalModel: scene.mentalModel,
    beats: scene.beats.map(b => canonicalToBeat(b)),
    requiredConceptIds: [...scene.requiredConceptKeys],
    requiredRelations: scene.requiredRelations.map((r, i) => ({
      id: `rel:${scene.key}:${i + 1}`,
      fromConceptId: r.fromConcept,
      toConceptId: r.toConcept,
      relationType: r.relation,
      targetAnchor: r.targetPart,
    }) satisfies SemanticRelationRequirement),
    candidateArchetypes: [...scene.candidateArchetypes],
    continuity: { keepFromPrevious: [...scene.continuity.keepFromPrevious], prepareForNext: [...scene.continuity.prepareForNext] },
  };
}

function canonicalToBeat(b: SemanticBeatV2): SemanticBeat {
  return {
    id: `beat:${b.key}`,
    purpose: b.purpose,
    narrationDraft: b.narrationDraft,
    requirementIds: b.requirementIds,
    introduce: [...b.introduce],
    reinforce: [...b.reinforce],
    transform: b.transform.map(t => ({ conceptId: t.conceptKey, fromState: t.fromState, toState: t.toState })),
    relationFocus: [...b.relationFocus],
    evidenceRefs: [],
    intentionalPause: b.intentionalPause,
  };
}

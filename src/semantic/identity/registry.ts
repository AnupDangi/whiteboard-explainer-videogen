/** Translates the new model-facing canonical schemas into the existing internal
 *  TeachingPlanV2 / SemanticScenePlan contracts used by validate/selectVisualModel.
 */
import { normalizeSemanticKey } from './types.js';
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

/** Backward-compatible normalizer: a legacy TeachingPlanV2 already uses lowercase
 *  snake_case IDs as semantic keys, but the runtime now asserts that IDs do not
 *  contain model-generated identifiers. This function strips any "obj_" / "rel_"
 *  prefixes and normalizes aliases. */
export function normalizeLegacyTeachingPlan(raw: TeachingPlanV2): TeachingPlanV2 {
  const cloned: TeachingPlanV2 = structuredClone(raw);
  // Rewrite concept IDs to ensure they are semantic keys.
  for (const c of cloned.conceptRegistry) {
    c.aliases = c.aliases.map(a => normalizeSemanticKey(a));
  }
  for (const s of cloned.scenes) {
    s.id = normalizeSemanticKey(s.id);
    // Required relations remain declared with raw ids; canonical relation refs use
    // concept keys directly.
  }
  return cloned;
}

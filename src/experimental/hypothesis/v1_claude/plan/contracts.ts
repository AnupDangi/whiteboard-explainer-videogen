import type { ConceptGraph, TeachingPlan, TeachingPlanDraft } from './schemas.js';

const relationKey = (relation: { from: string; to: string; type: string }): string => `${relation.from}|${relation.type}|${relation.to}`;

/** One stable machine code per distinct rule below, for aggregating failure counts across many attempts (e.g. a calibration harness). Message text is the sole source of truth for existing test assertions — never change a message without checking `__tests__/scene-context.test.ts` and `__tests__/source-lesson-preparation.test.ts`. */
export const CONTRACT_CODES = {
  LESSON_BIBLE_MISSING: 'LESSON_BIBLE_MISSING',
  AUDIENCE_MISMATCH: 'AUDIENCE_MISMATCH',
  TERMINOLOGY_DUPLICATE_CONCEPT: 'TERMINOLOGY_DUPLICATE_CONCEPT',
  PERSISTENT_IDS_DUPLICATE: 'PERSISTENT_IDS_DUPLICATE',
  TERMINOLOGY_LABEL_MISMATCH: 'TERMINOLOGY_LABEL_MISMATCH',
  PERSISTENT_CONCEPT_UNKNOWN: 'PERSISTENT_CONCEPT_UNKNOWN',
  PERSISTENT_CONCEPT_MISSING_TERMINOLOGY: 'PERSISTENT_CONCEPT_MISSING_TERMINOLOGY',
  RECURRING_CONCEPT_NOT_DECLARED_PERSISTENT: 'RECURRING_CONCEPT_NOT_DECLARED_PERSISTENT',
  SECTION_CONTRACT_MISSING: 'SECTION_CONTRACT_MISSING',
  LEARNING_DELTA_MISMATCH: 'LEARNING_DELTA_MISMATCH',
  DURATION_MISMATCH: 'DURATION_MISMATCH',
  REQUIRED_CONCEPTS_DUPLICATE: 'REQUIRED_CONCEPTS_DUPLICATE',
  CONCEPTIDS_CONTRACT_MISMATCH: 'CONCEPTIDS_CONTRACT_MISMATCH',
  REQUIRED_CONCEPT_UNKNOWN: 'REQUIRED_CONCEPT_UNKNOWN',
  REQUIRED_RELATIONS_DUPLICATE: 'REQUIRED_RELATIONS_DUPLICATE',
  UNSUPPORTED_RELATION: 'UNSUPPORTED_RELATION',
  SECTION_OMITS_SOURCE_RELATION: 'SECTION_OMITS_SOURCE_RELATION',
  EVIDENCE_SPANS_DUPLICATE: 'EVIDENCE_SPANS_DUPLICATE',
  EVIDENCE_SPAN_OMITTED: 'EVIDENCE_SPAN_OMITTED',
  EVIDENCE_SPAN_UNRELATED: 'EVIDENCE_SPAN_UNRELATED',
  LESSON_OMITS_SOURCE_RELATION: 'LESSON_OMITS_SOURCE_RELATION',
} as const;

export type ContractCode = (typeof CONTRACT_CODES)[keyof typeof CONTRACT_CODES];
export interface ContractFinding { code: ContractCode; message: string }

/** S3 checks are code-owned. A plausible learning goal is not evidence for a visual claim. Returns one finding per violation, with a stable machine code so a calibration harness can count failures by rule across many attempts. */
export function teachingContractFindings(plan: TeachingPlan, graph: ConceptGraph, audience?: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const push = (code: ContractCode, message: string) => findings.push({ code, message });
  const concepts = new Map(graph.concepts.map((concept) => [concept.id, concept]));
  const relations = new Map(graph.relations.map((relation) => [relationKey(relation), relation]));
  const conceptSceneCounts = new Map<string, number>();
  for (const section of plan.sections) for (const conceptId of new Set(section.conceptIds)) conceptSceneCounts.set(conceptId, (conceptSceneCounts.get(conceptId) ?? 0) + 1);
  const bible = plan.lessonBible;
  if (!bible) push(CONTRACT_CODES.LESSON_BIBLE_MISSING, 'lessonBible is required for generated lessons');
  else {
    if (audience && bible.audience !== audience) push(CONTRACT_CODES.AUDIENCE_MISMATCH, 'lessonBible audience must match the learner request');
    const terminologyIds = bible.terminology.map((item) => item.conceptId);
    if (new Set(terminologyIds).size !== terminologyIds.length) push(CONTRACT_CODES.TERMINOLOGY_DUPLICATE_CONCEPT, 'lessonBible terminology must map each concept at most once');
    if (new Set(bible.persistentConceptIds).size !== bible.persistentConceptIds.length) push(CONTRACT_CODES.PERSISTENT_IDS_DUPLICATE, 'lessonBible persistentConceptIds must be unique');
    for (const item of bible.terminology) {
      const concept = concepts.get(item.conceptId);
      if (!concept || item.label !== concept.label) push(CONTRACT_CODES.TERMINOLOGY_LABEL_MISMATCH, `lessonBible terminology for ${item.conceptId} must use its source concept label`);
    }
    for (const conceptId of bible.persistentConceptIds) {
      if (!concepts.has(conceptId)) push(CONTRACT_CODES.PERSISTENT_CONCEPT_UNKNOWN, `lessonBible has unknown persistent concept ${conceptId}`);
      if (!terminologyIds.includes(conceptId)) push(CONTRACT_CODES.PERSISTENT_CONCEPT_MISSING_TERMINOLOGY, `lessonBible persistent concept ${conceptId} lacks a canonical terminology entry`);
    }
    for (const [conceptId, scenes] of conceptSceneCounts) {
      if (scenes > 1 && !bible.persistentConceptIds.includes(conceptId)) push(CONTRACT_CODES.RECURRING_CONCEPT_NOT_DECLARED_PERSISTENT, `lessonBible must declare recurring concept ${conceptId} persistent across scenes`);
    }
  }
  for (const section of plan.sections) {
    const contract = section.contract;
    if (!contract) { push(CONTRACT_CODES.SECTION_CONTRACT_MISSING, `${section.id} lacks a SceneContract`); continue; }
    if (contract.learningDelta.trim() !== section.goal.trim()) push(CONTRACT_CODES.LEARNING_DELTA_MISMATCH, `${section.id} contract learningDelta must equal the section goal`);
    if (contract.targetDurationSec !== section.budgetSec) push(CONTRACT_CODES.DURATION_MISMATCH, `${section.id} contract targetDurationSec must equal section budgetSec`);
    if (new Set(contract.requiredConceptIds).size !== contract.requiredConceptIds.length) push(CONTRACT_CODES.REQUIRED_CONCEPTS_DUPLICATE, `${section.id} repeats required concepts`);
    if (section.conceptIds.length === 0 || [...section.conceptIds].sort().join('|') !== [...contract.requiredConceptIds].sort().join('|')) push(CONTRACT_CODES.CONCEPTIDS_CONTRACT_MISMATCH, `${section.id} contract concepts must exactly match its nonempty section conceptIds`);
    const allowedSpanIds = new Set<string>();
    for (const conceptId of contract.requiredConceptIds) {
      const concept = concepts.get(conceptId);
      if (!concept) push(CONTRACT_CODES.REQUIRED_CONCEPT_UNKNOWN, `${section.id} requires unknown concept ${conceptId}`);
      else for (const evidence of concept.evidence) allowedSpanIds.add(evidence.spanId);
    }
    const requiredRelations = graph.relations.filter((relation) => contract.requiredConceptIds.includes(relation.from) && contract.requiredConceptIds.includes(relation.to));
    const listed = new Set(contract.requiredRelations.map(relationKey));
    if (listed.size !== contract.requiredRelations.length) push(CONTRACT_CODES.REQUIRED_RELATIONS_DUPLICATE, `${section.id} repeats required relations`);
    for (const relation of contract.requiredRelations) {
      const source = relations.get(relationKey(relation));
      if (!source || !contract.requiredConceptIds.includes(relation.from) || !contract.requiredConceptIds.includes(relation.to)) push(CONTRACT_CODES.UNSUPPORTED_RELATION, `${section.id} has unsupported relation ${relationKey(relation)}`);
      else for (const evidence of source.evidence) allowedSpanIds.add(evidence.spanId);
    }
    for (const relation of requiredRelations) if (!listed.has(relationKey(relation))) push(CONTRACT_CODES.SECTION_OMITS_SOURCE_RELATION, `${section.id} omits source relation ${relationKey(relation)}`);
    if (new Set(contract.evidenceSpanIds).size !== contract.evidenceSpanIds.length) push(CONTRACT_CODES.EVIDENCE_SPANS_DUPLICATE, `${section.id} repeats evidence spans`);
    for (const spanId of allowedSpanIds) if (!contract.evidenceSpanIds.includes(spanId)) push(CONTRACT_CODES.EVIDENCE_SPAN_OMITTED, `${section.id} omits evidence span ${spanId}`);
    for (const spanId of contract.evidenceSpanIds) if (!allowedSpanIds.has(spanId)) push(CONTRACT_CODES.EVIDENCE_SPAN_UNRELATED, `${section.id} has unrelated evidence span ${spanId}`);
  }
  for (const relation of graph.relations) {
    if (!plan.sections.some((section) => section.contract?.requiredRelations.some((required) => relationKey(required) === relationKey(relation)))) {
      push(CONTRACT_CODES.LESSON_OMITS_SOURCE_RELATION, `lesson omits source relation ${relationKey(relation)} from every SceneContract`);
    }
  }
  return findings;
}

/** String-only view of `teachingContractFindings`, kept for existing callers/tests that treat this as a plain message list. */
export function teachingContractProblems(plan: TeachingPlan, graph: ConceptGraph, audience?: string): string[] {
  return teachingContractFindings(plan, graph, audience).map((finding) => finding.message);
}

/**
 * Build the full TeachingPlan from the S3 model's draft (see
 * TeachingPlanDraftSchema). Deterministic: every derived field is a function
 * of the draft and the S2 graph.
 * - contract.learningDelta = goal, targetDurationSec = budgetSec,
 *   requiredConceptIds = conceptIds;
 * - requiredRelations = every graph relation with both endpoints in the section;
 * - evidenceSpanIds = the cited spans of those concepts and relations;
 * - lessonBible: every taught graph concept gets its exact graph label as
 *   its term; concepts taught in more than one section are persistent, so S6
 *   must draw them with that term in every scene.
 * Nothing is invented: an unknown concept ID is kept, so
 * teachingContractFindings still rejects it, and a relation whose endpoints
 * never share a section is still reported as LESSON_OMITS_SOURCE_RELATION.
 */
export function deriveTeachingPlan(draft: TeachingPlanDraft, graph: ConceptGraph, audience: string): TeachingPlan {
  const concepts = new Map(graph.concepts.map((concept) => [concept.id, concept]));
  const sectionCounts = new Map<string, number>();
  for (const section of draft.sections) for (const conceptId of new Set(section.conceptIds)) sectionCounts.set(conceptId, (sectionCounts.get(conceptId) ?? 0) + 1);
  const taught = [...sectionCounts.keys()].filter((conceptId) => concepts.has(conceptId));
  const persistentConceptIds = taught.filter((conceptId) => sectionCounts.get(conceptId)! > 1);
  return {
    targetDurationSec: draft.targetDurationSec,
    intro: draft.intro,
    lessonBible: {
      audience,
      ...(draft.domain ? { domain: draft.domain } : {}),
      terminology: taught.map((conceptId) => ({ conceptId, label: concepts.get(conceptId)!.label })),
      persistentConceptIds,
    },
    sections: draft.sections.map(({ teachingSkill, candidateMechanisms, ...section }) => {
      const conceptIds = [...new Set(section.conceptIds)];
      const requiredRelations = graph.relations.filter((relation) => conceptIds.includes(relation.from) && conceptIds.includes(relation.to));
      const evidenceSpanIds = [...new Set([
        ...conceptIds.flatMap((conceptId) => concepts.get(conceptId)?.evidence.map((ref) => ref.spanId) ?? []),
        ...requiredRelations.flatMap((relation) => relation.evidence.map((ref) => ref.spanId)),
      ])];
      return {
        ...section,
        conceptIds,
        contract: {
          learningDelta: section.goal,
          targetDurationSec: section.budgetSec,
          requiredConceptIds: conceptIds,
          requiredRelations: requiredRelations.map(({ from, to, type }) => ({ from, to, type })),
          evidenceSpanIds,
          teachingSkill,
          candidateMechanisms,
        },
      };
    }),
    recap: draft.recap,
  };
}

import { recordCoercion } from '../structured/coercionLedger.js';
import { claimSemanticsFromText } from '../evidence/claims.js';
import { claimVerificationStatusFor, epistemicClaimProblems } from '../evidence/ledger.js';
import type { ConceptGraph, TeachingPlan, TeachingPlanDraft } from './schemas.js';
import { fitBudgetsToTarget, rebalanceSceneBudgets } from './analyze.js';

const relationKey = (relation: { from: string; to: string; type: string }): string => `${relation.from}|${relation.type}|${relation.to}`;

/** Rebuild hash-pinned claim provenance from graph evidence and the claim's explicit span IDs. */
export function deriveClaimSourceRefs(
  claim: Pick<NonNullable<TeachingPlan['sections'][number]['contract']>['essentialClaims'][number], 'conceptIds' | 'relations' | 'evidenceSpanIds'>,
  graph: ConceptGraph,
) {
  const citedSpans = new Set(claim.evidenceSpanIds);
  const concepts = new Map(graph.concepts.map((concept) => [concept.id, concept]));
  const sourceEvidence = [
    ...claim.conceptIds.flatMap((conceptId) => concepts.get(conceptId)?.evidence ?? []),
    ...claim.relations.flatMap((relation) => graph.relations.find((source) => relationKey(source) === relationKey(relation))?.evidence ?? []),
  ].filter((ref) => citedSpans.has(ref.spanId));
  return [...new Map(sourceEvidence.filter((ref) => ref.documentSha256 && ref.quoteSha256).map((ref) => [
    `${ref.sourceId}:${ref.spanId}:${ref.startChar}:${ref.endChar}:${ref.quoteSha256}:${ref.sourceRole ?? 'primary'}`,
    { documentId: ref.sourceId, sourceHash: ref.documentSha256!, spanId: ref.spanId, startOffset: ref.startChar, endOffset: ref.endChar, quoteHash: ref.quoteSha256!, sourceRole: ref.sourceRole ?? 'primary' },
  ])).values()];
}

/** Rebuild claim semantics and source refs for full-plan variants; neither field is model-owned. */
export function canonicalizePlanClaims(plan: TeachingPlan, graph: ConceptGraph): TeachingPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => section.contract ? {
      ...section,
      contract: {
        ...section.contract,
        essentialClaims: section.contract.essentialClaims.map((claim) => {
          const { semantics: _untrustedSemantics, sourceRefs: _untrustedSourceRefs, verificationStatus: _untrustedStatus, ...claimFields } = claim;
          const semantics = claimSemanticsFromText(claim.statement);
          const sourceRefs = deriveClaimSourceRefs(claim, graph);
          const verificationStatus = claim.epistemicType ? claimVerificationStatusFor(claim.epistemicType) : undefined;
          return {
            ...claimFields,
            ...(semantics ? { semantics } : {}),
            ...(verificationStatus ? { verificationStatus } : {}),
            ...(sourceRefs.length ? { sourceRefs } : {}),
          };
        }),
      },
    } : section),
  };
}

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
  ESSENTIAL_CLAIMS_MISSING: 'ESSENTIAL_CLAIMS_MISSING',
  ESSENTIAL_CLAIM_DUPLICATE: 'ESSENTIAL_CLAIM_DUPLICATE',
  ESSENTIAL_CLAIM_CONCEPT: 'ESSENTIAL_CLAIM_CONCEPT',
  ESSENTIAL_CLAIM_RELATION: 'ESSENTIAL_CLAIM_RELATION',
  ESSENTIAL_CLAIM_EVIDENCE: 'ESSENTIAL_CLAIM_EVIDENCE',
  ESSENTIAL_CLAIM_EPISTEMIC_TYPE: 'ESSENTIAL_CLAIM_EPISTEMIC_TYPE',
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
  const claimIds = new Set<string>();
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
    const claims = contract.essentialClaims ?? [];
    if (!claims.length) push(CONTRACT_CODES.ESSENTIAL_CLAIMS_MISSING, `${section.id} needs at least one essential claim`);
    if (new Set(claims.map((claim) => claim.id)).size !== claims.length) push(CONTRACT_CODES.ESSENTIAL_CLAIM_DUPLICATE, `${section.id} repeats an essential claim id`);
    for (const claim of claims) {
      if (claimIds.has(claim.id)) push(CONTRACT_CODES.ESSENTIAL_CLAIM_DUPLICATE, `${section.id} repeats lesson claim id ${claim.id}`);
      claimIds.add(claim.id);
      for (const problem of epistemicClaimProblems({ id: claim.id, statement: claim.statement, relations: claim.relations, epistemicType: claim.epistemicType })) {
        push(CONTRACT_CODES.ESSENTIAL_CLAIM_EPISTEMIC_TYPE, `${section.id} ${problem}`);
      }
      const linkedEvidence = new Set<string>();
      for (const conceptId of claim.conceptIds) {
        if (!contract.requiredConceptIds.includes(conceptId) || !concepts.has(conceptId)) push(CONTRACT_CODES.ESSENTIAL_CLAIM_CONCEPT, `${section.id} claim ${claim.id} links an invalid concept ${conceptId}`);
        else for (const ref of concepts.get(conceptId)!.evidence) linkedEvidence.add(ref.spanId);
      }
      if (new Set(claim.conceptIds).size !== claim.conceptIds.length) push(CONTRACT_CODES.ESSENTIAL_CLAIM_CONCEPT, `${section.id} claim ${claim.id} repeats a concept`);
      if (new Set(claim.relations.map(relationKey)).size !== claim.relations.length) push(CONTRACT_CODES.ESSENTIAL_CLAIM_RELATION, `${section.id} claim ${claim.id} repeats a relation`);
      for (const relation of claim.relations) {
        const source = relations.get(relationKey(relation));
        if (!source || !listed.has(relationKey(relation))) push(CONTRACT_CODES.ESSENTIAL_CLAIM_RELATION, `${section.id} claim ${claim.id} links an invalid relation ${relationKey(relation)}`);
        if (!claim.conceptIds.includes(relation.from) || !claim.conceptIds.includes(relation.to)) push(CONTRACT_CODES.ESSENTIAL_CLAIM_RELATION, `${section.id} claim ${claim.id} relation endpoints must be linked concepts`);
        if (source && listed.has(relationKey(relation))) for (const ref of source.evidence) linkedEvidence.add(ref.spanId);
      }
      if (new Set(claim.evidenceSpanIds).size !== claim.evidenceSpanIds.length) push(CONTRACT_CODES.ESSENTIAL_CLAIM_EVIDENCE, `${section.id} claim ${claim.id} repeats evidence`);
      for (const spanId of claim.evidenceSpanIds) if (!linkedEvidence.has(spanId) || !contract.evidenceSpanIds.includes(spanId)) push(CONTRACT_CODES.ESSENTIAL_CLAIM_EVIDENCE, `${section.id} claim ${claim.id} cites unsupported evidence ${spanId}`);
      if (!claim.evidenceSpanIds.length && claim.epistemicType !== 'unverified_explanation') push(CONTRACT_CODES.ESSENTIAL_CLAIM_EVIDENCE, `${section.id} claim ${claim.id} needs linked source evidence`);
    }
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
/**
 * A concept is taught after the concepts it needs. The model's section order is kept except where a prerequisite is taught
 * later; then the section waits for it (stable topological order, recap sections stay last, cycles keep the model's order).
 * Ordering is bookkeeping derived from the S2 graph, so it is done in code instead of spending a model repair.
 */
export function orderSectionsByPrerequisites<T extends { kind: string; conceptIds: string[] }>(sections: readonly T[], graph: ConceptGraph): T[] {
  const needs = new Map<string, string[]>();
  for (const prerequisite of graph.prerequisites) needs.set(prerequisite.concept, [...(needs.get(prerequisite.concept) ?? []), prerequisite.needs]);
  const recaps = sections.filter((section) => section.kind === 'recap');
  const remaining = sections.filter((section) => section.kind !== 'recap');
  const placed: T[] = [];
  const taught = new Set<string>();
  while (remaining.length) {
    const blocked = (section: T): boolean => section.conceptIds.some((conceptId) => !taught.has(conceptId) && (needs.get(conceptId) ?? []).some((need) => !section.conceptIds.includes(need) && !taught.has(need) && remaining.some((other) => other !== section && other.conceptIds.includes(need))));
    const next = remaining.find((section) => !blocked(section)) ?? remaining[0]!;
    remaining.splice(remaining.indexOf(next), 1);
    placed.push(next);
    for (const conceptId of next.conceptIds) taught.add(conceptId);
  }
  return [...placed, ...recaps];
}

/**
 * Claim ids must be unique across the whole lesson, but each module plan is written on its own and may reuse an id.
 * A repeated id gets a numeric suffix (everywhere that section names it), so no module can invalidate the lesson.
 */
export function uniquifyClaimIds(plan: TeachingPlan, taken: Set<string>): TeachingPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => {
      const contract = section.contract;
      if (!contract) return section;
      const rename = new Map<string, string>();
      for (const claim of contract.essentialClaims) {
        let id = claim.id;
        for (let n = 2; taken.has(id); n++) id = `${claim.id.slice(0, 36)}_${n}`;
        taken.add(id);
        if (id !== claim.id) rename.set(claim.id, id);
      }
      if (!rename.size) return section;
      return {
        ...section,
        contract: {
          ...contract,
          essentialClaims: contract.essentialClaims.map((claim) => ({ ...claim, id: rename.get(claim.id) ?? claim.id })),
          ...(contract.semanticVisualIntents ? { semanticVisualIntents: contract.semanticVisualIntents.map((intent) => ({ ...intent, claimId: rename.get(intent.claimId) ?? intent.claimId })) } : {}),
        },
      };
    }),
  };
}

export function deriveTeachingPlan(rawDraft: TeachingPlanDraft, graph: ConceptGraph, audience: string): TeachingPlan {
  const draft: TeachingPlanDraft = { ...rawDraft, sections: fitBudgetsToTarget(rebalanceSceneBudgets(orderSectionsByPrerequisites(rawDraft.sections, graph), (section) => section.essentialClaims.length), rawDraft.targetDurationSec, (section) => section.essentialClaims.length) };
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
    sections: draft.sections.map(({ teachingSkill, candidateMechanisms, essentialClaims, visualForm, mentalModel, misconceptionRisk, semanticVisualIntents, ...section }, sectionIndex) => {
      const earlierConceptIds = new Set(draft.sections.slice(0, sectionIndex).flatMap((earlier) => earlier.conceptIds));
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
          essentialClaims: essentialClaims.map((claim) => {
            const { semantics: _untrustedSemantics, sourceRefs: _untrustedSourceRefs, verificationStatus: _untrustedStatus, ...claimFields } = claim;
            const semantics = claimSemanticsFromText(claim.statement);
            const sourceRefs = deriveClaimSourceRefs(claim, graph);
            const verificationStatus = claim.epistemicType ? claimVerificationStatusFor(claim.epistemicType) : undefined;
            return {
              ...claimFields,
              ...(semantics ? { semantics } : {}),
              ...(verificationStatus ? { verificationStatus } : {}),
              ...(sourceRefs.length ? { sourceRefs } : {}),
              // A visual target is independently checked against the claim's cited evidence.
              // Fill in every graph-backed span for the concepts/relations linked by the claim
              // so S6 can cite the specific node/edge evidence it actually depicts.
              // Only spans the graph backs for the claim's concepts and relations can support it; a span the model added
              // that the graph does not back is dropped here instead of failing the contract.
              evidenceSpanIds: (() => {
                const backed = [...new Set([
                  ...claim.conceptIds.flatMap((conceptId) => concepts.get(conceptId)?.evidence.map((ref) => ref.spanId) ?? []),
                  ...claim.relations.flatMap((relation) => graph.relations.find((source) => relationKey(source) === relationKey(relation))?.evidence.map((ref) => ref.spanId) ?? []),
                ])];
                const given = claim.evidenceSpanIds;
                if (claim.epistemicType === 'unverified_explanation') {
                  for (const spanId of given) if (!backed.includes(spanId)) recordCoercion({ path: `/essentialClaims/${claim.id}/evidenceSpanIds/${spanId}`, oldValue: spanId, newValue: undefined, reason: 'claim-evidence-span-not-backed-by-graph', semanticRisk: 'semantic' });
                  return given.filter((spanId) => backed.includes(spanId)).slice(0, 96);
                }
                for (const spanId of given) if (!backed.includes(spanId)) recordCoercion({ path: `/essentialClaims/${claim.id}/evidenceSpanIds/${spanId}`, oldValue: spanId, newValue: undefined, reason: 'claim-evidence-span-not-backed-by-graph', semanticRisk: 'semantic' });
                for (const spanId of backed) if (!given.includes(spanId)) recordCoercion({ path: `/essentialClaims/${claim.id}/evidenceSpanIds/${spanId}`, oldValue: undefined, newValue: spanId, reason: 'claim-evidence-span-added-from-graph', semanticRisk: 'low' });
                return [...new Set([...claim.evidenceSpanIds.filter((spanId) => backed.includes(spanId)), ...backed])].slice(0, 96);
              })(),
            };
          }),
          teachingSkill,
          candidateMechanisms,
          priorKnowledge: [...new Set(conceptIds.filter((conceptId) => earlierConceptIds.has(conceptId)).map((conceptId) => concepts.get(conceptId)?.label).filter((label): label is string => Boolean(label)))].slice(0, 8),
          ...(visualForm ? { visualForm } : {}),
          ...(mentalModel ? { mentalModel } : {}),
          ...(misconceptionRisk?.length ? { misconceptionRisk } : {}),
          ...(semanticVisualIntents?.length ? { semanticVisualIntents } : {}),
        },
      };
    }),
    recap: draft.recap,
  };
}

/**
 * Teaching Director completeness (final_plan/03 §10, 01 §4.3). The draft variant must state, per scene,
 * the mental model, at most two misconceptions, and one semantic visual intent per visualized claim whose
 * concepts come from that claim. Unverified explanations have no visual intent. Each problem tells the model what to add.
 */
export function teachingDirectorProblems(plan: TeachingPlan): string[] {
  const problems: string[] = [];
  for (const section of plan.sections) {
    const contract = section.contract;
    if (!contract) continue;
    if (!contract.mentalModel) problems.push(`section ${section.id} needs a mentalModel: one sentence naming the model the learner builds`);
    if (contract.essentialClaims.length > 0 && contract.essentialClaims.every((claim) => claim.epistemicType === 'unverified_explanation') && contract.visualForm) {
      problems.push(`section ${section.id}: a scene containing only unverified explanations must omit visualForm`);
    }
    const claimById = new Map(contract.essentialClaims.map((claim) => [claim.id, claim]));
    const intents = contract.semanticVisualIntents ?? [];
    for (const intent of intents) {
      const claim = claimById.get(intent.claimId);
      if (!claim) { problems.push(`section ${section.id}: semanticVisualIntent names unknown claim ${intent.claimId}`); continue; }
      const outside = intent.conceptIds.filter((conceptId) => !claim.conceptIds.includes(conceptId));
      if (outside.length) problems.push(`section ${section.id}: intent for claim ${intent.claimId} cites concepts outside the claim (${outside.join(', ')})`);
    }
    for (const claim of contract.essentialClaims) {
      const claimIntent = intents.some((intent) => intent.claimId === claim.id);
      if (claim.epistemicType === 'unverified_explanation') {
        if (claimIntent) problems.push(`section ${section.id}: unverified explanation claim ${claim.id} must not have a semanticVisualIntent`);
      } else if (!claimIntent) problems.push(`section ${section.id}: essential claim ${claim.id} needs a semanticVisualIntent (conceptType + strategy)`);
    }
  }
  return problems;
}

const claimTokens = (statement: string): Set<string> => new Set((statement.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 3));

/** Scenes must not re-teach: two claims in different scenes with heavy token overlap are a restatement. */
export function continuityProblems(plan: TeachingPlan): string[] {
  const problems: string[] = [];
  const seen: Array<{ sectionId: string; claimId: string; tokens: Set<string> }> = [];
  for (const section of plan.sections) {
    // A recap exists to bring earlier ideas back together; only a non-recap scene may not re-teach.
    const isRecap = section.kind === 'recap' || section.contract?.teachingSkill === 'recap';
    for (const claim of section.contract?.essentialClaims ?? []) {
      const tokens = claimTokens(claim.statement);
      if (tokens.size < 4) continue;
      for (const earlier of isRecap ? [] : seen) {
        if (earlier.sectionId === section.id) continue;
        const shared = [...tokens].filter((token) => earlier.tokens.has(token)).length;
        if (shared / Math.min(tokens.size, earlier.tokens.size) >= 0.75) {
          problems.push(`continuity-restatement: claim ${claim.id} in ${section.id} repeats claim ${earlier.claimId} from ${earlier.sectionId}; a later scene must use the earlier idea in a new role`);
          break;
        }
      }
      seen.push({ sectionId: section.id, claimId: claim.id, tokens });
    }
  }
  return problems;
}

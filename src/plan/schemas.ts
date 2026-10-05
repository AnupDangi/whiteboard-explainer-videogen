import { clampText } from './clamp.js';
import { z } from 'zod';
import type { SourceEvidenceRef } from '../intake/sourceDoc.js';
import { MAX_TITLE_WORDS } from '../render/style.js';
import { ledgerPreprocess } from '../structured/coercionLedger.js';
import { ClaimSemanticsSchema } from '../evidence/claims.js';

/**
 * S2 ConceptGraph and S3 TeachingPlan (claude_pipeline.md §3 /
 * hypothesis/v1_claude/01 §2), validated with zod at the stage boundary.
 * Additions to the spec types, both optional-in-spirit and recorded here:
 *  - concept `level`: 'one-step' | 'multi-step', so the plan analyser can
 *    require one scene per step for multi-step math;
 *  - section `kind`, so intro/recap scenes are distinguishable from
 *    explanation and step scenes.
 */
const id = () => z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, 'ids are lowercase snake_case tokens');
const words = (max: number) => z.string().min(1).max(max * 12).refine((s) => s.trim().split(/\s+/).length <= max, `at most ${max} words`);

export const RELATION_TYPES = ['causes', 'feeds', 'contains', 'compares', 'transforms', 'requires', 'produces', 'opposes', 'supports', 'excepts', 'branches', 'precedes'] as const;

export const EvidenceQuoteSchema = z.object({ spanId: id(), quote: z.string().min(1).max(600) }).strict();

const ConceptSchema = z
  .object({
    id: id(),
    label: words(4),
    kind: z.enum(['entity', 'process', 'quantity', 'formula', 'event', 'role', 'rule']),
    definition: z.string().min(1).max(240),
    evidence: z.array(EvidenceQuoteSchema).min(1).max(3),
    latex: z.string().max(160).optional(),
    level: z.enum(['one-step', 'multi-step']),
  })
  .strict();

const CONCEPT_KINDS = ['entity', 'process', 'quantity', 'formula', 'event', 'role', 'rule'] as const;
/** Concept kind and level are advisory labels (they steer drawing and pacing); an unknown value takes the neutral default. */
function coerceConceptGraph(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).concepts)) return raw;
  const graph = raw as Record<string, unknown>;
  return {
    ...graph,
    concepts: (graph.concepts as unknown[]).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const concept = { ...(item as Record<string, unknown>) };
      if (!(CONCEPT_KINDS as readonly string[]).includes(String(concept.kind))) concept.kind = 'entity';
      if (concept.level !== 'one-step' && concept.level !== 'multi-step') concept.level = 'one-step';
      concept.definition = clampText(concept.definition, 240);
      if (typeof concept.latex === 'string' && concept.latex.length > 160) delete concept.latex;
      return concept;
    }),
  };
}

const conceptGraphSchema = (concept: z.ZodType<z.infer<typeof ConceptSchema>>) => ledgerPreprocess('concept-graph-coerce', coerceConceptGraph, z
  .object({
    concepts: z.array(concept).min(1).max(14),
    relations: z.array(z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES), evidence: z.array(EvidenceQuoteSchema).min(1).max(3) }).strict()).max(24),
    prerequisites: z.array(z.object({ concept: id(), needs: id() }).strict()).max(20),
  })
  .strict());

export const ConceptGraphSchema = conceptGraphSchema(ConceptSchema);

/**
 * Module-scoped S2: the syllabus already fixed each concept's label,
 * definition and cited evidence (pipeline/lesson.ts injects them), so the
 * model supplies concept kind/level/latex and the relations; concept
 * evidence may be empty. Relation evidence is still required and checked.
 */
export const ScopedConceptGraphSchema = conceptGraphSchema(ConceptSchema.extend({ evidence: z.array(EvidenceQuoteSchema).max(3) }) as unknown as z.ZodType<z.infer<typeof ConceptSchema>>);

export type ConceptGraphModel = z.infer<typeof ConceptGraphSchema>;
type ConceptModel = ConceptGraphModel['concepts'][number];
type RelationModel = ConceptGraphModel['relations'][number];
export interface ConceptNode extends Omit<ConceptModel, 'evidence'> { evidence: SourceEvidenceRef[] }
export interface ConceptRelation extends Omit<RelationModel, 'evidence'> { evidence: SourceEvidenceRef[] }
export interface ConceptGraph {
  concepts: ConceptNode[];
  relations: ConceptRelation[];
  prerequisites: ConceptGraphModel['prerequisites'];
}

export const SECTION_KINDS = ['intro', 'explain', 'step', 'example', 'recap'] as const;
/** Section titles become scene titles, so they share the scene-title limit. */
export const SECTION_TITLE_MAX_WORDS = MAX_TITLE_WORDS;

export const TEACHING_SKILLS = ['definition', 'mechanism', 'comparison', 'process', 'derivation', 'application', 'recap'] as const;
export const VISUAL_MECHANISMS = ['focus', 'chain', 'convergence', 'fan_out', 'weighted_blend', 'cycle', 'threshold', 'comparison', 'trajectory', 'equation', 'state_transition'] as const;

/** final_plan/01 §8: what kind of thing a claim depicts and how the representation should be built. */
export const VISUAL_CONCEPT_TYPES = ['entity', 'state', 'process', 'cause', 'condition', 'sequence', 'comparison', 'hierarchy', 'quantity', 'evidence', 'argument', 'system', 'math'] as const;
export const VISUAL_INTENT_STRATEGIES = ['literal', 'metaphor', 'state-change', 'topology', 'diagram', 'math', 'plot', 'code'] as const;

export const SemanticVisualIntentSchema = z.object({
  claimId: id(),
  conceptType: z.enum(VISUAL_CONCEPT_TYPES),
  strategy: z.enum(VISUAL_INTENT_STRATEGIES),
  conceptIds: z.array(id()).min(1).max(6),
  roles: z.array(z.string().min(1).max(48)).max(4),
  relationType: z.enum(RELATION_TYPES).optional(),
  topology: z.string().min(1).max(40).optional(),
}).strict();
export type SemanticVisualIntent = z.infer<typeof SemanticVisualIntentSchema>;

/** The single exact picture that carries a scene (final_plan/01 §8 exact renderer families). */
export const VISUAL_FORMS = ['process', 'comparison', 'array', 'geometry', 'formula', 'plot', 'number-line', 'matrix', 'worked-example', 'code'] as const;

export const LessonBibleSchema = z.object({
  audience: z.string().min(1).max(120),
  /** Optional broad subject label used only as a low-weight example retrieval signal. */
  domain: z.string().min(1).max(50).optional(),
  // A long lesson names up to 48 concepts across its modules (the syllabus limit), so the bible holds as many.
  terminology: z.array(z.object({ conceptId: id(), label: words(4) }).strict()).max(48),
  persistentConceptIds: z.array(id()).max(48),
}).strict();

export const SceneContractSchema = z.object({
  learningDelta: z.string().min(1).max(240),
  targetDurationSec: z.number().positive(),
  requiredConceptIds: z.array(id()).min(1).max(8),
  requiredRelations: z.array(z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES) }).strict()).max(24),
  evidenceSpanIds: z.array(id()).min(1).max(96),
  essentialClaims: z.array(z.object({
    id: id(),
    statement: z.string().trim().min(1).max(240),
    conceptIds: z.array(id()).min(1).max(6),
    relations: z.array(z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES) }).strict()).max(24),
    evidenceSpanIds: z.array(id()).min(1).max(96),
    /** Source citations are reconstructed from the canonical concept graph, never trusted from S3 output. */
    sourceRefs: z.array(z.object({
      documentId: id(),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
      spanId: id(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().positive(),
      quoteHash: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict().refine((ref) => ref.endOffset > ref.startOffset, 'invalid claim source range')).max(96).optional(),
    /** Deterministically derived protected cues carried by this canonical claim, when present. */
    semantics: ClaimSemanticsSchema.optional(),
  }).strict()).min(1).max(8),
  teachingSkill: z.enum(TEACHING_SKILLS),
  candidateMechanisms: z.array(z.enum(VISUAL_MECHANISMS)).min(1).max(3),
  // Teaching Director fields (final_plan/03 §10). Optional at the schema boundary so older fixtures and
  // cached plans still parse; generated lessons must supply them (plan validation enforces it).
  /** Concept labels the learner should already own, derived by code from earlier scenes. */
  priorKnowledge: z.array(z.string().min(1).max(80)).max(8).optional(),
  /** The one picture that carries the scene; array, geometry and worked-example are binding on the board. */
  visualForm: z.enum(VISUAL_FORMS).optional(),
  /** The one mental model the learner builds in this scene. */
  mentalModel: z.string().trim().min(1).max(160).optional(),
  /** Wrong ideas this scene must prevent (at most two). */
  misconceptionRisk: z.array(z.string().trim().min(1).max(160)).max(2).optional(),
  /** Per claim: what kind of thing it depicts and the representation strategy. */
  semanticVisualIntents: z.array(SemanticVisualIntentSchema).max(8).optional(),
}).strict();

export type LessonBible = z.infer<typeof LessonBibleSchema>;
export type SceneContract = z.infer<typeof SceneContractSchema>;

export const TeachingPlanSchema = z
  .object({
    targetDurationSec: z.number().positive(),
    intro: z.object({ sourceTitle: z.string().min(1).max(80), sections: z.array(z.string().min(1).max(80)).max(12) }).strict(),
    /** Optional at the schema boundary for old fixtures; required by buildTeachingPlan validation for generated lessons. */
    lessonBible: LessonBibleSchema.optional(),
    sections: z
      .array(
        z
          .object({
            id: id(),
            title: words(SECTION_TITLE_MAX_WORDS),
            goal: z.string().min(1).max(240),
            kind: z.enum(SECTION_KINDS),
            conceptIds: z.array(id()).max(6),
            budgetSec: z.number().positive(),
            contract: SceneContractSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    recap: z.object({ keyPoints: z.array(z.string().min(1).max(160)).max(6) }).strict(),
  })
  .strict();

export type TeachingPlan = z.infer<typeof TeachingPlanSchema>;

/**
 * What the S3 model writes under the `v6-derived-contracts` prompt: the
 * teaching decisions only. Each SceneContract (goal, duration, concepts,
 * relations, evidence spans) and the LessonBible are then built in code from
 * this draft and the S2 graph (plan/contracts.ts deriveTeachingPlan), because
 * every one of those fields is a copy of data the pipeline already has; the
 * measured S3 failures were copying mistakes (empty terminology, empty
 * relation lists, mismatched concept lists). Checks that express real
 * planning quality (every source relation taught, prerequisite order,
 * pacing) still run on the derived plan and still fail it.
 */
const SectionDraftSchema = z.object({
  id: id(),
  title: words(SECTION_TITLE_MAX_WORDS),
  goal: z.string().min(1).max(240),
  kind: z.enum(SECTION_KINDS),
  conceptIds: z.array(id()).min(1).max(6),
  budgetSec: z.number().positive(),
  teachingSkill: z.enum(TEACHING_SKILLS),
  candidateMechanisms: z.array(z.enum(VISUAL_MECHANISMS)).min(1).max(3),
  essentialClaims: SceneContractSchema.shape.essentialClaims,
  visualForm: SceneContractSchema.shape.visualForm,
  mentalModel: SceneContractSchema.shape.mentalModel,
  misconceptionRisk: SceneContractSchema.shape.misconceptionRisk,
  semanticVisualIntents: SceneContractSchema.shape.semanticVisualIntents,
}).strict();

/** Accept a plan in the older full shape by lifting its model-owned fields; copied contract/bible fields are dropped and rebuilt. */
function liftLegacyPlan(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { lessonBible, sections, ...rest } = raw as Record<string, unknown>;
  const domain = lessonBible && typeof lessonBible === 'object' ? (lessonBible as Record<string, unknown>).domain : undefined;
  return {
    ...rest,
    ...(typeof domain === 'string' && !('domain' in rest) ? { domain } : {}),
    sections: Array.isArray(sections) ? sections.map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
      const { contract, ...fields } = section as Record<string, unknown>;
      const legacy = contract && typeof contract === 'object' ? contract as Record<string, unknown> : {};
      return { ...fields, ...('teachingSkill' in fields || !legacy.teachingSkill ? {} : { teachingSkill: legacy.teachingSkill }), ...('candidateMechanisms' in fields || !legacy.candidateMechanisms ? {} : { candidateMechanisms: legacy.candidateMechanisms }), ...('essentialClaims' in fields || !legacy.essentialClaims ? {} : { essentialClaims: legacy.essentialClaims }), ...('visualForm' in fields || !legacy.visualForm ? {} : { visualForm: legacy.visualForm }), ...('mentalModel' in fields || !legacy.mentalModel ? {} : { mentalModel: legacy.mentalModel }), ...('misconceptionRisk' in fields || !legacy.misconceptionRisk ? {} : { misconceptionRisk: legacy.misconceptionRisk }), ...('semanticVisualIntents' in fields || !legacy.semanticVisualIntents ? {} : { semanticVisualIntents: legacy.semanticVisualIntents }) };
    }) : sections,
  };
}

/** Default representation strategy for a claim of a given concept type (final_plan/01 §8 vocabulary). */
const STRATEGY_FOR_CONCEPT_TYPE: Record<string, (typeof VISUAL_INTENT_STRATEGIES)[number]> = {
  entity: 'literal', state: 'state-change', process: 'diagram', cause: 'topology', condition: 'topology', sequence: 'topology',
  comparison: 'topology', hierarchy: 'topology', quantity: 'plot', evidence: 'metaphor', argument: 'topology', system: 'diagram', math: 'math',
};

/**
 * The advisory enums (candidateMechanisms, intent strategy) are coerced, not rejected: an unknown mechanism is
 * dropped and an unknown strategy falls back to the one implied by the intent's own conceptType. Facts, claims
 * and relations are never coerced.
 */
function coerceAdvisoryFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const plan = raw as Record<string, unknown>;
  if (!Array.isArray(plan.sections)) return raw;
  const recap = plan.recap && typeof plan.recap === 'object' && Array.isArray((plan.recap as Record<string, unknown>).keyPoints)
    ? { ...(plan.recap as Record<string, unknown>), keyPoints: ((plan.recap as Record<string, unknown>).keyPoints as unknown[]).slice(0, 6).map((point) => clampText(point, 160)) } : plan.recap;
  const intro = plan.intro && typeof plan.intro === 'object'
    ? { ...(plan.intro as Record<string, unknown>), sourceTitle: clampText((plan.intro as Record<string, unknown>).sourceTitle, 80), ...(Array.isArray((plan.intro as Record<string, unknown>).sections) ? { sections: ((plan.intro as Record<string, unknown>).sections as unknown[]).slice(0, 12).map((item) => clampText(item, 80)) } : {}) } : plan.intro;
  return { ...plan, ...(recap !== undefined ? { recap } : {}), ...(intro !== undefined ? { intro } : {}), sections: plan.sections.map((section) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
    const fields = { ...(section as Record<string, unknown>) };
    // Scene kind and teaching skill are advisory labels: an unknown value falls back to the neutral one.
    if (fields.kind !== undefined && !(SECTION_KINDS as readonly string[]).includes(String(fields.kind))) fields.kind = 'explain';
    if (fields.teachingSkill !== undefined && !(TEACHING_SKILLS as readonly string[]).includes(String(fields.teachingSkill))) fields.teachingSkill = 'mechanism';
    if (fields.visualForm !== undefined && !(VISUAL_FORMS as readonly string[]).includes(String(fields.visualForm))) delete fields.visualForm;
    if (Array.isArray(fields.candidateMechanisms)) {
      const kept = [...new Set((fields.candidateMechanisms as unknown[]).filter((value): value is string => (VISUAL_MECHANISMS as readonly string[]).includes(String(value))))].slice(0, 3);
      fields.candidateMechanisms = kept.length ? kept : ['focus'];
    }
    if (Array.isArray(fields.misconceptionRisk)) fields.misconceptionRisk = (fields.misconceptionRisk as unknown[]).slice(0, 2).map((risk) => clampText(risk, 160));
    // Advisory prose over its limit is shortened, never a reason to lose the plan.
    if (fields.mentalModel !== undefined) fields.mentalModel = clampText(fields.mentalModel, 160);
    if (Array.isArray(fields.essentialClaims)) fields.essentialClaims = (fields.essentialClaims as unknown[]).map((claim) => (claim && typeof claim === 'object' && !Array.isArray(claim) ? { ...(claim as Record<string, unknown>), statement: clampText((claim as Record<string, unknown>).statement, 240) } : claim));
    if (Array.isArray(fields.semanticVisualIntents)) {
      fields.semanticVisualIntents = (fields.semanticVisualIntents as unknown[]).slice(0, 8).map((intent) => {
        if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return intent;
        const record = { ...(intent as Record<string, unknown>) };
        if (!(VISUAL_INTENT_STRATEGIES as readonly string[]).includes(String(record.strategy))) {
          record.strategy = STRATEGY_FOR_CONCEPT_TYPE[String(record.conceptType)] ?? 'diagram';
        }
        if (Array.isArray(record.roles)) record.roles = (record.roles as unknown[]).slice(0, 4).map((role) => (typeof role === 'string' ? role.slice(0, 48) : role));
        if (typeof record.topology === 'string') record.topology = record.topology.slice(0, 40);
        if (Array.isArray(record.conceptIds)) record.conceptIds = (record.conceptIds as unknown[]).slice(0, 6);
        return record;
      });
    }
    return fields;
  }) };
}

export const TeachingPlanDraftSchema = ledgerPreprocess('plan-advisory-coerce', (raw) => coerceAdvisoryFields(liftLegacyPlan(raw)), z.object({
  targetDurationSec: z.number().positive(),
  intro: z.object({ sourceTitle: z.string().min(1).max(80), sections: z.array(z.string().min(1).max(80)).max(12) }).strict(),
  /** Optional broad subject label, used only as a low-weight example-retrieval signal. */
  domain: z.string().min(1).max(50).optional(),
  sections: z.array(SectionDraftSchema).min(1).max(40),
  recap: z.object({ keyPoints: z.array(z.string().min(1).max(160)).max(6) }).strict(),
}).strict());

export type TeachingPlanDraft = z.infer<typeof TeachingPlanDraftSchema>;

/** S4 output: one narrated scene per section, with `[[id|spoken phrase]]` mention markers. */
export const ScriptSchema = z
  .object({
    scenes: z
      .array(z.object({ sectionId: id(), text: z.string().min(1).max(2000), claimSpans: z.array(z.object({ claimId: id(), exactText: z.string().min(1).max(500) }).strict()).optional() }).strict())
      .min(1)
      .max(40),
  })
  .strict();

export type Script = z.infer<typeof ScriptSchema>;

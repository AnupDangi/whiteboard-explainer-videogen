import { z } from 'zod';
import type { SourceEvidenceRef } from './sourceDoc.js';

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

export const RELATION_TYPES = ['causes', 'feeds', 'contains', 'compares', 'transforms', 'requires', 'produces', 'opposes'] as const;

export const EvidenceQuoteSchema = z.object({ spanId: id(), quote: z.string().min(1).max(600) }).strict();

export const ConceptGraphSchema = z
  .object({
    concepts: z
      .array(
        z
          .object({
            id: id(),
            label: words(4),
            kind: z.enum(['entity', 'process', 'quantity', 'formula', 'event', 'role', 'rule']),
            definition: z.string().min(1).max(240),
            evidence: z.array(EvidenceQuoteSchema).min(1).max(3),
            latex: z.string().max(160).optional(),
            level: z.enum(['one-step', 'multi-step']),
          })
          .strict(),
      )
      .min(1)
      .max(14),
    relations: z.array(z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES), evidence: z.array(EvidenceQuoteSchema).min(1).max(3) }).strict()).max(24),
    prerequisites: z.array(z.object({ concept: id(), needs: id() }).strict()).max(20),
  })
  .strict();

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
export const SECTION_TITLE_MAX_WORDS = 7;

export const TEACHING_SKILLS = ['definition', 'mechanism', 'comparison', 'process', 'derivation', 'application', 'recap'] as const;
export const VISUAL_MECHANISMS = ['focus', 'chain', 'convergence', 'fan_out', 'weighted_blend', 'cycle', 'threshold', 'comparison', 'trajectory', 'equation', 'state_transition'] as const;

export const LessonBibleSchema = z.object({
  audience: z.string().min(1).max(120),
  /** Optional broad subject label used only as a low-weight example retrieval signal. */
  domain: z.string().min(1).max(50).optional(),
  terminology: z.array(z.object({ conceptId: id(), label: words(4) }).strict()).max(14),
  persistentConceptIds: z.array(id()).max(14),
}).strict();

export const SceneContractSchema = z.object({
  learningDelta: z.string().min(1).max(240),
  targetDurationSec: z.number().positive(),
  requiredConceptIds: z.array(id()).min(1).max(8),
  requiredRelations: z.array(z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES) }).strict()).max(24),
  evidenceSpanIds: z.array(id()).min(1).max(96),
  teachingSkill: z.enum(TEACHING_SKILLS),
  candidateMechanisms: z.array(z.enum(VISUAL_MECHANISMS)).min(1).max(3),
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

/** S4 output: one narrated scene per section, with `[[id|spoken phrase]]` mention markers. */
export const ScriptSchema = z
  .object({
    scenes: z
      .array(z.object({ sectionId: id(), text: z.string().min(1).max(2000) }).strict())
      .min(1)
      .max(40),
  })
  .strict();

export type Script = z.infer<typeof ScriptSchema>;

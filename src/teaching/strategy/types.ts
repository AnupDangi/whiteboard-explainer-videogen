import { z } from 'zod';

/**
 * S3b Teaching Strategy Director inputs/outputs (STCC §7).
 * S3b answers ONE question: what teaching treatment is most likely to produce
 * the required learner delta? It is not narration, rendering, or asset lookup.
 * Strategy selection is a deterministic compiler policy over the S3 contract;
 * model-driven strategy choice may replace the policy later without changing
 * this contract.
 */
export const TEACHING_STRATEGIES = [
  'direct',
  'motivation',
  'intuition-example',
  'worked-example',
  'contrastive-example',
  'erroneous-example',
  'example-nonexample',
  'counterexample',
  'boundary-case',
  'predict-reveal',
  'faded-worked-example',
  'transfer-example',
  'mechanism-trace',
] as const;
export type TeachingStrategy = (typeof TEACHING_STRATEGIES)[number];

export const StrategyInputSchema = z.object({
  sceneId: z.string().min(1).max(60),
  /** S3 teaching skill for the scene. */
  teachingSkill: z.enum(['definition', 'mechanism', 'comparison', 'process', 'derivation', 'application', 'recap']),
  sectionKind: z.enum(['intro', 'explain', 'step', 'example', 'recap']),
  /** Wrong ideas this scene must prevent. */
  misconceptionCount: z.number().int().min(0).max(8),
  /** Concepts the learner meets for the first time in this scene. */
  newConceptCount: z.number().int().min(0).max(12),
  claimCount: z.number().int().min(1).max(8),
  budgetSec: z.number().positive(),
  hasMentalModel: z.boolean(),
  /** At least one claim turns on a threshold, limit, or edge condition. */
  hasBoundaryClaim: z.boolean(),
  /** At least one claim describes a state change over time. */
  hasStateChange: z.boolean(),
}).strict();
export type StrategyInput = z.infer<typeof StrategyInputSchema>;

export const StrategySelectionSchema = z.object({
  strategy: z.enum(TEACHING_STRATEGIES),
  /** Human-readable reasons, in priority order; the first is decisive. */
  reasons: z.array(z.string().min(1).max(160)).min(1).max(4),
}).strict();
export type StrategySelection = z.infer<typeof StrategySelectionSchema>;

export const TeachingStrategyPlanSchema = z.object({
  sceneId: z.string().min(1).max(60),
  strategy: z.enum(TEACHING_STRATEGIES),
  reasons: z.array(z.string().min(1).max(160)).min(1).max(4),
  /** Policy version that selected it; model-driven selection will carry its own version. */
  policyVersion: z.string().min(1).max(40),
}).strict();
export type TeachingStrategyPlan = z.infer<typeof TeachingStrategyPlanSchema>;

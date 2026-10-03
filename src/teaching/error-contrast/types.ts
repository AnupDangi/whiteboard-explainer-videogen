import { z } from 'zod';

/**
 * T5 ErrorContrast (STCC §10). A common mistake is never "wrong ❌ / correct ✅":
 * it is a structured divergence — shared reasoning, a decision point, the fork,
 * why the wrong path tempts, the violated invariant, the repair, and optionally
 * a transfer check. Semantic content only; S4 narrates it, S6 draws it.
 */
const id = () => z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, 'ids are lowercase snake_case tokens');

export const ReasoningStepSchema = z.object({
  step: z.string().min(1).max(200),
  /** Why this step is taken; empty only when self-evident from the problem. */
  why: z.string().max(200).optional(),
}).strict();

export const ExampleProblemSchema = z.object({
  problem: z.string().min(1).max(240),
  given: z.array(z.string().min(1).max(120)).max(6).optional(),
}).strict();

export const ErrorContrastSchema = z.object({
  misconceptionId: id(),
  problem: ExampleProblemSchema,
  /** Reasoning both paths share before they diverge; at least one step. */
  sharedPrefix: z.array(ReasoningStepSchema).min(1).max(6),
  divergence: z.object({
    decision: z.string().min(1).max(200),
    wrongStep: ReasoningStepSchema,
    correctStep: ReasoningStepSchema,
    whyWrongSeemsPlausible: z.string().min(1).max(240),
    violatedInvariant: z.string().min(1).max(200),
  }).strict(),
  repair: z.object({
    explanation: z.string().min(1).max(300),
    repairedStep: ReasoningStepSchema,
  }).strict(),
  transferCheck: ExampleProblemSchema.optional(),
}).strict();
export type ErrorContrast = z.infer<typeof ErrorContrastSchema>;

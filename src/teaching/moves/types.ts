import { z } from 'zod';

/**
 * T3 Teaching Move Library (STCC §8). Moves are semantic instructional
 * operations, not visual templates: `WorkExample` specifies an instructional
 * transformation, never a layout. Compilers (S4 narration, S6 visuals, S9
 * timeline) interpret moves; moves never carry coordinates, wording, or timing.
 */
export const TEACHING_MOVES = [
  'RevealMotivation',
  'ActivatePriorKnowledge',
  'StateLearningQuestion',
  'BuildIntuition',
  'IntroduceMentalModel',
  'RevealDefinition',
  'TraceMechanism',
  'WorkExample',
  'PredictNextStep',
  'ExposeMisconception',
  'ForkCorrectIncorrect',
  'ExplainDivergence',
  'RepairMisconception',
  'ShowNonExample',
  'ShowCounterexample',
  'TestBoundary',
  'CompareCases',
  'ConfirmInvariant',
  'FadeSupport',
  'TransferVariant',
  'SummarizeLearnerDelta',
] as const;
export type TeachingMoveName = (typeof TEACHING_MOVES)[number];

export const TeachingMoveSchema = z.object({
  move: z.enum(TEACHING_MOVES),
  /** One-line instructional intent, written by the compiler from strategy context. Never a drawing instruction. */
  note: z.string().min(1).max(140),
}).strict();
export type TeachingMove = z.infer<typeof TeachingMoveSchema>;

export const SceneMovePlanSchema = z.object({
  sceneId: z.string().min(1).max(60),
  moves: z.array(TeachingMoveSchema).min(1).max(8),
  policyVersion: z.string().min(1).max(40),
}).strict();
export type SceneMovePlan = z.infer<typeof SceneMovePlanSchema>;

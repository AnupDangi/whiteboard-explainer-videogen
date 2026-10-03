import { z } from 'zod';
import { COGNITIVE_OPERATIONS, REPRESENTATION_FAMILIES } from '../../teaching/beat-plan/types.js';
import { TEACHING_MOVES } from '../../teaching/moves/types.js';

/**
 * T7 Visual Teaching Model (STCC §14). Answers "what must the learner visibly
 * understand?" BEFORE visual elements exist. Compiled deterministically from
 * the teaching beat plus the scene's moves: the model never writes it, the
 * compiler derives it, and S6 consumes it through the board prompt.
 */
export const VisualTeachingModelSchema = z.object({
  claimIds: z.array(z.string().min(1).max(40)).min(1).max(3),
  learningQuestion: z.string().min(1).max(240),
  cognitiveOperation: z.enum(COGNITIVE_OPERATIONS),
  representationFamily: z.enum(REPRESENTATION_FAMILIES),
  teachingMoves: z.array(z.enum(TEACHING_MOVES)).max(8),
  entities: z.array(z.object({ conceptId: z.string().min(1).max(40), role: z.string().max(48).optional() }).strict()).max(8),
  states: z.array(z.object({ description: z.string().min(1).max(160) }).strict()).max(2),
  relationships: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), type: z.string().min(1).max(30) }).strict()).max(8),
  misconceptionToPrevent: z.string().max(160).optional(),
  visualInvariant: z.string().max(200),
  /** Concept ids in the order the learner should meet them. */
  semanticRevealOrder: z.array(z.string().min(1).max(40)).max(12),
  mutedMeaning: z.string().max(200),
}).strict();
export type VisualTeachingModel = z.infer<typeof VisualTeachingModelSchema>;

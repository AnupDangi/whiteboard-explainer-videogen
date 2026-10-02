import { z } from 'zod';
import { BoardOpSchema, SceneTransitionSchema } from '../board-ops/types.js';

/** What the Visual Teaching Model writes for one scene: how the scene starts relative to the board it inherits, then the ops. */
export const SceneBoardDraftSchema = z.object({
  transition: SceneTransitionSchema,
  ops: z.array(BoardOpSchema).min(1).max(40),
}).strict();
export type SceneBoardDraft = z.infer<typeof SceneBoardDraftSchema>;

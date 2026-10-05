import { z } from 'zod';
import { BoardOpSchema, SceneTransitionSchema } from '../board-ops/types.js';

/** What the Visual Teaching Model writes for one scene: how the scene starts relative to the board it inherits, then the ops. */
export const SceneBoardDraftSchema = z.object({
  transition: SceneTransitionSchema,
  /** A wholly narration-only scene (including a bounded OPEN_EXPLANATION scene) has no board operations. */
  ops: z.array(BoardOpSchema).max(40),
}).strict();
export type SceneBoardDraft = z.infer<typeof SceneBoardDraftSchema>;

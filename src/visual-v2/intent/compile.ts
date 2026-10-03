import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { TeachingMove } from '../../teaching/moves/types.js';
import { VisualTeachingModelSchema, type VisualTeachingModel } from './types.js';

/**
 * Derive one beat's visual teaching model from the beat plus the scene's
 * moves. Pure compiler derivation: learning question from the narration goal,
 * reveal order from entities then relation endpoints, states from before/after.
 */
export function compileVisualModel(beat: TeachingBeat, moves: readonly TeachingMove[] = []): VisualTeachingModel {
  const endpoints = beat.relationships.flatMap((r) => [r.from, r.to]);
  const revealOrder = [...new Set([...beat.entities.map((e) => e.conceptId), ...endpoints])];
  return VisualTeachingModelSchema.parse({
    claimIds: beat.claimIds,
    learningQuestion: beat.narrationGoal,
    cognitiveOperation: beat.cognitiveOperation,
    representationFamily: beat.representationFamily,
    teachingMoves: moves.map((m) => m.move),
    entities: beat.entities.map((e) => ({ conceptId: e.conceptId, ...(e.role ? { role: e.role } : {}) })),
    states: [beat.stateBefore, beat.stateAfter].filter((s) => !!s).map((s) => ({ description: s!.description })),
    relationships: beat.relationships.map((r) => ({ from: r.from, to: r.to, type: r.type })),
    ...(beat.misconceptionIds.length ? { misconceptionToPrevent: beat.misconceptionIds.join(', ') } : {}),
    visualInvariant: beat.visualInvariant,
    semanticRevealOrder: revealOrder,
    mutedMeaning: beat.mutedMeaning,
  });
}

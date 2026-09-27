import { EXPERIMENT } from '../shared/contracts.js';
import type { RELATION_TYPES } from './plan/schemas.js';

/**
 * Pipeline settings that are not visual style (visual tokens live in
 * style.ts, intake limits in plan/intake/limits.ts). Values used by more
 * than one stage belong here so they cannot drift apart.
 */

/** Lesson lengths the lesson CLI accepts, and the total model-spend cap for each. */
export const LESSON_DURATIONS_SEC = [60, 300, 600, 1800] as const;
export type LessonDurationSec = typeof LESSON_DURATIONS_SEC[number];
export const LESSON_COST_CAP_USD: Record<LessonDurationSec, number> = { 60: 0.1, 300: 0.5, 600: 0.7, 1800: 1 };

/** Cap for a duration off the table: $0.10 per minute, clamped to [$0.10, $1]. */
export function lessonCostCapUsd(durationSec: number): number {
  if (durationSec in LESSON_COST_CAP_USD) return LESSON_COST_CAP_USD[durationSec as LessonDurationSec];
  return Math.min(1, Math.max(0.1, durationSec / 60 * 0.1));
}

export const PIPELINE = {
  /** Silence between consecutive scenes in the master audio, the timeline and module clips. */
  sceneGapMs: 200,
  /** Per-request provider timeout; it starts once a concurrency permit is held. */
  providerTimeoutMs: 180_000,
  /** Spend cap for one fixture/diagnostic clip (not a generated lesson). */
  clipCostCapUsd: EXPERIMENT.maxClipCostUsd,
  /**
   * The multimodal RAG index pays off only when local span ranking cannot see
   * the whole source: several documents, embedded figures, or a long text.
   * RAG_ENGINE=always indexes every source.
   */
  ragMinSourceChars: 40_000,
} as const;

/**
 * How each source relation type reads on an arrow. The verb is code-owned
 * grammar for the relation enum, never lesson content; `directed: false`
 * draws the arrow without a one-way head (a comparison or an opposition
 * has no direction).
 */
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_ARROWS: Record<RelationType, { verb: string; directed: boolean }> = {
  causes: { verb: 'causes', directed: true },
  feeds: { verb: 'feeds into', directed: true },
  contains: { verb: 'contains', directed: true },
  compares: { verb: 'compared with', directed: false },
  transforms: { verb: 'becomes', directed: true },
  requires: { verb: 'needs', directed: true },
  produces: { verb: 'produces', directed: true },
  opposes: { verb: 'opposes', directed: false },
};

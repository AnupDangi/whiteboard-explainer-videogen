import { EXPERIMENT } from '../shared/contracts.js';

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
} as const;

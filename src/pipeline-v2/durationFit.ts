import { PIPELINE } from '../run/config.js';

/**
 * Fitting a lesson to its requested runtime (V2 plan §3.3: audio is the master clock). Speech is never trimmed, stretched or
 * padded to manufacture a pass. Two honest levers exist: (1) the silence between scenes and the final hold are compiler pacing
 * policy and may move inside fixed bounds; (2) when the speech itself is too long or too short, the narration is rewritten to a
 * measured word budget (claims preserved) and re-synthesized. This module is the arithmetic of both; it makes no model calls.
 */
export interface PacingBounds { min: number; nominal: number; max: number }
export interface PacingPolicy { gapMs: PacingBounds; trailingMs: PacingBounds }
export const DEFAULT_PACING: PacingPolicy = {
  gapMs: { min: PIPELINE.sceneGapMs - 400, nominal: PIPELINE.sceneGapMs, max: PIPELINE.sceneGapMs + 400 },
  trailingMs: { min: 800, nominal: 1200, max: 2000 },
};

export type PacingFit =
  | { ok: true; gapMs: number; trailingMs: number }
  | { ok: false; direction: 'shorten' | 'lengthen'; /** How many ms of speech must go away (shorten) or be added (lengthen), assuming the extreme pause setting. */ deltaMs: number };

const interpolate = (bounds: PacingBounds, fraction: number): number => Math.round(fraction >= 0 ? bounds.nominal + fraction * (bounds.max - bounds.nominal) : bounds.nominal + fraction * (bounds.nominal - bounds.min));

/** Choose the gap between scenes and the final hold so speech + pauses equals the request exactly, or say how far off the speech is. */
export function fitPacing(audioMs: readonly number[], requestedMs: number, policy: PacingPolicy = DEFAULT_PACING): PacingFit {
  if (audioMs.length < 1) throw new Error('pacing needs at least one scene');
  if (audioMs.some((ms) => !Number.isFinite(ms) || ms <= 0) || !Number.isFinite(requestedMs) || requestedMs <= 0) throw new Error('scene durations and the request must be positive');
  const gaps = audioMs.length - 1;
  const pauses = requestedMs - audioMs.reduce((sum, ms) => sum + ms, 0);
  const lowest = policy.gapMs.min * gaps + policy.trailingMs.min;
  const highest = policy.gapMs.max * gaps + policy.trailingMs.max;
  if (pauses < lowest) return { ok: false, direction: 'shorten', deltaMs: lowest - pauses };
  if (pauses > highest) return { ok: false, direction: 'lengthen', deltaMs: pauses - highest };
  const nominal = policy.gapMs.nominal * gaps + policy.trailingMs.nominal;
  const fraction = pauses >= nominal ? (highest === nominal ? 0 : (pauses - nominal) / (highest - nominal)) : -(lowest === nominal ? 0 : (nominal - pauses) / (nominal - lowest));
  let gapMs = gaps === 0 ? policy.gapMs.nominal : interpolate(policy.gapMs, fraction);
  // The final hold takes whatever is left, so the total is exact in whole milliseconds.
  let trailingMs = pauses - gapMs * gaps;
  if (trailingMs < policy.trailingMs.min || trailingMs > policy.trailingMs.max) {
    trailingMs = Math.min(policy.trailingMs.max, Math.max(policy.trailingMs.min, trailingMs));
    gapMs = gaps === 0 ? gapMs : Math.round((pauses - trailingMs) / gaps);
    trailingMs = pauses - gapMs * gaps;
  }
  return { ok: true, gapMs, trailingMs };
}

export interface MeasuredScene { sceneId: string; audioMs: number; words: number }
export interface RevisionTarget { sceneId: string; targetWords: number; targetAudioMs: number; measuredWordsPerSec: number }

/** One rewrite may change a scene by at most this share of its speech: larger swings are where models stop following a word budget. */
export const MAX_REVISION_SHARE = 0.25;

/**
 * Which scenes to rewrite, and to how many words, to close the gap between the measured speech and the speech the request leaves
 * room for. The longest scenes are rewritten first, each by at most MAX_REVISION_SHARE, and only until the gap is covered, so a
 * small mismatch touches one scene instead of perturbing the whole lesson. Pauses are assumed nominal; when the direction is known
 * the aim assumes pauses half-way toward the far bound: a rewrite tends to stop short of its budget, so asking for a little less
 * speech (shorten) or a little more (lengthen) lands inside the pause bounds. `scale` is the lesson-wide speech ratio aimed for.
 */
export function revisionTargets(scenes: readonly MeasuredScene[], requestedMs: number, policy: PacingPolicy = DEFAULT_PACING, lean?: 'shorten' | 'lengthen'): { scale: number; scenes: RevisionTarget[] } {
  const aim = (bounds: PacingBounds): number => (lean === 'shorten' ? bounds.nominal + (bounds.max - bounds.nominal) / 2 : lean === 'lengthen' ? bounds.nominal - (bounds.nominal - bounds.min) / 2 : bounds.nominal);
  const pauses = aim(policy.gapMs) * Math.max(0, scenes.length - 1) + aim(policy.trailingMs);
  const speech = scenes.reduce((sum, scene) => sum + scene.audioMs, 0);
  const speechTarget = Math.max(1, requestedMs - pauses);
  const gap = speech - speechTarget;
  let remaining = Math.abs(gap);
  const chosen = new Map<string, RevisionTarget>();
  for (const scene of [...scenes].sort((a, b) => b.audioMs - a.audioMs || a.sceneId.localeCompare(b.sceneId))) {
    if (remaining <= 0) break;
    const delta = Math.min(remaining, scene.audioMs * MAX_REVISION_SHARE);
    const targetAudioMs = gap > 0 ? scene.audioMs - delta : scene.audioMs + delta;
    chosen.set(scene.sceneId, {
      sceneId: scene.sceneId, measuredWordsPerSec: scene.words / (scene.audioMs / 1000),
      targetWords: Math.max(6, Math.round(scene.words * (targetAudioMs / scene.audioMs))), targetAudioMs,
    });
    remaining -= delta;
  }
  return { scale: speechTarget / speech, scenes: scenes.flatMap((scene) => chosen.get(scene.sceneId) ?? []) };
}

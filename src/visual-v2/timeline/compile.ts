import type { BoardOp } from '../board-ops/types.js';
import { createdBy, dependenciesOf } from '../board-ops/deps.js';
import { applyOpAfter, endBeat } from '../board-state/reducer.js';
import type { BoardEffect, BoardState } from '../board-state/types.js';
import { canonicalHash } from '../../harness/replayDeterminism.js';

/**
 * Semantic timeline (V2 plan Phase 10). The writer gives each op a beat and a sentence cue, never a time. This compiler turns
 * the aligned audio (beat and sentence intervals, the master clock) into exact milliseconds: an op starts a little before the
 * sentence it belongs to, runs for a duration set by what it does, may overlap at most one other op, and must finish by the
 * end of its sentence. An op that cannot is reported as late, never silently moved.
 */
export type PausePolicy = 'none' | 'micro' | 'think' | 'scene_close';
export interface BeatTiming { beatId: string; startMs: number; endMs: number; sentences: Array<{ startMs: number; endMs: number }>; pauseIntent?: PausePolicy }

/** Instructional pauses are compiler policy (V2 plan Phase 10), never model-written milliseconds: the board must settle this long before its beat ends. */
export const PAUSE_MS: Record<PausePolicy, number> = { none: 0, micro: 175, think: 550, scene_close: 700 };

export const SCHEDULE = {
  leadMs: 150,
  graceMs: 350,
  maxConcurrent: 2,
  /** An op may be drawn faster than its natural speed, never below this share of it. */
  minSpeed: 0.4,
  /** How far before its beat an op may start when it is anchored to the first sentence. */
  beatLeadMs: 250,
} as const;

const DURATION_MS: Record<BoardEffect['kind'], number> = { add: 750, remove: 350, move: 650, emphasize: 500, valueChange: 450, transform: 450, connect: 450, equationStep: 750, reveal: 400, clear: 400 };
const ADD_BY_TYPE: Record<string, number> = { kit: 950, equation: 900, entity: 800, text: 600, token: 450, value: 450 };

export interface ScheduledOp {
  index: number;
  op: BoardOp;
  effects: BoardEffect[];
  anchorMs: number;
  t0: number;
  t1: number;
  deadlineMs: number;
  late: boolean;
}

export interface SceneTimeline {
  ops: ScheduledOp[];
  /** states[i] is the board after i ops; states[0] is the board the scene starts from. */
  states: BoardState[];
  durationMs: number;
  lateOps: string[];
  /** Explicit closure records for every spoken beat, including beats with no BoardOps, plus the scene boundary. */
  lifecycleEvents: Array<{ kind: 'beat-end' | 'scene-end'; beatId?: string; atMs: number; state: BoardState }>;
  hash: string;
}

function naturalDuration(op: BoardOp, effects: BoardEffect[]): number {
  if (op.op === 'add') return ADD_BY_TYPE[op.element.type] ?? DURATION_MS.add;
  return Math.max(120, ...effects.map((effect) => DURATION_MS[effect.kind]));
}

export function compileSceneTimeline(input: { ops: readonly BoardOp[]; initial: BoardState; beats: readonly BeatTiming[]; sceneStartMs?: number; tailMs?: number }): SceneTimeline {
  const beatById = new Map(input.beats.map((beat) => [beat.beatId, beat]));
  const countByBeat = new Map<string, number>();
  for (const op of input.ops) countByBeat.set(op.beatId, (countByBeat.get(op.beatId) ?? 0) + 1);
  // Degenerate contract: the planner stamped cue 0 on every op of a beat with
  // several sentences (observed 45/46 ops in production). cue means "the
  // sentence that introduces this change", so unanimous cue 0 contradicts the
  // contract and would pile every reveal at the beat opening. Spread those ops
  // round-robin exactly as for omitted cues; any explicit nonzero cue keeps
  // the beat out of this path and is respected verbatim.
  const spreadByBeat = new Map<string, boolean>();
  for (const beat of input.beats) {
    if (beat.sentences.length > 1) {
      const cues = input.ops.filter((op) => op.beatId === beat.beatId).map((op) => op.cue ?? 0);
      spreadByBeat.set(beat.beatId, cues.length > 0 && cues.every((cue) => cue === 0));
    }
  }
  const seenByBeat = new Map<string, number>();
  const states: BoardState[] = [input.initial];
  const scheduled: ScheduledOp[] = [];
  const active: Array<{ t1: number }> = [];
  const drawnAt = new Map<string, number>();
  let lastStart = input.sceneStartMs ?? 0;
  let lastEnd = input.sceneStartMs ?? 0;
  input.ops.forEach((op, index) => {
    const beat = beatById.get(op.beatId);
    if (!beat) throw new Error(`op ${op.opId} names beat ${op.beatId}, which has no timing`);
    const result = applyOpAfter(states[index]!, op, input.ops[index - 1]?.beatId, input.beats.map((item) => item.beatId));
    states.push(result.state);
    const n = countByBeat.get(op.beatId)!;
    const i = seenByBeat.get(op.beatId) ?? 0;
    seenByBeat.set(op.beatId, i + 1);
    const sentenceCount = Math.max(1, beat.sentences.length);
    const cue = spreadByBeat.get(op.beatId)
      ? Math.floor((i * sentenceCount) / n)
      : Math.min(sentenceCount - 1, op.cue ?? Math.floor((i * sentenceCount) / n));
    const sentence = beat.sentences[cue] ?? { startMs: beat.startMs, endMs: beat.endMs };
    const anchorMs = Math.max(beat.startMs - SCHEDULE.beatLeadMs, sentence.startMs - SCHEDULE.leadMs);
    const natural = naturalDuration(op, result.effects);
    // Ops keep their written order; at most `maxConcurrent` run at once.
    // An op that touches an element waits for the op that drew it, so a change never starts on something not yet there.
    // Reference choreography: an arrow leads the eye, so a connect reveal waits
    // only for its source; the target may still be drawing when the arrow starts
    // toward it. (Validation still requires both endpoints to exist.)
    const lead = op.op === 'connect' ? [op.from] : dependenciesOf(op);
    const needs = Math.max(0, ...lead.map((id) => drawnAt.get(id) ?? 0));
    const running = active.filter((a) => a.t1 > Math.max(anchorMs, lastStart, needs));
    let start = Math.max(anchorMs, lastStart, needs);
    if (running.length >= SCHEDULE.maxConcurrent) start = Math.max(start, running.map((a) => a.t1).sort((a, b) => a - b)[running.length - SCHEDULE.maxConcurrent]!);
    // Prediction beats (STCC §11): a think/scene-close pause is thinking time, not
    // new-content time. The next beat's first op never starts inside the pause window.
    if (i === 0) {
      const at = input.beats.findIndex((b) => b.beatId === op.beatId);
      const prev = at > 0 ? input.beats[at - 1] : undefined;
      if (prev && (prev.pauseIntent === 'think' || prev.pauseIntent === 'scene_close')) start = Math.max(start, prev.endMs);
    }
    const lastOfBeat = i === n - 1;
    // The beat's last op must leave the board settled for the beat's pause; earlier ops keep the sentence deadline.
    const settleBy = lastOfBeat ? beat.endMs - PAUSE_MS[beat.pauseIntent ?? 'none'] : Infinity;
    const deadlineMs = Math.min(sentence.endMs + SCHEDULE.graceMs, Math.max(settleBy, anchorMs + natural * SCHEDULE.minSpeed));
    let duration = natural;
    if (start + duration > deadlineMs) duration = Math.max(natural * SCHEDULE.minSpeed, deadlineMs - start);
    // Completion order follows op order so "every op before k is done" is well defined.
    const t1 = Math.max(start + duration, lastEnd);
    const late = t1 > deadlineMs + 1 || start >= beat.endMs;
    for (const id of createdBy(op)) drawnAt.set(id, t1);
    scheduled.push({ index, op, effects: result.effects, anchorMs, t0: start, t1, deadlineMs, late });
    active.push({ t1 });
    lastStart = start;
    lastEnd = t1;
  });
  const lastBeatEnd = input.beats.reduce((max, beat) => Math.max(max, beat.endMs), 0);
  const durationMs = Math.max(lastBeatEnd, lastEnd) + (input.tailMs ?? 0);
  // Keep beat/scene closure explicit. In particular, a narration-only beat has
  // no ScheduledOp at which to infer its boundary, so it still receives a
  // lifecycle record and its state reflects any prior beat cleanup.
  const lifecycleEvents: SceneTimeline['lifecycleEvents'] = [];
  let boundaryState = input.initial;
  const opsByBeat = new Map<string, ScheduledOp[]>();
  for (const item of scheduled) opsByBeat.set(item.op.beatId, [...(opsByBeat.get(item.op.beatId) ?? []), item]);
  for (const beat of input.beats) {
    const beatOps = opsByBeat.get(beat.beatId) ?? [];
    if (beatOps.length) boundaryState = states[beatOps[beatOps.length - 1]!.index + 1]!;
    boundaryState = endBeat(boundaryState, beat.beatId);
    lifecycleEvents.push({ kind: 'beat-end', beatId: beat.beatId, atMs: beat.endMs, state: boundaryState });
  }
  lifecycleEvents.push({ kind: 'scene-end', atMs: durationMs, state: boundaryState });
  return {
    ops: scheduled, states, durationMs, lateOps: scheduled.filter((s) => s.late).map((s) => s.op.opId), lifecycleEvents,
    hash: canonicalHash([scheduled.map((s) => [s.op.opId, Math.round(s.t0), Math.round(s.t1)]), lifecycleEvents.map((event) => [event.kind, event.beatId, Math.round(event.atMs), event.state])]),
  };
}

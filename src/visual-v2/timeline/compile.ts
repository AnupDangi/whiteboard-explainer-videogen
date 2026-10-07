import type { BoardOp } from '../board-ops/types.js';
import { createdBy, dependenciesOf } from '../board-ops/deps.js';
import { applyOpAfter, endBeat } from '../board-state/reducer.js';
import type { BoardEffect, BoardState } from '../board-state/types.js';
import { canonicalHash } from '../../harness/replayDeterminism.js';
import type { SemanticEventBoardBinding } from '../../teaching/semantic-ir/toBoardOps.js';

/**
 * Semantic timeline (V2 plan Phase 10). The writer never supplies a time. Typed semantic execution binds compiler-generated
 * ops to exact phrases in the final aligned narration; older previews retain sentence cues. Each op starts a little before
 * its phrase or sentence, runs for a duration set by what it does, and may overlap at most one other op. An op that cannot
 * meet its aligned deadline is reported as late, never silently moved.
 */
export type PausePolicy = 'none' | 'micro' | 'think' | 'scene_close';
export interface BeatTiming {
  beatId: string;
  startMs: number;
  endMs: number;
  sentences: Array<{ startMs: number; endMs: number }>;
  /** Exact event phrase intervals from the final aligned narration, when available. */
  semanticAnchors?: Array<{ semanticEventId: string; phrase: string; startMs: number; endMs: number }>;
  pauseIntent?: PausePolicy;
}

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

type SemanticAnchor = NonNullable<BeatTiming['semanticAnchors']>[number];

/** Resolve compiler-owned bindings without guessing event identity from renderer ids or sentence position. */
function semanticAnchorsByOp(
  ops: readonly BoardOp[],
  beats: readonly BeatTiming[],
  bindings: readonly SemanticEventBoardBinding[],
): Map<string, SemanticAnchor> {
  const beatById = new Map<string, BeatTiming>();
  const anchorByEvent = new Map<string, { beatId: string; anchor: SemanticAnchor }>();
  for (const beat of beats) {
    if (beatById.has(beat.beatId)) throw new Error(`duplicate timing for beat ${beat.beatId}`);
    beatById.set(beat.beatId, beat);
    for (const anchor of beat.semanticAnchors ?? []) {
      if (anchorByEvent.has(anchor.semanticEventId)) throw new Error(`duplicate semantic anchor ${anchor.semanticEventId}`);
      if (!anchor.semanticEventId.trim() || !anchor.phrase.trim() || !Number.isFinite(anchor.startMs) || !Number.isFinite(anchor.endMs)
        || anchor.startMs < beat.startMs || anchor.endMs > beat.endMs || anchor.endMs <= anchor.startMs) {
        throw new Error(`semantic anchor ${anchor.semanticEventId} has no valid aligned phrase interval in beat ${beat.beatId}`);
      }
      anchorByEvent.set(anchor.semanticEventId, { beatId: beat.beatId, anchor });
    }
  }
  const opById = new Map<string, BoardOp>();
  for (const op of ops) {
    if (opById.has(op.opId)) throw new Error(`duplicate op id ${op.opId} in semantic timeline`);
    if (!beatById.has(op.beatId)) throw new Error(`op ${op.opId} names beat ${op.beatId}, which has no timing`);
    opById.set(op.opId, op);
  }
  const seenEvents = new Set<string>();
  const result = new Map<string, SemanticAnchor>();
  for (const binding of bindings) {
    if (seenEvents.has(binding.semanticEventId)) throw new Error(`duplicate semantic event binding ${binding.semanticEventId}`);
    seenEvents.add(binding.semanticEventId);
    if (!binding.boardOpIds.length) throw new Error(`semantic event ${binding.semanticEventId} binding has no board ops`);
    if (!beatById.has(binding.beatId)) throw new Error(`semantic event ${binding.semanticEventId} names beat ${binding.beatId}, which has no timing`);
    const aligned = anchorByEvent.get(binding.semanticEventId);
    if (!aligned) throw new Error(`semantic event ${binding.semanticEventId} has no aligned phrase anchor`);
    if (aligned.beatId !== binding.beatId) throw new Error(`semantic event ${binding.semanticEventId} anchor belongs to beat ${aligned.beatId}, not ${binding.beatId}`);
    for (const opId of binding.boardOpIds) {
      const op = opById.get(opId);
      if (!op) throw new Error(`semantic event ${binding.semanticEventId} binds unknown op ${opId}`);
      if (result.has(opId)) throw new Error(`op ${opId} has duplicate semantic event bindings`);
      if (op.beatId !== binding.beatId) throw new Error(`semantic event ${binding.semanticEventId} in beat ${binding.beatId} binds op ${opId} from beat ${op.beatId}`);
      result.set(opId, aligned.anchor);
    }
  }
  for (const op of ops) if (!result.has(op.opId)) throw new Error(`op ${op.opId} has no semantic event binding`);
  return result;
}

export function compileSceneTimeline(input: {
  ops: readonly BoardOp[]; initial: BoardState; beats: readonly BeatTiming[]; sceneStartMs?: number; tailMs?: number;
  /** Explicit compiler output; omitted only for legacy sentence-cue scheduling. */
  semanticEventBindings?: readonly SemanticEventBoardBinding[];
}): SceneTimeline {
  const eventAnchors = input.semanticEventBindings === undefined ? undefined : semanticAnchorsByOp(input.ops, input.beats, input.semanticEventBindings);
  const beatById = new Map(input.beats.map((beat) => [beat.beatId, beat]));
  const countByBeat = new Map<string, number>();
  for (const op of input.ops) countByBeat.set(op.beatId, (countByBeat.get(op.beatId) ?? 0) + 1);
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
    const cue = Math.min(sentenceCount - 1, op.cue ?? Math.floor((i * sentenceCount) / n));
    const sentence = beat.sentences[cue] ?? { startMs: beat.startMs, endMs: beat.endMs };
    const interval = eventAnchors === undefined ? sentence : eventAnchors.get(op.opId)!;
    const anchorMs = Math.max(beat.startMs - SCHEDULE.beatLeadMs, interval.startMs - SCHEDULE.leadMs);
    const natural = naturalDuration(op, result.effects);
    // Ops keep their written order; at most `maxConcurrent` run at once.
    // An op that touches an element waits for the op that drew it, so a change never starts on something not yet there.
    const needs = Math.max(0, ...dependenciesOf(op).map((id) => drawnAt.get(id) ?? 0));
    const running = active.filter((a) => a.t1 > Math.max(anchorMs, lastStart, needs));
    let start = Math.max(anchorMs, lastStart, needs);
    if (running.length >= SCHEDULE.maxConcurrent) start = Math.max(start, running.map((a) => a.t1).sort((a, b) => a - b)[running.length - SCHEDULE.maxConcurrent]!);
    // The beat's last op must leave the board settled for the beat's pause; earlier ops keep the aligned interval deadline.
    const lastOfBeat = i === n - 1;
    const settleBy = lastOfBeat ? beat.endMs - PAUSE_MS[beat.pauseIntent ?? 'none'] : Infinity;
    // Typed execution cannot consume a reserved pause to hide an infeasible minimum draw duration. Keep the original
    // sentence-cue formula for legacy locks, and report a typed op that cannot settle on time as late below.
    const settleDeadline = eventAnchors === undefined ? Math.max(settleBy, anchorMs + natural * SCHEDULE.minSpeed) : settleBy;
    const deadlineMs = Math.min(interval.endMs + SCHEDULE.graceMs, settleDeadline);
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

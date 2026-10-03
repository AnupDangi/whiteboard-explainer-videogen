import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { BoardOp } from '../visual-v2/board-ops/types.js';
import { evaluatePedagogy } from '../harness/pedagogy.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';

/** T6 gates: think pauses are never interrupted by the next beat; predictions ask. */

const add = (opId: string, beatId: string, id: string, cue = 0): BoardOp => ({
  op: 'add', opId, beatId, id, cue,
  element: { type: 'token', text: id, provenance: 'illustrative' },
  at: { region: 'center' },
});

describe('prediction timing', () => {
  it('the next beat never starts inside a think pause, even with overlapping beat timings', () => {
    const beats: BeatTiming[] = [
      { beatId: 's.b1', startMs: 0, endMs: 2000, sentences: [{ startMs: 0, endMs: 2000 }], pauseIntent: 'think' },
      // Overlapping on purpose: the second beat's sentence starts before the pause window ends.
      { beatId: 's.b2', startMs: 1500, endMs: 4000, sentences: [{ startMs: 1500, endMs: 4000 }] },
    ];
    const timeline = compileSceneTimeline({
      initial: emptyBoardState(),
      ops: [add('o1', 's.b1', 'q'), add('o2', 's.b2', 'a')],
      beats,
    });
    const second = timeline.ops.find((s) => s.op.opId === 'o2')!;
    assert.ok(second.t0 >= 2000, `second beat starts at ${second.t0}ms, inside the think pause ending at 2000ms`);
  });

  it('beats without a preceding pause keep their natural anchors', () => {
    const beats: BeatTiming[] = [
      { beatId: 's.b1', startMs: 0, endMs: 2000, sentences: [{ startMs: 0, endMs: 2000 }] },
      { beatId: 's.b2', startMs: 2000, endMs: 4000, sentences: [{ startMs: 2000, endMs: 4000 }] },
    ];
    const timeline = compileSceneTimeline({
      initial: emptyBoardState(),
      ops: [add('o1', 's.b1', 'q'), add('o2', 's.b2', 'a')],
      beats,
    });
    const second = timeline.ops.find((s) => s.op.opId === 'o2')!;
    assert.ok(second.t0 < 2000, 'no pause to respect: natural anchor kept');
  });
});

describe('prediction speech', () => {
  it('a predict beat with no question is a soft finding; with a question it is clean', () => {
    const beat: TeachingBeat = {
      beatId: 'b1', sceneId: 's', order: 1, claimIds: ['c1'], evidenceSpanIds: ['S1'],
      learnerDelta: 'd', beatType: 'demonstrate', cognitiveOperation: 'predict',
      representationFamily: 'process', entities: [{ conceptId: 'w' }], relationships: [],
      misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
      narrationOnly: false, persistence: 'scene', pauseIntent: 'think',
    };
    const open: TeachingBeat = { ...beat, beatId: 'b0', order: 0, beatType: 'motivate', cognitiveOperation: 'identify', mutedMeaning: 'A puzzle.' };
    const close: TeachingBeat = { ...beat, beatId: 'b2', order: 2, beatType: 'summarize', cognitiveOperation: 'infer', mutedMeaning: 'Takeaway.' };
    const predict = { ...beat, stateBefore: { description: 'Water left.' }, stateAfter: { description: 'Water even.' } };
    const narrate3 = (t0: string, t1: string, t2: string): CompiledSceneNarration => ({
      sceneId: 's', text: [t0, t1, t2].join(' '),
      beats: [{ beatId: 'b0', sentenceIds: ['b0.s1'], text: t0 }, { beatId: 'b1', sentenceIds: ['b1.s1'], text: t1 }, { beatId: 'b2', sentenceIds: ['b2.s1'], text: t2 }],
      beatSpans: [], claimSpans: [],
    });
    const beats3 = [open, predict, close];
    const silent = evaluatePedagogy({ beats: beats3, narration: narrate3('Why does water move?', 'Water spreads across the membrane.', 'Crowding eases out.') });
    assert.ok(silent.some((f) => /prediction needs question/.test(f.message) && f.severity === 'soft'));
    const asking = evaluatePedagogy({ beats: beats3, narration: narrate3('Why does water move?', 'Which way will the water go?', 'Crowding eases out.') });
    assert.deepEqual(asking, []);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { BoardOp } from '../visual-v2/board-ops/types.js';

/** Degenerate cue-0 contracts spread across sentences instead of piling at beat open. */

const add = (opId: string, beatId: string, id: string, cue?: number): BoardOp => ({
  op: 'add', opId, beatId, id, cue: cue ?? 0,
  element: { type: 'token', text: id, provenance: 'illustrative' },
  at: { region: 'center' },
});
const beats: BeatTiming[] = [{
  beatId: 's.b1', startMs: 0, endMs: 9000,
  sentences: [{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 6000 }, { startMs: 6000, endMs: 9000 }],
}];

describe('degenerate cue spread', () => {
  it('unanimous cue 0 across three sentences spreads reveals through the beat', () => {
    const timeline = compileSceneTimeline({
      initial: emptyBoardState(),
      ops: [add('o1', 's.b1', 'a'), add('o2', 's.b1', 'b'), add('o3', 's.b1', 'c')],
      beats,
    });
    const starts = timeline.ops.map((s) => s.t0);
    assert.ok(starts[0]! < 3000, `first reveal near beat open, got ${starts[0]}`);
    assert.ok(starts[1]! >= 3000 - 250, `second reveal waits for sentence two, got ${starts[1]}`);
    assert.ok(starts[2]! >= 6000 - 250, `third reveal waits for sentence three, got ${starts[2]}`);
    assert.ok(!timeline.ops.some((s) => s.late), 'spread reveals still meet their deadlines');
  });

  it('one explicit nonzero cue disables spreading and is respected verbatim', () => {
    const timeline = compileSceneTimeline({
      initial: emptyBoardState(),
      ops: [add('o1', 's.b1', 'a'), add('o2', 's.b1', 'b', 2)],
      beats,
    });
    const second = timeline.ops.find((s) => s.op.opId === 'o2')!;
    assert.ok(second.t0 >= 6000 - 250, `explicit cue 2 anchors at sentence three, got ${second.t0}`);
  });

  it('single-sentence beats are untouched by the spread rule', () => {
    const timeline = compileSceneTimeline({
      initial: emptyBoardState(),
      ops: [add('o1', 's.b1', 'a'), add('o2', 's.b1', 'b')],
      beats: [{ beatId: 's.b1', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }],
    });
    assert.ok(timeline.ops.every((s) => s.t0 < 3000));
  });
});

describe('arrow leads the eye', () => {
  it('a connect reveal waits for its source, not its target', async () => {
    const { BoardOpSchema } = await import('../visual-v2/board-ops/types.js');
    const { compileSceneTimeline: compile } = await import('../visual-v2/timeline/compile.js');
    const { emptyBoardState } = await import('../visual-v2/board-state/reducer.js');
    const tok = (text: string) => ({ type: 'token', text, provenance: 'illustrative' });
    const at = (region: string) => ({ region });
    const ops = [
      BoardOpSchema.parse({ op: 'add', opId: 's.a', beatId: 's.b1', id: 'a', element: tok('source'), at: at('left'), cue: 0 }),
      BoardOpSchema.parse({ op: 'add', opId: 's.b', beatId: 's.b1', id: 'b', element: tok('target'), at: at('right'), cue: 2 }),
      BoardOpSchema.parse({ op: 'connect', opId: 's.e', beatId: 's.b1', id: 'e', from: 'a', to: 'b', relation: 'causes', cue: 1 }),
    ];
    const timeline = compile({
      initial: emptyBoardState(), ops,
      beats: [{ beatId: 's.b1', startMs: 0, endMs: 12000, sentences: [{ startMs: 0, endMs: 4000 }, { startMs: 4000, endMs: 8000 }, { startMs: 8000, endMs: 12000 }] }],
    });
    const edge = timeline.ops.find((s) => s.op.opId === 's.e')!;
    const target = timeline.ops.find((s) => s.op.opId === 's.b')!;
    assert.ok(edge.t0 < target.t1, `arrow starts (${edge.t0}) before its target finishes drawing (${target.t1})`);
  });
});

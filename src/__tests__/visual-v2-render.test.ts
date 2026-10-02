import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardOpSchema, type BoardOp } from '../visual-v2/board-ops/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline, PAUSE_MS, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, renderSceneSvg } from '../visual-v2/renderer/frame.js';
import { fitFont, textOverflow } from '../visual-v2/layout/textFit.js';
import { validateSceneGeometry } from '../visual-v2/layout/sceneLayout.js';
import { rasterizePng } from '../export/videoEncode.js';

const add = (id: string, element: unknown, at: unknown, beat: string, cue?: number) => BoardOpSchema.parse({ op: 'add', opId: `${beat}.${id}`, beatId: beat, id, element, at, ...(cue === undefined ? {} : { cue }) });
const remove = (id: string, beat: string) => BoardOpSchema.parse({ op: 'remove', opId: `${beat}.rm_${id}`, beatId: beat, target: id });
const tok = (text: string) => ({ type: 'token', text, provenance: 'illustrative' });

// A hand-written fixture for renderer contract tests only; it is not a generated lesson and never feeds quality claims.
const ops: BoardOp[] = [
  add('stack1', { type: 'kit', kit: 'stack', label: 'call stack', paramsJson: '{}', provenance: 'metaphorical' }, { region: 'center' }, 'b0'),
  ...[4, 3, 2].map((n, i) => add(`f${n}`, tok(`f(${n})`), { region: 'center', container: 'stack1', slot: 'top' }, `b${i + 1}`)),
  remove('f2', 'b4'), remove('f3', 'b5'),
];
const beats: BeatTiming[] = ops.map((op, i) => ({ beatId: op.beatId, startMs: i * 4000, endMs: i * 4000 + 3600, sentences: [{ startMs: i * 4000, endMs: i * 4000 + 1800 }, { startMs: i * 4000 + 1800, endMs: i * 4000 + 3600 }] }));

test('the timeline starts each op just before its sentence, keeps op order and flags nothing late for roomy audio', () => {
  const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats });
  assert.equal(timeline.ops.length, ops.length);
  timeline.ops.forEach((s, i) => { assert.ok(s.t0 >= beats[i]!.startMs - 250 - 1 && s.t0 <= beats[i]!.endMs, `op ${i} starts inside its beat`); assert.ok(s.t1 > s.t0); });
  for (let i = 1; i < timeline.ops.length; i++) assert.ok(timeline.ops[i]!.t1 >= timeline.ops[i - 1]!.t1, 'completion follows op order');
  assert.deepEqual(timeline.lateOps, []);
  assert.equal(timeline.states.length, ops.length + 1);
});

test('ops crowded into one short sentence are limited to two at a time, compressed to the minimum speed, and the one that cannot finish is reported late', () => {
  const crowded: BoardOp[] = [
    add('k', { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' }, { region: 'center' }, 'b0', 0),
    add('x', tok('x'), { region: 'center', container: 'k', slot: 'top' }, 'b0', 0),
    add('y', tok('y'), { region: 'center', container: 'k', slot: 'top' }, 'b0', 0),
    add('z', tok('z'), { region: 'center', container: 'k', slot: 'top' }, 'b0', 0),
  ];
  const short: BeatTiming[] = [{ beatId: 'b0', startMs: 0, endMs: 600, sentences: [{ startMs: 0, endMs: 300 }, { startMs: 300, endMs: 600 }] }];
  const timeline = compileSceneTimeline({ ops: crowded, initial: emptyBoardState(), beats: short });
  assert.ok(timeline.lateOps.length > 0, 'something cannot fit');
  for (let i = 1; i < timeline.ops.length; i++) assert.ok(timeline.ops[i]!.t1 >= timeline.ops[i - 1]!.t1);
  const starts = timeline.ops.map((s) => s.t0);
  const overlapping = (i: number) => timeline.ops.filter((s, j) => j !== i && s.t0 < timeline.ops[i]!.t1 && timeline.ops[i]!.t0 < s.t1).length;
  assert.ok(timeline.ops.every((_, i) => overlapping(i) <= 2), `at most two overlap: ${JSON.stringify(starts)}`);
});

test('an op for a beat with no timing is an error, not a guess', () => {
  assert.throws(() => compileSceneTimeline({ ops, initial: emptyBoardState(), beats: beats.slice(1) }), /has no timing/);
});

test('frames follow the board: empty, drawing in, stack grown, stack shrunk', () => {
  const scene = compileScene('s1', 'Calls stack up', compileSceneTimeline({ ops, initial: emptyBoardState(), beats }));
  const at = (ms: number) => renderSceneSvg(scene, ms);
  assert.doesNotMatch(at(10), />CALL STACK</, 'nothing drawn before the first op');
  const t = scene.timeline.ops;
  assert.match(at(t[0]!.t1 + 10), />CALL STACK</);
  const mid = (t[1]!.t0 + t[1]!.t1) / 2;
  assert.match(at(mid), /stroke-dasharray/, 'the new item is mid draw-on');
  assert.match(at(t[3]!.t1 + 10), />F\(4\)</);
  assert.match(at(t[3]!.t1 + 10), />F\(2\)</);
  assert.doesNotMatch(at(t[5]!.t1 + 10), />F\(2\)</);
  assert.doesNotMatch(at(t[5]!.t1 + 10), />F\(3\)</);
  assert.match(at(t[5]!.t1 + 10), />F\(4\)</);
});

test('a frame is a pure function of scene and time and rasterizes to a PNG', () => {
  const scene = compileScene('s1', 'Calls stack up', compileSceneTimeline({ ops, initial: emptyBoardState(), beats }));
  const a = renderSceneSvg(scene, 9000);
  assert.equal(a, renderSceneSvg(scene, 9000));
  const png = rasterizePng(a, 480);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
});

test('an op held back by an earlier op is late when it completes after its own deadline', () => {
  const held: BoardOp[] = [
    add('k', { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' }, { region: 'center' }, 'b0'),
    add('t', tok('t'), { region: 'left' }, 'b1'),
  ];
  const overlap: BeatTiming[] = [
    { beatId: 'b0', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] },
    { beatId: 'b1', startMs: 100, endMs: 500, sentences: [{ startMs: 100, endMs: 400 }] },
  ];
  const timeline = compileSceneTimeline({ ops: held, initial: emptyBoardState(), beats: overlap });
  assert.ok(timeline.ops[1]!.t1 > timeline.ops[1]!.deadlineMs + 1);
  assert.deepEqual(timeline.lateOps, ['b1.t']);
});

test('beat-persistent elements leave when the next beat starts, and stay while their beat runs', () => {
  const beatOps: BoardOp[] = [
    BoardOpSchema.parse({ op: 'add', opId: 'b1.tmp', beatId: 'b1', id: 'tmp', element: tok('tmp'), at: { region: 'center' }, persistence: 'beat' }),
    BoardOpSchema.parse({ op: 'add', opId: 'b1.keep', beatId: 'b1', id: 'keep', element: tok('keep'), at: { region: 'left' } }),
    add('next', tok('next'), { region: 'right' }, 'b2'),
  ];
  const timing: BeatTiming[] = [1, 2].map((n) => ({ beatId: `b${n}`, startMs: n * 4000, endMs: n * 4000 + 3600, sentences: [{ startMs: n * 4000, endMs: n * 4000 + 3600 }] }));
  const { states } = compileSceneTimeline({ ops: beatOps, initial: emptyBoardState(), beats: timing });
  assert.equal(states[2]!.elements.tmp!.lifecycle.removedAtBeat, undefined, 'alive at the end of its own beat');
  assert.equal(states[3]!.elements.tmp!.lifecycle.removedAtBeat, 'b1:beat-end');
  assert.equal(states[3]!.elements.keep!.lifecycle.removedAtBeat, undefined, 'scene-persistent elements stay');
});

test('objects retained across a scene cut keep their rectangle; a new neighbour is placed beside them', () => {
  const first: BoardOp[] = [add('a', tok('alpha'), { region: 'center' }, 'b0')];
  const t1 = compileSceneTimeline({ ops: first, initial: emptyBoardState(), beats: [{ beatId: 'b0', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }] });
  const s1 = compileScene('s1', 'One', t1);
  const carried = t1.states[t1.states.length - 1]!;
  const t2 = compileSceneTimeline({ ops: [add('b', tok('beta'), { region: 'center' }, 'b1')], initial: carried, beats: [{ beatId: 'b1', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }] });
  const s2 = compileScene('s2', 'Two', t2, 'lesson', undefined, { geometry: s1.geometry, state: carried });
  const before = s1.geometry.rectFor(carried, 'a');
  const after = s2.geometry.rectFor(t2.states[t2.states.length - 1]!, 'a');
  assert.deepEqual(after, before);
  assert.deepEqual(s2.geometry.moved, []);
  const neighbour = s2.geometry.rectFor(t2.states[t2.states.length - 1]!, 'b')!;
  assert.ok(neighbour.x >= before!.x + before!.w || neighbour.x + neighbour.w <= before!.x, 'beta sits beside alpha');
  const unpinned = compileScene('s2', 'Two', t2).geometry.rectFor(t2.states[t2.states.length - 1]!, 'a');
  assert.notDeepEqual(unpinned, before, 'without the prior scene alpha would be re-laid out');
});

const timed = (id: string, n: number): BeatTiming => ({ beatId: id, startMs: n * 5000, endMs: n * 5000 + 4000, sentences: [{ startMs: n * 5000, endMs: n * 5000 + 4000 }] });

test('a value change shows the new value while it fades in, not the old one on both sides', () => {
  const value = { type: 'value', label: 'count', value: 111, unit: '', provenance: 'illustrative' };
  const ops: BoardOp[] = [add('n', value, { region: 'center' }, 'b0'), BoardOpSchema.parse({ op: 'updateValue', opId: 'b1.u', beatId: 'b1', target: 'n', value: 777 })];
  const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [timed('b0', 0), timed('b1', 1)] });
  const scene = compileScene('s', 'S', timeline);
  const u = timeline.ops[1]!;
  const mid = renderSceneSvg(scene, (u.t0 + u.t1) / 2);
  assert.ok(mid.includes('777') && mid.includes('111'), 'both values are visible mid-fade');
  assert.ok(!renderSceneSvg(scene, u.t0 - 1).includes('777') && renderSceneSvg(scene, u.t1 + 1).includes('777'));
});

test('transform changes what is drawn: scale resizes the element and color changes its fill', () => {
  const ops: BoardOp[] = [
    add('a', tok('alpha'), { region: 'center' }, 'b0'),
    BoardOpSchema.parse({ op: 'transform', opId: 'b1.t', beatId: 'b1', target: 'a', changes: [{ key: 'scale', value: 1.5 }, { key: 'color', value: 'red' }] }),
  ];
  const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [timed('b0', 0), timed('b1', 1)] });
  const scene = compileScene('s', 'S', timeline);
  const before = renderSceneSvg(scene, timeline.ops[0]!.t1 + 1);
  const after = renderSceneSvg(scene, timeline.ops[1]!.t1 + 1);
  assert.notEqual(before, after);
  assert.ok(after.includes('#FF7A6B'), 'red palette fill is drawn');
  assert.ok(!before.includes('#FF7A6B'));
});

test('a kit drawing and the children inside it move with the kit rectangle', () => {
  const kit = { type: 'kit', kit: 'stack', label: 'stack', paramsJson: '{}', provenance: 'metaphorical' };
  const ops: BoardOp[] = [
    add('k', kit, { region: 'left' }, 'b0'),
    add('c', tok('child'), { region: 'left', container: 'k', slot: 'top' }, 'b0'),
    BoardOpSchema.parse({ op: 'move', opId: 'b1.m', beatId: 'b1', target: 'k', to: { region: 'right' } }),
  ];
  const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [timed('b0', 0), timed('b1', 1)] });
  const scene = compileScene('s', 'S', timeline);
  const m = timeline.ops[2]!;
  const start = renderSceneSvg(scene, m.t0 - 1);
  const end = renderSceneSvg(scene, m.t1 + 1);
  const mid = renderSceneSvg(scene, (m.t0 + m.t1) / 2);
  assert.notEqual(start, end);
  assert.notEqual(mid, start);
  assert.notEqual(mid, end);
});

test('text that cannot fit its slot at the smallest readable font is reported, text that fits is not', () => {
  const ops: BoardOp[] = [add('a', tok('transformer layers'), { region: 'center' }, 'b0')];
  const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [timed('b0', 0)] });
  const el = timeline.states[1]!.elements.a!;
  assert.equal(textOverflow(el, { x: 0, y: 0, w: 900, h: 100 }), undefined);
  assert.equal(textOverflow(el, { x: 0, y: 0, w: 120, h: 100 }), 'transformer layers');
  assert.equal(fitFont('transformer layers', 120), 28, 'the font floor is unchanged; legality is decided by fitsWidth');
});

test('an arrow whose straight path crosses an unrelated element is a geometry problem; a clear arrow is not', () => {
  const connect = BoardOpSchema.parse({ op: 'connect', opId: 'b1.c', beatId: 'b1', id: 'link', from: 'l', to: 'r', relation: 'causes' });
  const board = (middle: boolean): BoardOp[] => [add('l', tok('left'), { region: 'left' }, 'b0'), ...(middle ? [add('m', tok('middle'), { region: 'center' }, 'b0')] : []), add('r', tok('right'), { region: 'right' }, 'b0'), connect];
  const run = (ops: BoardOp[]) => { const t = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [timed('b0', 0), timed('b1', 1)] }); return validateSceneGeometry(compileScene('s', 'S', t).geometry, t.states); };
  assert.ok(run(board(true)).some((m) => /arrow link .* crosses m/.test(m)));
  assert.ok(!run(board(false)).some((m) => /arrow/.test(m)));
});

test('an op waits for the op that draws its target, and a beat pause makes the beat settle before it ends', () => {
  const kit = { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' };
  const ops: BoardOp[] = [add('k', kit, { region: 'center' }, 'b0', 0), add('c', tok('child'), { region: 'center', container: 'k', slot: 'top' }, 'b0', 0), BoardOpSchema.parse({ op: 'highlight', opId: 'b0.h', beatId: 'b0', target: 'c', cue: 0 })];
  const beat = { beatId: 'b0', startMs: 0, endMs: 6000, sentences: [{ startMs: 0, endMs: 6000 }] };
  const t = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [beat] });
  assert.ok(t.ops[1]!.t0 >= t.ops[0]!.t1 - 1e-6, 'the child starts after the kit is drawn');
  assert.ok(t.ops[2]!.t0 >= t.ops[1]!.t1 - 1e-6, 'the highlight starts after the child is drawn');
  const tight = { beatId: 'b0', startMs: 0, endMs: 2600, sentences: [{ startMs: 0, endMs: 2600 }] };
  const none = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [{ ...tight, pauseIntent: 'none' }] });
  const think = compileSceneTimeline({ ops, initial: emptyBoardState(), beats: [{ ...tight, pauseIntent: 'think' }] });
  assert.ok(think.ops[2]!.deadlineMs < none.ops[2]!.deadlineMs, 'a think pause pulls the last op deadline earlier');
  assert.ok(think.ops[2]!.deadlineMs <= tight.endMs - PAUSE_MS.think + 1 || think.ops[2]!.deadlineMs <= think.ops[2]!.anchorMs + 1000);
});

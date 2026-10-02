import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedMention, SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { runClaudeGates } from '../validate/gates.js';
import { MIN_READABLE_FONT_PX, STYLE } from '../render/style.js';
import { frameSvgAt, ERASE_MS } from '../export/videoEncode.js';

const mention = (sceneId: string, id: string, startMs: number): ResolvedMention => ({ sceneId, mentionId: id, startMs, endMs: startMs + 300, ambiguous: false, wordRange: [0, 1] });

const sampleFlow: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'sample_flow',
  title: 'Sample Flow',
  template: 'chain',
  elements: [
    { id: 'node_a', anchor: 'mention:node_a', prim: 'box', text: 'A', fill: 'green' },
    { id: 'node_b', anchor: 'mention:node_b', prim: 'shape', kind: 'rightTriangle', sideLabels: ['A', 'B', 'C'] },
    { id: 'node_c', anchor: 'mention:node_c', prim: 'box', text: 'C', fill: 'yellow' },
  ],
  edges: [
    { from: 'node_a', to: 'node_b' },
    { from: 'node_b', to: 'node_c' },
  ],
};

function build(spec: SceneSpec, mentions: ResolvedMention[], end = 12000) {
  const laidOut = layoutScene(resolveScene(spec));
  const resolvedMentions = [...mentions];
  const resolvedIds = new Set(resolvedMentions.map((item) => item.mentionId));
  for (const element of spec.elements) {
    if (element.anchor.startsWith('mention:')) {
      const id = element.anchor.slice('mention:'.length);
      if (!resolvedIds.has(id)) resolvedMentions.push(mention(spec.sceneId, id, 0));
    }
  }
  return { laidOut, timeline: compileTimelineFull(laidOut, resolvedMentions, 0, end) };
}

test('drawing: an element\'s outline paths are drawn one after another (pen order), not all at once', () => {
  const { laidOut, timeline } = build(sampleFlow, [mention('sample_flow', 'node_a', 0), mention('sample_flow', 'node_b', 6000), mention('sample_flow', 'node_c', 9000)]);
  const secondDraw = timeline.events.find((e) => e.elementId === 'node_b' && e.track === 'stroke')!;
  const early = renderSVG(laidOut, timeline, secondDraw.t0 + secondDraw.phases!.strokeMs * 0.15);
  const group = early.match(/<g id="node_b"[\s\S]*?<\/g>/)![0];
  const drawnPaths = (group.match(/<path /g) ?? []).length;
  const totalPaths = laidOut.elements.find((e) => e.id === 'node_b')!.visual.paths.length;
  assert.ok(drawnPaths < totalPaths, `at 15% of the stroke phase only the first path(s) may be started (${drawnPaths}/${totalPaths})`);
});

test('drawing: fill appears only after the outline completes, and the label only after the fill', () => {
  const { laidOut, timeline } = build(sampleFlow, [mention('sample_flow', 'node_a', 1000), mention('sample_flow', 'node_b', 6000), mention('sample_flow', 'node_c', 9000)]);
  const first = timeline.events.find((e) => e.elementId === 'node_a' && e.track === 'stroke')!;
  const { strokeMs, fillMs } = first.phases!;
  const mid = renderSVG(laidOut, timeline, first.t0 + strokeMs / 2).match(/<g id="node_a"[\s\S]*?<\/g>/)![0];
  assert.ok(!mid.includes(`fill="${STYLE.palette.green}"`), 'no fill while the outline is still being drawn');
  assert.ok(!/>A<\/text>/.test(mid), 'no label while the outline is still being drawn');
  const afterFill = renderSVG(laidOut, timeline, first.t0 + strokeMs + fillMs + 1);
  assert.ok(/<g id="node_a"[\s\S]*?clip-path/.test(afterFill), 'label is wiping in (clipped) right after the fill');
});

test('drawing contract: neutral shape labels reach resolved visuals', () => {
  const { laidOut } = build(sampleFlow, []);
  const node = laidOut.elements.find((e) => e.id === 'node_b')!;
  assert.equal(node.element.prim, 'shape', 'neutral synthetic data retains its declared primitive');
  assert.ok(node.visual.texts.some((t) => t.text === 'B'), 'synthetic label reaches the resolved visual');
});

test('drawing: an arrow is never drawn before its source has finished revealing, and has an arrowhead once complete', () => {
  const { laidOut, timeline } = build(sampleFlow, [mention('sample_flow', 'node_a', 500), mention('sample_flow', 'node_b', 5000), mention('sample_flow', 'node_c', 9000)]);
  const first = timeline.events.find((e) => e.elementId === 'node_a' && e.track === 'stroke')!;
  const second = timeline.events.find((e) => e.elementId === 'node_b' && e.track === 'stroke')!;
  const edge = timeline.events.find((e) => e.track === 'edge' && e.edgeIndex === 0)!;
  assert.ok(edge.t0 >= first.t1, 'edge starts after its source is fully drawn');
  assert.ok(edge.t1 <= second.t0 + 1e-6, 'edge leads into its target: it finishes by the time the target starts drawing');
  const before = renderSVG(laidOut, timeline, edge.t0 - 1);
  const after = renderSVG(laidOut, timeline, edge.t1 + 1);
  const pathCount = (svg: string) => (svg.replace(/<g id="[^"]+"[\s\S]*?<\/g>/g, '').match(/<path /g) ?? []).length;
  assert.equal(pathCount(before), 0, 'no loose arrow paths before the edge event');
  assert.equal(pathCount(after), 3, 'shaft + two arrowhead strokes after the edge event');
});

test('drawing: fill tails hold the element\'s concurrency slot (regression: EMI 3-concurrent failure)', () => {
  const dense: SceneSpec = { ...sampleFlow, sceneId: 'dense', elements: sampleFlow.elements.map((e) => ({ ...e, fill: 'blue' as const })) };
  const mentions = [mention('dense', 'node_a', 1000), mention('dense', 'node_b', 1100), mention('dense', 'node_c', 1200)];
  const { laidOut, timeline } = build(dense, mentions);
  assert.equal(timeline.events.filter((e) => e.track === 'fill').length, 0, 'fill is a phase of the primary reveal, not a separate unscheduled event');
  const gates = runClaudeGates(laidOut, timeline);
  assert.ok(!gates.failures.some((f) => f.code === 'concurrency'), JSON.stringify(gates.failures));
});

test('drawing: layout grows elements to use the frame instead of leaving small icons in empty space', () => {
  const { laidOut } = build(sampleFlow, []);
  const node = laidOut.elements.find((e) => e.id === 'node_a')!;
  assert.ok(node.bbox.w > node.intrinsicSize.w * 1.1, `node should be grown beyond its intrinsic size (${node.bbox.w} vs ${node.intrinsicSize.w})`);
});

test('drawing: G6 readability hard-blocks undersized token sublabels', () => {
  const stripSpec: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'synthetic_strip', title: 'Sample Strip', template: 'list_icon', elements: [
    { id: 'strip', anchor: 'sceneStart', prim: 'tokenStrip', tokens: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { id: 'context', anchor: 'sceneStart', prim: 'text', text: 'Sample', size: 'body' },
  ], edges: [] };
  const laidOut = layoutScene(resolveScene(stripSpec));
  const timeline = compileTimelineFull(laidOut, [], 0, 5000);
  const tooSmall = structuredClone(laidOut);
  const strip = tooSmall.elements.find((e) => e.id === 'strip')!;
  const expectedFailures = strip.visual.texts.filter((text) => text.size * 0.5 < MIN_READABLE_FONT_PX).length;
  strip.bbox.h = strip.intrinsicSize.h * 0.5;
  const failures = runClaudeGates(tooSmall, timeline).failures.filter((f) => f.code === 'min-readable-text');
  assert.equal(failures.length, expectedFailures, 'each undersized synthetic text run must be recorded');
  assert.ok(expectedFailures > 0);
  assert.ok(failures.every((f) => f.hard), 'no below-floor label may be downgraded to a warning');
});

test('drawing: scene title is lettered at scene-title size and wipes in at scene start', () => {
  const { laidOut, timeline } = build(sampleFlow, []);
  assert.ok(!renderSVG(laidOut, timeline, 0).includes('SAMPLE FLOW'));
  assert.match(renderSVG(laidOut, timeline, 350), /clip-path="url\(#title_clip\)"/);
  assert.match(renderSVG(laidOut, timeline, 2000), new RegExp(`font-size="${STYLE.font.sceneTitle}"[^>]*>SAMPLE FLOW`));
});

test('drawing: the board is erased before a new scene unless it carries elements over', () => {
  const a = build(sampleFlow, [mention('sample_flow', 'node_a', 100)], 4000);
  const b = build({ ...sampleFlow, sceneId: 'sample_flow2' }, [], 4000);
  const scenes = [
    { laidOut: a.laidOut, timeline: a.timeline, startMs: 0, endMs: 4000 },
    { laidOut: b.laidOut, timeline: { ...b.timeline, sceneStartMs: 4200, sceneEndMs: 8000 }, startMs: 4200, endMs: 8000 },
  ];
  const mid = frameSvgAt(scenes, 4200 - ERASE_MS / 2);
  assert.match(mid, new RegExp(`<rect x="0" y="0" width="${STYLE.canvas.w / 2}"`), 'half-way through the erase wipe');
  const carried = [scenes[0], { ...scenes[1], laidOut: { ...scenes[1].laidOut, carryOver: ['node_a'] } }];
  assert.doesNotMatch(frameSvgAt(carried, 4200 - ERASE_MS / 2), /<rect x="0" y="0" width="\d/, 'no erase when the next scene carries elements over');
});

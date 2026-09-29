import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedMention, SceneSpec } from '../types.js';
import { safeParseSceneSpec, validateSceneSpecStructure } from '../schema.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { evalPlot } from '../render/plot.js';
import { renderPrimitive } from '../render/primitives.js';
import { runClaudeGates } from '../validation/gates.js';
import { STYLE } from '../style.js';

const mention = (sceneId: string, id: string, startMs: number): ResolvedMention => ({ sceneId, mentionId: id, startMs, endMs: startMs + 300, ambiguous: false, wordRange: [0, 1] });

function buildSyntheticTimelineScene(spec: SceneSpec, mentions: ResolvedMention[], endMs = 5000) {
  const laidOut = layoutScene(resolveScene(spec));
  return { laidOut, timeline: compileTimelineFull(laidOut, mentions, 0, endMs) };
}

test('math code contract: a neutral synthetic mathematical SceneSpec parses and lays out deterministically', () => {
  const spec: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'sample_math', title: 'Sample Board', template: 'plot_focus', elements: [
    { id: 'sample_plot', anchor: 'sceneStart', prim: 'plot', fn: 'linear', params: [1, 0], domain: [0, 1] },
    { id: 'sample_formula', anchor: 'sceneStart', prim: 'formula', latex: 'a=b' },
  ], edges: [] };
  const parsed = safeParseSceneSpec(spec);
  assert.equal(parsed.success, true);
  assert.deepEqual(validateSceneSpecStructure(spec), []);
  const first = layoutScene(resolveScene(spec));
  const second = layoutScene(resolveScene(spec));
  assert.deepEqual(first, second, 'layout output is deterministic for identical input');
});

test('math: plot families evaluate to the textbook values', () => {
  assert.equal(evalPlot('linear', [2, 1], 3), 7);
  assert.equal(evalPlot('quadratic', [1, -2, 1], 1), 0);
  assert.equal(evalPlot('cubic', [1, 0, 0, 0], -2), -8);
  assert.ok(Math.abs(evalPlot('sine', [1, 1, 0, 0], Math.PI / 2) - 1) < 1e-12);
  assert.ok(Math.abs(evalPlot('exp', [1, 1, 0], 0) - 1) < 1e-12);
  assert.ok(Math.abs(evalPlot('log', [1, 1, 0], Math.E) - 1) < 1e-12);
  assert.equal(evalPlot('normal', [1, 0, 1], 0), 1);
});

test('math: plots are sampled by code — deterministic, and a model cannot supply points or path data', () => {
  const el: SceneSpec['elements'][number] = { id: 'p', anchor: 'sceneStart', prim: 'plot', fn: 'quadratic', params: [1, 0, 0], domain: [-2, 2], tangentAt: 1, trajectory: [1.5, 1, 0.5] };
  assert.deepEqual(renderPrimitive(el, { w: 600, h: 400 }), renderPrimitive(el, { w: 600, h: 400 }));
  const smuggled = safeParseSceneSpec({ schemaVersion: 'claude-scene-spec/v1', sceneId: 's', title: 'T', template: 'plot_focus', elements: [{ ...el, points: [[0, 0]] }], edges: [] });
  assert.equal(smuggled.success, false, 'unknown keys (points) on a plot are rejected');
});

test('math: invalid math is rejected structurally (domain order, arity, out-of-domain positions, latex/parts exclusivity)', () => {
  const base = { schemaVersion: 'claude-scene-spec/v1' as const, sceneId: 's', title: 'T', template: 'plot_focus' as const, edges: [] };
  const issues = (elements: SceneSpec['elements']) => validateSceneSpecStructure({ ...base, elements }).map((i) => i.message).join(' | ');
  assert.match(issues([{ id: 'p', anchor: 'sceneStart', prim: 'plot', fn: 'linear', params: [1, 0], domain: [3, 1] }]), /increasing/);
  assert.match(issues([{ id: 'p', anchor: 'sceneStart', prim: 'plot', fn: 'quadratic', params: [1, 0], domain: [0, 1] }]), /takes 3 params/);
  assert.match(issues([{ id: 'p', anchor: 'sceneStart', prim: 'plot', fn: 'linear', params: [1, 0], domain: [0, 1], tangentAt: 5 }]), /outside the domain/);
  assert.match(issues([{ id: 'f', anchor: 'sceneStart', prim: 'formula', latex: 'x', parts: [{ tex: 'x' }] }]), /exactly one/);
  assert.match(issues([{ id: 'n', anchor: 'sceneStart', prim: 'numberLine', min: 0, max: 10, ticks: 11, points: [{ x: 12 }] }]), /outside/);
});

test('math code contract: an anchored formula term follows its synthetic mention clock', () => {
  const spec: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'sample_formula', title: 'Sample', template: 'formula_focus', elements: [
    { id: 'sample_formula', anchor: 'sceneStart', prim: 'formula', parts: [{ tex: 'a=' }, { tex: 'b', anchor: 'mention:sample_term' }] },
    { id: 'context', anchor: 'sceneStart', prim: 'text', text: 'Sample', size: 'body' },
  ], edges: [] };
  const mentions = [mention('sample_formula', 'sample_term', 1500)];
  const { laidOut, timeline } = buildSyntheticTimelineScene(spec, mentions);
  const term = timeline.events.find((e) => e.track === 'term' && e.elementId === 'sample_formula' && e.group === 'p1')!;
  assert.ok(term.t0 >= mentions[0]!.startMs - STYLE.motion.leadMs - 1);
  const before = renderSVG(laidOut, timeline, term.t0 - 1);
  assert.match(before, /id="sample_formula-p1" opacity="0"/, 'term remains hidden before its mention');
  const after = renderSVG(laidOut, timeline, term.t1 + 1);
  assert.doesNotMatch(after, /id="sample_formula-p1" opacity=/, 'term is fully revealed afterward');
});

test('math code contract: synthetic plot markers follow their declared mention clock', () => {
  const spec: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'sample_plot', title: 'Sample', template: 'plot_focus', elements: [
    { id: 'sample_plot', anchor: 'sceneStart', prim: 'plot', fn: 'quadratic', params: [1, 0, 0], domain: [-1, 1], trajectory: [0.8, 0.4, 0.2], stepsAnchor: 'mention:sample_steps' },
    { id: 'context', anchor: 'sceneStart', prim: 'text', text: 'Sample', size: 'body' },
  ], edges: [] };
  const mentions = [mention('sample_plot', 'sample_steps', 3000)];
  const { laidOut, timeline } = buildSyntheticTimelineScene(spec, mentions, 6000);
  const ev = timeline.events.find((e) => e.track === 'term' && e.group === 'steps')!;
  const curve = timeline.events.find((e) => e.elementId === 'sample_plot' && e.track === 'stroke')!;
  assert.ok(ev.t0 > curve.t1, 'steps come after the curve has been drawn');
  assert.ok(Math.abs(ev.t0 - (mentions[0]!.startMs - STYLE.motion.leadMs)) < 1, 'steps start with their mention');
  const redDots = (t: number) => (renderSVG(laidOut, timeline, t).match(new RegExp(`fill="${STYLE.palette.red}"`, 'g')) ?? []).length;
  assert.equal(redDots(ev.t0 - 1), 0);
  assert.ok(redDots(ev.t1 + 1) >= 3, 'all synthetic trajectory markers are visible after the reveal');
});

test('math: a number line renders ticks, labelled points and a highlighted interval', () => {
  const v = renderPrimitive({ id: 'n', anchor: 'sceneStart', prim: 'numberLine', min: -2, max: 2, ticks: 5, points: [{ x: 1, label: 'x' }], interval: [-1, 1] }, { w: 760, h: 170 });
  assert.deepEqual(v.texts.filter((t) => /^-?\d/.test(t.text)).map((t) => t.text), ['-2', '-1', '0', '1', '2']);
  assert.ok(v.texts.some((t) => t.text === 'X'));
  assert.ok(v.fills.some((f) => f.fill === STYLE.palette.blue), 'interval band');
});

test('math: a formula MathJax cannot typeset fails the formula-error gate instead of shipping raw TeX', () => {
  const spec: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'bad', title: 'Bad', template: 'formula_focus', elements: [{ id: 'f', anchor: 'sceneStart', prim: 'formula', latex: '\\frac{a' }, { id: 't', anchor: 'sceneStart', prim: 'text', text: 'x', size: 'body' }], edges: [] };
  const laidOut = layoutScene(resolveScene(spec));
  const gates = runClaudeGates(laidOut, compileTimelineFull(laidOut, [], 0, 5000));
  assert.ok(gates.failures.some((f) => f.code === 'formula-error'));
});

test('math: geometry shapes keep variable case and label every side of a right triangle', () => {
  const tri = renderPrimitive({ id: 't', anchor: 'sceneStart', prim: 'shape', kind: 'rightTriangle', sideLabels: ['a', 'b', 'c'] }, { w: 360, h: 300 });
  assert.deepEqual(tri.texts.map((t) => t.text), ['a', 'b', 'c']);
  assert.equal(tri.paths.length, 2, 'outline + right-angle mark');
  const sq = renderPrimitive({ id: 's', anchor: 'sceneStart', prim: 'shape', kind: 'square', text: 'a²' }, { w: 260, h: 260 });
  assert.ok(sq.texts.some((t) => t.text === 'a²'), 'a² must not become A²');
});

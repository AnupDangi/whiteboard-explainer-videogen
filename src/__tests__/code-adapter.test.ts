import test from 'node:test';
import assert from 'node:assert/strict';
import { safeParseSceneSpec } from '../shared/schema.js';
import { measureElement } from '../layout/measure.js';
import { renderPrimitive } from '../render/primitives.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import type { SceneSpec } from '../shared/types.js';

const source = 'if x < y:\n    result = "Go!"\n\nprint(result)';
const scene = (src: string): unknown => ({
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'code_sample',
  title: 'Code sample',
  template: 'list_icon',
  elements: [{ id: 'snippet', anchor: 'sceneStart', prim: 'code', language: 'python', source: src }],
  edges: [],
});
const svgTextNodes = (svg: string) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((match) =>
  (match[1] ?? '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));

test('code adapter accepts a static excerpt and preserves source text and whitespace', () => {
  const parsed = safeParseSceneSpec(scene(source));
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const el = parsed.data.elements[0]!;
  assert.equal(el.prim, 'code');
  if (el.prim !== 'code') return;
  assert.equal(el.source, source);
  const runs = renderPrimitive(el, measureElement(el)).texts;
  assert.equal(runs.map((run) => run.text).join(''), source.replaceAll('\n', ''));
  assert.equal(runs[13]!.x - runs[9]!.x, 4 * 36, 'indentation occupies four fixed character cells');
  assert.equal(runs.find((run) => run.text === 'r')!.y, 24 + 42 + 32, 'line two uses a stable baseline after line one');
  assert.deepEqual(renderPrimitive(el, measureElement(el)), renderPrimitive(el, measureElement(el)), 'identical input yields identical visual output');
});

test('code adapter sizes by longest literal line and line count without normalizing indentation', () => {
  const plain = { id: 'a', anchor: 'sceneStart' as const, prim: 'code' as const, language: 'python' as const, source: 'x=1' };
  const indented = { ...plain, source: '    x=1\ny=2' };
  const size = measureElement(plain);
  const indentedSize = measureElement(indented);
  assert.ok(indentedSize.w > size.w, 'leading spaces occupy visible code width');
  assert.ok(indentedSize.h > size.h, 'each source line receives a stable line box, including blank lines');
});

test('code adapter SVG uses escaped, fixed-cell text with preserved whitespace and exact case', () => {
  const parsed = safeParseSceneSpec(scene(source));
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const spec: SceneSpec = parsed.data;
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [], 0, 5000);
  const svg = renderSVG(laidOut, timeline, 5000);
  assert.match(svg, /xml:space="preserve"[^>]*font-family="Kalam, sans-serif"/);
  assert.equal(svgTextNodes(svg).slice(1).join(''), source.replaceAll('\n', ''));
  assert.doesNotMatch(svg, /IF X/);
  assert.equal(svg, renderSVG(laidOut, timeline, 5000), 'identical locked inputs produce identical SVG');
});

test('code schema keeps escaped angle brackets literal and rejects control characters, overflow, and execution fields', () => {
  const markupText = '<script>alert(1)</script>';
  const parsedMarkupText = safeParseSceneSpec(scene(markupText));
  assert.equal(parsedMarkupText.success, true, 'angle brackets are ordinary escaped display text');
  if (parsedMarkupText.success) {
    const laidOut = layoutScene(resolveScene(parsedMarkupText.data));
    const svg = renderSVG(laidOut, compileTimelineFull(laidOut, [], 0, 5000), 5000);
    assert.equal(svgTextNodes(svg).slice(1).join(''), markupText);
    assert.doesNotMatch(svg, /<script>/, 'code remains text, never SVG markup');
  }
  for (const bad of [
    'x=1\t+ 2',
    'x'.repeat(41),
    Array.from({ length: 15 }, () => 'x').join('\n'),
  ]) assert.equal(safeParseSceneSpec(scene(bad)).success, false, `rejected invalid source: ${bad.slice(0, 24)}`);
  const withExecutionField = scene('x = 1') as { elements: Array<Record<string, unknown>> };
  withExecutionField.elements[0]!.execute = true;
  assert.equal(safeParseSceneSpec(withExecutionField).success, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ResolvedMention, SceneSpec } from '../types.js';
import { STYLE } from '../style.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { renderPrimitive } from '../render/primitives.js';
import { frameSvgAt } from '../export/videoEncode.js';
import { measureElement, measureTextWidth } from '../layout/measure.js';
import { KALAM_BOLD_FILE, KALAM_FONT_SHA256, RESVG_FONT_OPTIONS } from '../render/fonts.js';
import { Resvg } from '@resvg/resvg-js';

const spec: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'render_test',
  title: 'Render Test <&> "quotes"',
  template: 'chain',
  elements: [
    { id: 'a', anchor: 'mention:a', prim: 'box', text: 'A & B' },
    { id: 'b', anchor: 'mention:b', prim: 'box', text: '<not a tag>' },
  ],
  edges: [{ from: 'a', to: 'b', label: 'flows to' }],
};

function mention(id: string, startMs: number, endMs: number): ResolvedMention {
  return { sceneId: 'render_test', mentionId: id, startMs, endMs, ambiguous: false, wordRange: [0, 1] };
}

test('renderer: at scene start, nothing anchored later than sceneStart has revealed yet', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 5000, 5200), mention('b', 8000, 8200)], 0, 12000);
  const svg = renderSVG(laidOut, timeline, 0);
  assert.ok(!svg.includes('id="a"') && !svg.includes('id="b"'), 'no element group should render before its reveal starts');
});

test('renderer: at scene end (after every mention), both elements have rendered groups', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 1000, 1200), mention('b', 3000, 3200)], 0, 12000);
  const svg = renderSVG(laidOut, timeline, 11999);
  assert.ok(svg.includes('id="a"'));
  assert.ok(svg.includes('id="b"'));
});

test('renderer: at a middle timestamp, a stroke mid-reveal has a partial (non-zero, non-full) dashoffset', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 1000, 1200)], 0, 12000);
  const ev = timeline.events.find((e) => e.elementId === 'a' && e.track === 'stroke')!;
  const midT = (ev.t0 + ev.t1) / 2;
  const svg = renderSVG(laidOut, timeline, midT);
  const match = svg.match(/id="a"[\s\S]*?stroke-dashoffset="([\d.]+)"/);
  assert.ok(match, 'expected a dashoffset attribute on the mid-reveal path');
  const offset = Number(match![1]);
  assert.ok(offset > 0, 'mid-reveal must not be fully drawn (offset 0)');
});

test('renderer: MP4 frame sampling matches the canonical renderer at the same timestamp', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 1000, 1200), mention('b', 3000, 3200)], 0, 12000);
  // encodeVideo samples this frame function before rasterizing; for a single
  // scene with no transition, its SVG must equal the canonical renderSVG output.
  const t = 3500;
  assert.equal(
    frameSvgAt([{ laidOut, timeline, startMs: 0, endMs: 12000 }], t),
    renderSVG(laidOut, timeline, t),
  );
});

test('renderer: roughness is 0 and primitive geometry is exactly reproducible (no per-call jitter)', () => {
  assert.equal(STYLE.roughness, 0);
  const v1 = renderPrimitive({ id: 'x', anchor: 'sceneStart', prim: 'box', text: 'X' }, { w: 200, h: 120 });
  const v2 = renderPrimitive({ id: 'x', anchor: 'sceneStart', prim: 'box', text: 'X' }, { w: 200, h: 120 });
  assert.deepEqual(v1, v2);
});

test('layout: text width follows resvg glyph bounds instead of assigning every character the same width', () => {
  const narrowGlyphs = measureTextWidth('IIIIIIIIIIII', STYLE.font.sizes.body);
  const wideGlyphs = measureTextWidth('WWWWWWWWWWWW', STYLE.font.sizes.body);
  assert.ok(narrowGlyphs < wideGlyphs * 0.7, `narrow glyph run ${narrowGlyphs}px should be materially narrower than wide glyph run ${wideGlyphs}px`);
  assert.equal(narrowGlyphs, measureTextWidth('IIIIIIIIIIII', STYLE.font.sizes.body), 'a cached text measurement is stable');

  const narrowBox = measureElement({ id: 'narrow', anchor: 'sceneStart', prim: 'box', text: 'IIIIIIIIIIII' });
  const wideBox = measureElement({ id: 'wide', anchor: 'sceneStart', prim: 'box', text: 'WWWWWWWWWWWW' });
  assert.ok(narrowBox.w < wideBox.w, 'intrinsic box width must reflect the rendered text width');
});

test('renderer and layout load the versioned bundled Kalam font without system-font fallback', async () => {
  const font = await readFile(KALAM_BOLD_FILE);
  assert.equal(createHash('sha256').update(font).digest('hex'), KALAM_FONT_SHA256);
  assert.equal(RESVG_FONT_OPTIONS.font?.loadSystemFonts, false);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><text x="24" y="80" font-family="Kalam, sans-serif" font-weight="700" font-size="48">SOURCE GROUNDED</text></svg>';
  const bounds = new Resvg(svg, RESVG_FONT_OPTIONS).getBBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 20, 'bundled-font text must produce real glyph bounds');
});

test('renderer: token strips use bare words with a single highlight instead of boxed cells', () => {
  const visual = renderPrimitive({ id: 'tokens', anchor: 'sceneStart', prim: 'tokenStrip', tokens: ['QUERY', 'KEY'], highlight: [1] }, { w: 300, h: 96 });
  assert.equal(visual.paths.length, 0, 'token words have no card outlines');
  assert.equal(visual.fills.length, 1, 'only the selected token receives a marker highlight');
  assert.deepEqual(visual.texts.map((run) => run.size), [STYLE.font.sizes.label, STYLE.font.sizes.label]);
});

test('renderer: text content is XML-escaped, never emitted as raw markup', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 0, 100), mention('b', 200, 300)], 0, 12000);
  const svg = renderSVG(laidOut, timeline, 11999);
  // Labels are uppercased for display (STYLE.font.uppercaseLabels), so check
  // case-insensitively for the escaped form rather than the exact source text.
  assert.ok(!/<not a tag>/i.test(svg), 'raw "<not a tag>" text must be escaped, not passed through verbatim');
  assert.ok(/&lt;not a tag&gt;/i.test(svg), 'expected the XML-escaped form of the text to be present');
  assert.ok(!/<script/i.test(svg));
});

test('renderer: output is a single well-formed <svg> document at the configured canvas size', () => {
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laidOut, [], 0, 1000);
  const svg = renderSVG(laidOut, timeline, 500);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(`width="${STYLE.canvas.w}"`));
  assert.ok(svg.includes(`height="${STYLE.canvas.h}"`));
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('renderer: formula primitive is typeset by MathJax (glyph paths), deterministic and script-free', () => {
  const el = { id: 'f', anchor: 'sceneStart', prim: 'formula', latex: '\\theta \\leftarrow \\theta - \\eta \\nabla L' } as const;
  const a = renderPrimitive(el, { w: 480, h: 120 });
  const b = renderPrimitive(el, { w: 480, h: 120 });
  assert.deepEqual(a, b);
  assert.equal(a.texts.length, 0, 'typeset formula must not fall back to literal LaTeX text');
  assert.equal(a.embeds?.length, 1);
  assert.match(a.embeds![0].body, /<path/);
  assert.doesNotMatch(a.embeds![0].body, /<script\b|on\w+\s*=|javascript:|currentColor/i);
});

test('renderer: invalid TeX falls back to visible literal source instead of an error glyph', () => {
  const v = renderPrimitive({ id: 'f', anchor: 'sceneStart', prim: 'formula', latex: '\\frac{a' }, { w: 300, h: 120 });
  assert.equal(v.embeds, undefined);
  assert.equal(v.texts[0].text, '\\frac{a');
});

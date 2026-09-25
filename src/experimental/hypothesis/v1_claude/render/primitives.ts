import type { Element, PrimitiveVisual, TextRun } from '../types.js';
import { STYLE, paletteFill } from '../style.js';
import { formulaSource, formulaTex, typesetTex } from './math.js';
import { measureTextWidth } from '../layout/measure.js';
import { numberLineVisual, plotVisual, shapeVisual } from './plot.js';
import { ellipsePath, polylinePath, roundedRectPath, smoothCurvePath } from './pathmath.js';

const upper = (s: string) => (STYLE.font.uppercaseLabels ? s.toUpperCase() : s);
const text = (x: number, y: number, s: string, size: number, anchor: TextRun['anchor'] = 'middle'): TextRun => ({ x, y, text: s, size, anchor });

/**
 * Renders every SceneSpec primitive to a local-space `PrimitiveVisual`
 * (paths/fills/texts), origin (0,0), sized to `size`. This is the ONLY place
 * shape geometry is produced from element content — layout only positions
 * and scales these visuals, and the timeline/renderer only reveals them.
 * Deterministic: identical `(el, size)` always yields byte-identical output
 * (no Date.now/Math.random anywhere in this module).
 */
export function renderPrimitive(el: Element, size: { w: number; h: number }): PrimitiveVisual {
  const { w, h } = size;
  switch (el.prim) {
    case 'box': {
      const rect = roundedRectPath(0, 0, w, h, 18);
      const label = el.text ?? el.glyph ?? el.label ?? '';
      return {
        paths: [rect],
        fills: el.fill ? [{ d: rect.d, fill: paletteFill(el.fill) }] : [],
        texts: label ? [text(w / 2, h / 2 + STYLE.font.sizes.body * 0.35, upper(label), STYLE.font.sizes.body)] : [],
      };
    }
    case 'pill': {
      const rect = roundedRectPath(0, 0, w, h, h / 2);
      return {
        paths: [rect],
        fills: el.fill ? [{ d: rect.d, fill: paletteFill(el.fill) }] : [],
        texts: [text(w / 2, h / 2 + STYLE.font.sizes.body * 0.35, upper(el.text), STYLE.font.sizes.body)],
      };
    }
    case 'tokenStrip': {
      const n = el.tokens.length;
      const gap = 20;
      const rawWidths = el.tokens.map((token) => Math.max(80, measureTextWidth(token, STYLE.font.sizes.label) + 24));
      const naturalW = rawWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, n - 1) * gap;
      const sx = naturalW > 0 ? w / naturalW : 1;
      const tokenWidths = rawWidths.map((width) => width * sx);
      const fills = [];
      const texts: TextRun[] = [];
      let x = 0;
      for (let i = 0; i < n; i++) {
        const tokenW = tokenWidths[i];
        const highlighted = el.highlight?.includes(i);
        if (highlighted) {
          const markH = Math.min(56, h * 0.62);
          const mark = roundedRectPath(x, (h - markH) / 2, tokenW, markH, markH / 2);
          // A single marker highlight distinguishes the selected token; unselected
          // words remain bare text instead of looking like a row of interface cards.
          fills.push({ d: mark.d, fill: paletteFill('orange') });
        }
        texts.push(text(x + tokenW / 2, h / 2 + STYLE.font.sizes.label * 0.35, upper(el.tokens[i]), STYLE.font.sizes.label));
        x += tokenW + gap * sx;
      }
      return { paths: [], fills, texts };
    }
    case 'operator': {
      if (el.symbol === 'softmax') {
        // A named operation reads as a labelled box in the reference frames ("SOFTMAX"), not a glyph in a circle.
        const rect = roundedRectPath(0, 0, w, h, 14);
        return { paths: [rect], fills: [{ d: rect.d, fill: paletteFill(el.fill ?? 'blue') }], texts: [text(w / 2, h / 2 + STYLE.font.sizes.body * 0.35, 'SOFTMAX', STYLE.font.sizes.body)] };
      }
      const r = Math.min(w, h) / 2;
      const circ = ellipsePath(w / 2, h / 2, r, r);
      return {
        paths: [circ],
        fills: [{ d: circ.d, fill: STYLE.canvas.bg }],
        texts: [text(w / 2, h / 2 + STYLE.font.sizes.title * 0.32, el.symbol, STYLE.font.sizes.title)],
      };
    }
    case 'meter': {
      const n = el.values.length;
      const barW = (w - (n - 1) * 20) / n;
      const baseline = polylinePath([{ x: 0, y: h }, { x: w, y: h }]);
      const paths = [baseline];
      const fills = [];
      const texts: TextRun[] = [];
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(1, el.values[i]));
        const barH = v * (h - 40);
        const x = i * (barW + 20);
        const bar = roundedRectPath(x, h - barH - 40, barW, barH, 6);
        paths.push(bar);
        fills.push({ d: bar.d, fill: paletteFill(el.fill ?? 'blue') });
        if (el.labels?.[i]) texts.push(text(x + barW / 2, h - 8, upper(el.labels[i]), STYLE.font.sizes.note));
      }
      return { paths, fills, texts };
    }
    case 'matrix': {
      const rows = el.rows.length;
      const cols = Math.max(...el.rows.map((r) => r.length));
      const cellW = w / cols;
      const cellH = h / rows;
      const paths = [
        polylinePath([{ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: h }, { x: 4, y: h }]),
        polylinePath([{ x: w - 4, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: w - 4, y: h }]),
      ];
      const texts: TextRun[] = [];
      el.rows.forEach((row, r) =>
        row.forEach((cell, c) => texts.push(text(c * cellW + cellW / 2, r * cellH + cellH / 2 + STYLE.font.sizes.note * 0.32, cell, STYLE.font.sizes.note))),
      );
      return { paths, fills: [], texts };
    }
    case 'formula': {
      // Typeset with MathJax (render/math.ts). Unboxed, like chalkboard math.
      // A TeX parse error falls back to the literal source as visible text (and the formula-error gate fails the scene).
      const tex = typesetTex(formulaTex(el));
      if (!tex) return { paths: [], fills: [], texts: [text(w / 2, h / 2 + STYLE.font.sizes.body * 0.32, formulaSource(el), STYLE.font.sizes.body)] };
      return { paths: [], fills: [], texts: [], embeds: [{ x: 0, y: 0, w, h, viewBox: tex.viewBox, body: tex.body }] };
    }
    case 'container': {
      const rect = roundedRectPath(2, 2, w - 4, h - 4, 20);
      return { paths: [rect], fills: [], texts: [] };
    }
    case 'cylinder': {
      const rx = w / 2;
      const ry = Math.min(24, h * 0.12);
      const top = ellipsePath(rx, ry, rx, ry);
      const bottom = ellipsePath(rx, h - ry, rx, ry);
      const sides = polylinePath([{ x: 0, y: ry }, { x: 0, y: h - ry }]);
      const sides2 = polylinePath([{ x: w, y: ry }, { x: w, y: h - ry }]);
      return {
        paths: [top, bottom, sides, sides2],
        fills: [],
        texts: el.text ? [text(w / 2, h / 2 + STYLE.font.sizes.note * 0.32, upper(el.text), STYLE.font.sizes.note)] : [],
      };
    }
    case 'stack': {
      const offset = 14;
      const cardH = h - offset * (el.count - 1);
      const paths = [];
      for (let i = el.count - 1; i >= 0; i--) paths.push(roundedRectPath(i * offset * 0.4, i * offset, w - i * offset * 0.8, cardH, 14));
      return {
        paths,
        fills: [],
        texts: el.text ? [text(w / 2, cardH / 2 + STYLE.font.sizes.note * 0.32, upper(el.text), STYLE.font.sizes.note)] : [],
      };
    }
    case 'axis': {
      const xAxis = polylinePath([{ x: 0, y: h }, { x: w, y: h }]);
      const yAxis = polylinePath([{ x: 0, y: 0 }, { x: 0, y: h }]);
      const paths = [xAxis, yAxis];
      if (el.points && el.points.length > 1) {
        const xs = el.points.map((p) => p[0]);
        const ys = el.points.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const mapped = el.points.map(([px, py]) => ({
          x: ((px - minX) / Math.max(1e-6, maxX - minX)) * w,
          y: h - ((py - minY) / Math.max(1e-6, maxY - minY)) * h,
        }));
        paths.push(el.kind === 'curve' ? smoothCurvePath(mapped) : polylinePath(mapped));
      }
      return { paths, fills: [], texts: [] };
    }
    case 'hill': {
      const n = el.peaks.length;
      const points = el.peaks.map((p, i) => ({ x: (i / Math.max(1, n - 1)) * w, y: h - Math.max(0, Math.min(1, p)) * h }));
      const curve = smoothCurvePath(points);
      const marker = el.marker !== undefined ? { x: (el.marker / Math.max(1, n - 1)) * w, y: h * 0.1 } : undefined;
      const markerPaths = marker ? [ellipsePath(marker.x, points[Math.round(el.marker!)]?.y ?? marker.y, 10, 10)] : [];
      return { paths: [curve, ...markerPaths], fills: [], texts: [] };
    }
    case 'plot':
      return plotVisual(el, size);
    case 'numberLine':
      return numberLineVisual(el, size);
    case 'shape':
      return shapeVisual(el, size);
    case 'text':
      return { paths: [], fills: [], texts: [text(w / 2, h / 2 + STYLE.font.sizes[el.size] * 0.32, upper(el.text), STYLE.font.sizes[el.size], 'middle')] };
    case 'object':
      // Object elements are resolved by the catalog ladder (see catalog/ladder.ts);
      // this branch only executes if a caller renders one directly without
      // going through resolution, which should never happen on the critical path.
      throw new Error(`'object' elements must be resolved via the catalog ladder before rendering (${el.id})`);
    default: {
      const _exhaustive: never = el;
      throw new Error(`unhandled primitive ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Rung-4 always-resolves fallback: a styled text box carrying the concept label (claude_pipeline.md §10). */
export function styledTextBoxVisual(labelText: string, size: { w: number; h: number }, badge?: string): PrimitiveVisual {
  const rect = roundedRectPath(0, 0, size.w, size.h, 16);
  // Scale using measured ink width at the body tier; never shrink below the
  // shared readable note tier (G6 blocks overflow/undersized text later).
  const bodySize = STYLE.font.sizes.body;
  const bodyWidth = Math.max(1, measureTextWidth(labelText, bodySize));
  const fitted = Math.max(STYLE.font.sizes.note, Math.min(bodySize, (size.w * 0.88 / bodyWidth) * bodySize));
  const texts = [text(size.w / 2, size.h / 2 + fitted * 0.32, upper(labelText), fitted)];
  if (badge) texts.push(text(size.w - 24, 28, badge, STYLE.font.sizes.note, 'end'));
  return { paths: [rect], fills: [{ d: rect.d, fill: paletteFill('grey') }], texts };
}

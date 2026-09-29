import type { FillShape, NumberLineBody, PaletteToken, PlotBody, PlotFn, PrimitiveVisual, ShapeBody, StrokePath, TextRun } from '../types.js';
import { STYLE, paletteFill } from '../style.js';
import { ellipsePath, polylinePath } from './pathmath.js';

/**
 * Math-intuition primitives (plan Phase 3). The Scene Planner picks a closed
 * function family + parameters; this module samples the curve itself, so a
 * model never emits coordinates, point lists, or code (AGENTS.md #3).
 *
 * Paths are emitted in pen order so the existing sequential stroke reveal
 * draws them the way a tutor would: axes -> curve -> tangent -> trajectory
 * steps; marker dots fade in with the fill phase; labels wipe in last.
 */
export function evalPlot(fn: PlotFn, p: number[], x: number): number {
  switch (fn) {
    case 'linear': return p[0] * x + p[1];
    case 'quadratic': return p[0] * x * x + p[1] * x + p[2];
    case 'cubic': return p[0] * x ** 3 + p[1] * x * x + p[2] * x + p[3];
    case 'sine': return p[0] * Math.sin(p[1] * x + p[2]) + p[3];
    case 'exp': return p[0] * Math.exp(p[1] * x) + p[2];
    case 'log': return p[0] * Math.log(p[1] * x) + p[2];
    case 'normal': return p[0] * Math.exp(-((x - p[1]) ** 2) / (2 * p[2] * p[2]));
  }
}

const SAMPLES = 96;
const PAD = { left: 44, right: 24, top: 28, bottom: 52 };
const HEAD = 14;

function arrowHead(tip: { x: number; y: number }, angle: number): StrokePath {
  const a = { x: tip.x - HEAD * Math.cos(angle - 0.5), y: tip.y - HEAD * Math.sin(angle - 0.5) };
  const b = { x: tip.x - HEAD * Math.cos(angle + 0.5), y: tip.y - HEAD * Math.sin(angle + 0.5) };
  return polylinePath([a, tip, b]);
}

/** Liang-Barsky clip of segment p->q to the plot rect (tangent lines must not leave the axes). */
function clip(p: { x: number; y: number }, q: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - r.x0], [dx, r.x1 - p.x], [-dy, p.y - r.y0], [dy, r.y1 - p.y]] as Array<[number, number]>) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (t0 > t1) return null;
  return [{ x: p.x + t0 * dx, y: p.y + t0 * dy }, { x: p.x + t1 * dx, y: p.y + t1 * dy }];
}

export function plotVisual(el: PlotBody & { fill?: string }, size: { w: number; h: number }): PrimitiveVisual {
  const { w, h } = size;
  const [a, b] = el.domain;
  const f = (x: number) => evalPlot(el.fn, el.params, x);
  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => a + ((b - a) * i) / SAMPLES);
  const ys = xs.map(f).filter(Number.isFinite);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.1;
  yMin -= yPad; yMax += yPad;
  const r = { x0: PAD.left, y0: PAD.top, x1: w - PAD.right, y1: h - PAD.bottom };
  const sx = (x: number) => r.x0 + ((x - a) / (b - a)) * (r.x1 - r.x0);
  const sy = (y: number) => r.y1 - ((y - yMin) / (yMax - yMin)) * (r.y1 - r.y0);

  const paths: StrokePath[] = [];
  const fills: FillShape[] = [];
  const texts: TextRun[] = [];
  const note = STYLE.font.sizes.note;

  // Axes with arrowheads.
  paths.push(polylinePath([{ x: r.x0, y: r.y1 }, { x: r.x1 + 12, y: r.y1 }]), arrowHead({ x: r.x1 + 12, y: r.y1 }, 0));
  paths.push(polylinePath([{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 - 12 }]), arrowHead({ x: r.x0, y: r.y0 - 12 }, -Math.PI / 2));
  if (el.xLabel) texts.push({ x: r.x1, y: h - 12, text: el.xLabel.toUpperCase(), size: note, anchor: 'end' });
  if (el.yLabel) texts.push({ x: r.x0 + 12, y: r.y0 + 4, text: el.yLabel.toUpperCase(), size: note, anchor: 'start' });

  // Curve (split where the function is undefined).
  let run: Array<{ x: number; y: number }> = [];
  const flush = () => { if (run.length > 1) paths.push(polylinePath(run)); run = []; };
  for (const x of xs) {
    const y = f(x);
    if (Number.isFinite(y)) run.push({ x: sx(x), y: sy(y) }); else flush();
  }
  flush();

  // Rise/run triangle: slope as rise over run, between two points on the curve.
  if (el.riseRun) {
    const [x1, x2] = el.riseRun;
    const A = { x: sx(x1), y: sy(f(x1)) }, B = { x: sx(x2), y: sy(f(x2)) };
    const corner = { x: B.x, y: A.y };
    paths.push({ ...polylinePath([A, corner]), group: 'riseRun' }, { ...polylinePath([corner, B]), group: 'riseRun' });
    texts.push({ x: (A.x + corner.x) / 2, y: A.y + note + 6, text: 'RUN', size: note, anchor: 'middle', group: 'riseRun' });
    texts.push({ x: corner.x + 14, y: (A.y + B.y) / 2 + note * 0.35, text: 'RISE', size: note, anchor: 'start', group: 'riseRun' });
  }

  // Tangent at x0: slope intuition (derivative).
  if (el.tangentAt !== undefined) {
    const x0 = el.tangentAt;
    const hx = (b - a) * 1e-4;
    const slope = (f(x0 + hx) - f(x0 - hx)) / (2 * hx);
    const span = (b - a) * 0.22;
    const seg = clip({ x: sx(x0 - span), y: sy(f(x0) - slope * span) }, { x: sx(x0 + span), y: sy(f(x0) + slope * span) }, r);
    if (seg) paths.push({ ...polylinePath(seg), group: 'tangent' });
    const dot = ellipsePath(sx(x0), sy(f(x0)), 8, 8);
    fills.push({ d: dot.d, fill: paletteFill('orange'), group: 'tangent' });
    paths.push({ ...dot, group: 'tangent' });
  }

  // Trajectory: step arrows walked along the curve (e.g. gradient-descent updates).
  if (el.trajectory) {
    const pts = el.trajectory.map((x) => ({ x: sx(x), y: sy(f(x)) }));
    pts.forEach((pt, i) => {
      const dot = ellipsePath(pt.x, pt.y, 9, 9);
      fills.push({ d: dot.d, fill: paletteFill((el.fill as never) ?? 'red'), group: 'steps' });
      paths.push({ ...dot, group: 'steps' });
      if (i > 0) {
        const prev = pts[i - 1];
        const len = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        if (len > 26) {
          const ux = (pt.x - prev.x) / len, uy = (pt.y - prev.y) / len;
          // Offset slightly above the curve so the step reads as a jump, not a redrawn curve.
          const s0 = { x: prev.x + ux * 12, y: prev.y + uy * 12 - 18 };
          const s1 = { x: pt.x - ux * 12, y: pt.y - uy * 12 - 18 };
          paths.push({ ...polylinePath([s0, s1]), group: 'steps' }, { ...arrowHead(s1, Math.atan2(s1.y - s0.y, s1.x - s0.x)), group: 'steps' });
        }
      }
    });
  }

  // Labelled markers.
  for (const m of el.markers ?? []) {
    const pt = { x: sx(m.x), y: sy(f(m.x)) };
    const dot = ellipsePath(pt.x, pt.y, 9, 9);
    fills.push({ d: dot.d, fill: STYLE.stroke.color });
    if (m.label) texts.push({ x: pt.x, y: pt.y - 20, text: m.label.toUpperCase(), size: note, anchor: 'middle' });
  }

  return { paths, fills, texts };
}

export function numberLineVisual(el: NumberLineBody, size: { w: number; h: number }): PrimitiveVisual {
  const { w, h } = size;
  const y = h * 0.55;
  const x0 = 30, x1 = w - 30;
  const sx = (v: number) => x0 + ((v - el.min) / (el.max - el.min)) * (x1 - x0);
  const paths: StrokePath[] = [polylinePath([{ x: x0 - 16, y }, { x: x1 + 16, y }]), arrowHead({ x: x1 + 16, y }, 0), arrowHead({ x: x0 - 16, y }, Math.PI)];
  const fills: FillShape[] = [];
  const texts: TextRun[] = [];
  const note = STYLE.font.sizes.note;
  if (el.interval) {
    const [p, q] = el.interval.map(sx);
    fills.push({ d: `M ${p} ${y - 10} H ${q} V ${y + 10} H ${p} Z`, fill: paletteFill('blue') });
  }
  for (let i = 0; i < el.ticks; i++) {
    const v = el.min + ((el.max - el.min) * i) / (el.ticks - 1);
    const x = sx(v);
    paths.push(polylinePath([{ x, y: y - 12 }, { x, y: y + 12 }]));
    const shown = Number.isInteger(v) ? String(v) : v.toFixed(1);
    texts.push({ x, y: y + 12 + note + 4, text: shown, size: note, anchor: 'middle' });
  }
  for (const pt of el.points ?? []) {
    const dot = ellipsePath(sx(pt.x), y, 11, 11);
    fills.push({ d: dot.d, fill: paletteFill('orange') });
    paths.push(dot);
    if (pt.label) texts.push({ x: sx(pt.x), y: y - 26, text: pt.label.toUpperCase(), size: note, anchor: 'middle' });
  }
  return { paths, fills, texts };
}

/** Geometry figure: outline (pen order), flat fill, right-angle mark, side labels outside each side. */
export function shapeVisual(el: ShapeBody & { fill?: PaletteToken }, size: { w: number; h: number }): PrimitiveVisual {
  const { w, h } = size;
  const pad = 44;
  const lab = STYLE.font.sizes.body; // primary text (side names, areas), same tier as box text
  const fill = paletteFill(el.fill ?? 'blue');
  const paths: StrokePath[] = [];
  const fills: FillShape[] = [];
  const texts: TextRun[] = [];
  const label = (i: number, x: number, y: number, anchor: TextRun['anchor'] = 'middle') => {
    const t = el.sideLabels?.[i];
    if (t) texts.push({ x, y, text: t, size: lab, anchor });
  };
  if (el.kind === 'rightTriangle' || el.kind === 'triangle') {
    const A = { x: pad, y: h - pad };
    const B = { x: w - pad, y: h - pad };
    const C = el.kind === 'rightTriangle' ? { x: pad, y: pad } : { x: w / 2, y: pad };
    const outline = polylinePath([A, B, C, A]);
    paths.push(outline);
    fills.push({ d: `${outline.d} Z`, fill });
    if (el.kind === 'rightTriangle') {
      const m = 26;
      paths.push(polylinePath([{ x: A.x, y: A.y - m }, { x: A.x + m, y: A.y - m }, { x: A.x + m, y: A.y }]));
    }
    label(0, (A.x + C.x) / 2 - 16, (A.y + C.y) / 2 + lab * 0.35, 'end');
    label(1, (A.x + B.x) / 2, A.y + lab + 8);
    label(2, (B.x + C.x) / 2 + 18, (B.y + C.y) / 2 - 10, 'start');
  } else if (el.kind === 'circle') {
    const r = Math.min(w, h) / 2 - pad / 2;
    const c = ellipsePath(w / 2, h / 2, r, r);
    paths.push(c, polylinePath([{ x: w / 2, y: h / 2 }, { x: w / 2 + r, y: h / 2 }]));
    fills.push({ d: c.d, fill });
    label(0, w / 2 + r / 2, h / 2 - 12);
  } else {
    const side = el.kind === 'square' ? Math.min(w, h) - 2 * pad : 0;
    const x0 = el.kind === 'square' ? (w - side) / 2 : pad;
    const y0 = el.kind === 'square' ? (h - side) / 2 : pad;
    const ww = el.kind === 'square' ? side : w - 2 * pad;
    const hh = el.kind === 'square' ? side : h - 2 * pad;
    const rect = polylinePath([{ x: x0, y: y0 }, { x: x0 + ww, y: y0 }, { x: x0 + ww, y: y0 + hh }, { x: x0, y: y0 + hh }, { x: x0, y: y0 }]);
    paths.push(rect);
    fills.push({ d: `${rect.d} Z`, fill });
    label(0, x0 + ww / 2, y0 + hh + lab + 8);
    label(1, x0 + ww + 14, y0 + hh / 2 + lab * 0.35, 'start');
  }
  // Case is preserved: in math a and A are different variables.
  if (el.text) texts.push({ x: w / 2, y: h / 2 + lab * 0.35, text: el.text, size: lab, anchor: 'middle' });
  return { paths, fills, texts };
}

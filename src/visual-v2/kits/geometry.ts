import type { EmbeddedSvg, FillShape, PrimitiveVisual, StrokePath, TextRun } from '../../shared/types.js';
import { ellipsePath, polylinePath, roundedRectPath } from '../../render/pathmath.js';
import { STYLE } from '../../render/style.js';

export interface Rect { x: number; y: number; w: number; h: number }

export const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(1, r.w - 2 * d), h: Math.max(1, r.h - 2 * d) });
export const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const emptyVisual = (): PrimitiveVisual => ({ paths: [], fills: [], texts: [] });
export const upper = (text: string): string => (STYLE.font.uppercaseLabels ? text.toUpperCase() : text);

export const boxPath = (r: Rect, radius = 18): StrokePath => roundedRectPath(r.x, r.y, r.w, r.h, radius);
export const linePath = (x1: number, y1: number, x2: number, y2: number): StrokePath => polylinePath([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
export const circlePath = (cx: number, cy: number, r: number): StrokePath => ellipsePath(cx, cy, r, r);

/** A shaft and an open arrowhead, as two paths so the shaft draws first. */
export function arrowPaths(x1: number, y1: number, x2: number, y2: number, head = 22): StrokePath[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const wing = (delta: number) => ({ x: x2 - head * Math.cos(angle + delta), y: y2 - head * Math.sin(angle + delta) });
  return [linePath(x1, y1, x2, y2), polylinePath([wing(0.5), { x: x2, y: y2 }, wing(-0.5)])];
}

export function dashedLinePaths(x1: number, y1: number, x2: number, y2: number, dash = 18, gap = 14): StrokePath[] {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const out: StrokePath[] = [];
  for (let at = 0; at < length; at += dash + gap) {
    const end = Math.min(length, at + dash);
    out.push(linePath(x1 + ux * at, y1 + uy * at, x1 + ux * end, y1 + uy * end));
  }
  return out;
}

export const textRun = (x: number, y: number, text: string, size: number, anchor: TextRun['anchor'] = 'middle'): TextRun => ({ x, y, text: upper(text), size, anchor });

export const fillOf = (path: StrokePath, fill: string): FillShape => ({ d: path.d, fill });

/** Move a visual drawn at the origin to (dx, dy) without rewriting its paths. */
export function shiftVisual(visual: PrimitiveVisual, dx: number, dy: number): PrimitiveVisual {
  const tf = `translate(${dx} ${dy})`;
  const shifted = (existing: string | undefined) => (existing ? `${tf} ${existing}` : tf);
  return {
    paths: visual.paths.map((p) => ({ ...p, transform: shifted(p.transform) })),
    fills: visual.fills.map((f) => ({ ...f, transform: shifted(f.transform) })),
    texts: visual.texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
    ...(visual.embeds ? { embeds: visual.embeds.map((e): EmbeddedSvg => ({ ...e, x: e.x + dx, y: e.y + dy })) } : {}),
  };
}

export const mergeVisuals = (...parts: PrimitiveVisual[]): PrimitiveVisual => ({
  paths: parts.flatMap((p) => p.paths), fills: parts.flatMap((p) => p.fills), texts: parts.flatMap((p) => p.texts),
  ...(parts.some((p) => p.embeds?.length) ? { embeds: parts.flatMap((p) => p.embeds ?? []) } : {}),
});

/** Split a rect into `count` cells, left to right. */
export function rowCells(r: Rect, count: number, gap = 0): Rect[] {
  const w = (r.w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: r.x + i * (w + gap), y: r.y, w, h: r.h }));
}

/** Pack `count` equal cells into a rect, row by row, as square as the rect allows. */
export function gridCells(r: Rect, count: number, maxCell = 80, gap = 8): Rect[] {
  if (count <= 0) return [];
  const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt((count * r.w) / Math.max(1, r.h)))));
  const rows = Math.ceil(count / cols);
  const size = Math.max(8, Math.min(maxCell, (r.w - gap * (cols - 1)) / cols, (r.h - gap * (rows - 1)) / rows));
  const usedW = cols * size + (cols - 1) * gap;
  const usedH = rows * size + (rows - 1) * gap;
  const x0 = r.x + (r.w - usedW) / 2;
  const y0 = r.y + (r.h - usedH) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + (i % cols) * (size + gap), y: y0 + Math.floor(i / cols) * (size + gap), w: size, h: size }));
}

/** Where the ray from the centre of `r` toward `toward` leaves `r` (plus `pad`). */
export function borderPoint(r: Rect, toward: { x: number; y: number }, pad = 0): { x: number; y: number } {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : (r.w / 2 + pad) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (r.h / 2 + pad) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

export const overlaps = (a: Rect, b: Rect, tolerance = 0.5): boolean => a.x < b.x + b.w - tolerance && b.x < a.x + a.w - tolerance && a.y < b.y + b.h - tolerance && b.y < a.y + a.h - tolerance;
export const contains = (outer: Rect, inner: Rect, tolerance = 0.5): boolean => inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.w <= outer.x + outer.w + tolerance && inner.y + inner.h <= outer.y + outer.h + tolerance;

/** True when the segment a→b passes through the interior of `r` (shrunk by `inset`), by Liang–Barsky clipping. */
export function segmentCrossesRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect, inset = 4): boolean {
  const x0 = r.x + inset; const x1 = r.x + r.w - inset; const y0 = r.y + inset; const y1 = r.y + r.h - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0; let t1 = 1;
  const dx = b.x - a.x; const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 > t0;
}

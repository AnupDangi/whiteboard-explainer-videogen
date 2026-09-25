import type { StrokePath } from '../types.js';

/**
 * Analytic path-length helpers. hypothesis/v1_claude/04 names
 * `svg-path-properties` for this; it is not installed this pass (dependency
 * footprint kept to `zod` only — see docs/HANDOFF.md), so lengths below are
 * computed analytically for the small set of primitive shapes this renderer
 * emits (rects, lines, ellipses, sampled curves) rather than via generic SVG
 * path parsing. This is exact for straight/rounded-rect/ellipse geometry and
 * a close numerical approximation (dense sampling) for curves.
 */

export function roundedRectPath(x: number, y: number, w: number, h: number, rx: number): StrokePath {
  const r = Math.max(0, Math.min(rx, w / 2, h / 2));
  if (r === 0) {
    const d = `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    return { d, length: 2 * (w + h) };
  }
  const d = [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
  const straight = 2 * (w - 2 * r) + 2 * (h - 2 * r);
  const corners = 2 * Math.PI * r; // four quarter-circles = one full circle
  return { d, length: straight + corners };
}

export function polylinePath(points: Array<{ x: number; y: number }>): StrokePath {
  if (points.length < 2) return { d: '', length: 0 };
  let d = `M ${points[0].x} ${points[0].y}`;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return { d, length };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): StrokePath {
  const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  // Ramanujan's second approximation for ellipse circumference.
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  const length = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  return { d, length };
}

/** Smooth curve through `points` (Catmull-Rom-ish quadratic joins), length via dense sampling. */
export function smoothCurvePath(points: Array<{ x: number; y: number }>, samples = 64): StrokePath {
  if (points.length < 2) return { d: '', length: 0 };
  if (points.length === 2) return polylinePath(points);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
    if (i === points.length - 1) d += ` L ${cur.x} ${cur.y}`;
  }
  // Sample the same quadratic sequence for length (deterministic, no randomness).
  let length = 0;
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    const steps = Math.max(2, Math.round(samples / points.length));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const qx = (1 - t) * (1 - t) * prev.x + 2 * (1 - t) * t * prev.x + t * t * midX;
      const qy = (1 - t) * (1 - t) * prev.y + 2 * (1 - t) * t * prev.y + t * t * midY;
      length += Math.hypot(qx - last.x, qy - last.y);
      last = { x: qx, y: qy };
    }
  }
  return { d, length };
}

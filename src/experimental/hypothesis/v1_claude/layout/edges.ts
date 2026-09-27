import type { BBox, Edge, RoutedEdge } from '../types.js';
import { STYLE } from '../style.js';
import { measureTextWidth } from './measure.js';
import { boundaryPoint, rectCenter } from './geometry.js';

function segmentsIntersect(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const d = (p: typeof a1, q: typeof a1, r: typeof a1) => (r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentIntersectsRect(p1: { x: number; y: number }, p2: { x: number; y: number }, r: BBox): boolean {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  for (let i = 0; i < 4; i++) if (segmentsIntersect(p1, p2, corners[i], corners[(i + 1) % 4])) return true;
  return false;
}

/** Arrows stop short of both boxes (reference frames leave a visible gap between arrow and node). */
export const EDGE_INSET = 16;

function inset(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const out = points.map((p) => ({ ...p }));
  const shift = (a: { x: number; y: number }, toward: { x: number; y: number }) => {
    const len = Math.hypot(toward.x - a.x, toward.y - a.y);
    if (len <= EDGE_INSET * 2.5) return; // too short to inset without collapsing the arrow
    a.x += ((toward.x - a.x) / len) * EDGE_INSET;
    a.y += ((toward.y - a.y) / len) * EDGE_INSET;
  };
  shift(out[0], points[1]);
  shift(out[out.length - 1], points[points.length - 2]);
  return out;
}

/**
 * Straight or single-bend routing between element boundary points, never
 * centers (claude_pipeline.md §14 / hypothesis/v1_claude/01 §6). A straight
 * line is used unless it would cross a third element's bbox, in which case a
 * deterministic Manhattan-style single bend is inserted.
 */
export function routeEdges(edges: Edge[], boxes: Map<string, BBox>): RoutedEdge[] {
  const others = (fromId: string, toId: string) => [...boxes.entries()].filter(([id]) => id !== fromId && id !== toId).map(([, b]) => b);

  return edges.map((edge) => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) return { ...edge, points: [] };

    const fromC = rectCenter(from);
    const toC = rectCenter(to);
    const straightStart = boundaryPoint(from, toC);
    const straightEnd = boundaryPoint(to, fromC);
    const obstacles = others(edge.from, edge.to);
    const blocked = obstacles.some((r) => segmentIntersectsRect(straightStart, straightEnd, r));

    if (!blocked) return { ...edge, points: inset([straightStart, straightEnd]) };

    // Try both single-bend orders (horizontal-first, vertical-first); keep the first unobstructed one.
    // If both are blocked, a straight arrow still reads better than a detour through other nodes.
    for (const bend of [{ x: toC.x, y: fromC.y }, { x: fromC.x, y: toC.y }]) {
      const p1 = boundaryPoint(from, bend);
      const p2 = boundaryPoint(to, bend);
      const clear = !obstacles.some((r) => segmentIntersectsRect(p1, bend, r) || segmentIntersectsRect(bend, p2, r));
      if (clear) return { ...edge, points: inset([p1, bend, p2]) };
    }
    // Both bends blocked (e.g. callouts stacked in a column with an arrow skipping the middle ones):
    // detour around the side of everything between them rather than cutting through other nodes' labels.
    const between = [from, to, ...obstacles.filter((r) => r.y < Math.max(from.y + from.h, to.y + to.h) && r.y + r.h > Math.min(from.y, to.y))];
    const right = Math.max(...between.map((r) => r.x + r.w)) + 36;
    const a = { x: from.x + from.w, y: fromC.y };
    const b = { x: to.x + to.w, y: toC.y };
    return { ...edge, points: inset([a, { x: right, y: a.y }, { x: right, y: b.y }, b]) };
  });
}

/** Default label anchor for a routed edge: the midpoint segment's center, lifted above the line. Shared with the renderer so layout and render agree. */
export function edgeLabelAnchor(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const mid = points[Math.floor(points.length / 2) - (points.length % 2 === 0 ? 1 : 0)];
  const next = points[Math.min(points.length - 1, points.indexOf(mid) + 1)];
  return { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 - 16 };
}

/** Shorten a label to a measured width budget by dropping trailing words, then characters; '' when nothing fits. Deterministic. */
function shortenEdgeLabel(label: string, maxWidth: number, fontSize: number): string {
  if (measureTextWidth(label, fontSize) <= maxWidth) return label;
  const words = label.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const candidate = `${words.slice(0, n).join(' ')} …`;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) return candidate;
  }
  const word = words[0] ?? '';
  for (let n = word.length - 1; n >= 1; n--) {
    const candidate = `${word.slice(0, n)}…`;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) return candidate;
  }
  return '';
}

/**
 * Fit every edge label inside the canvas safe area: clamp the anchor into
 * the safe rect, shorten an over-wide label to the safe width, and drop a
 * label that cannot fit at all — so no label ever renders past the frame
 * edge. The fitted anchor is stored as `labelPos`, which the renderer draws.
 */
export function fitEdgeLabels(edges: RoutedEdge[]): RoutedEdge[] {
  const safe = STYLE.canvas.safe;
  const size = STYLE.font.sizes.note;
  const maxWidth = STYLE.canvas.w - 2 * safe;
  return edges.map((edge) => {
    if (!edge.label || edge.points.length < 2) return edge;
    let label = edge.label;
    let width = measureTextWidth(label, size);
    if (width > maxWidth) {
      label = shortenEdgeLabel(label, maxWidth, size);
      if (!label) return { ...edge, label: undefined, labelPos: undefined };
      width = measureTextWidth(label, size);
    }
    const anchor = edgeLabelAnchor(edge.points);
    const x = Math.min(Math.max(anchor.x, safe + width / 2), STYLE.canvas.w - safe - width / 2);
    const y = Math.min(Math.max(anchor.y, safe + size), STYLE.canvas.h - safe);
    return { ...edge, label, labelPos: { x, y } };
  });
}

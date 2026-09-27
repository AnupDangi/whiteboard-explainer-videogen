import type { BBox, Edge, RoutedEdge } from '../types.js';
import { boundaryPoint, rectCenter } from './geometry.js';
import { measureTextWidth } from './measure.js';
import { STYLE } from '../style.js';

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
  return placeEdgeLabels(routeEdgePaths(edges, boxes), boxes);
}

const LABEL_GAP = 16;
const overlaps = (a: BBox, b: BBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Give each labelled edge a label box beside one of its segments that does
 * not cover a node or an earlier label: middle segment first, above then
 * below (or left then right of a vertical segment). When no position is
 * clear the first candidate is kept and `labelOverlapsNode` is set, so the
 * gate reports it instead of the label silently covering a node.
 */
function placeEdgeLabels(edges: RoutedEdge[], boxes: Map<string, BBox>): RoutedEdge[] {
  const taken: BBox[] = [...boxes.values()];
  return edges.map((edge) => {
    if (!edge.label || edge.points.length < 2) return edge;
    const size = STYLE.font.sizes.note;
    const w = measureTextWidth(edge.label, size) + 8;
    const h = size * 1.2;
    const segments = edge.points.slice(1).map((end, i) => ({ start: edge.points[i]!, end }));
    const middle = Math.floor((segments.length - 1) / 2);
    const order = [middle, ...segments.map((_, i) => i).filter((i) => i !== middle)];
    const candidates: BBox[] = [];
    for (const index of order) {
      const { start, end } = segments[index]!;
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x);
      const offsets = vertical ? [[-(w / 2 + LABEL_GAP), 0], [w / 2 + LABEL_GAP, 0]] : [[0, -(h / 2 + LABEL_GAP)], [0, h / 2 + LABEL_GAP]];
      for (const [dx, dy] of offsets) candidates.push({ x: cx + dx! - w / 2, y: cy + dy! - h / 2, w, h });
    }
    // A gap narrower than the label: put it above, then below, both end nodes.
    const ends = [boxes.get(edge.from), boxes.get(edge.to)].filter((box): box is BBox => Boolean(box));
    if (ends.length) {
      const { start, end } = segments[middle]!;
      const cx = (start.x + end.x) / 2;
      candidates.push({ x: cx - w / 2, y: Math.min(...ends.map((box) => box.y)) - LABEL_GAP - h, w, h });
      candidates.push({ x: cx - w / 2, y: Math.max(...ends.map((box) => box.y + box.h)) + LABEL_GAP, w, h });
    }
    const clear = candidates.find((box) => !taken.some((other) => overlaps(box, other)));
    const labelBox = clear ?? candidates[0]!;
    taken.push(labelBox);
    return { ...edge, labelBox, ...(clear ? {} : { labelOverlapsNode: true }) };
  });
}

function routeEdgePaths(edges: Edge[], boxes: Map<string, BBox>): RoutedEdge[] {
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

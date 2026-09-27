import type { BBox, Edge, RoutedEdge } from '../types.js';
import { boundaryPoint, rectCenter } from './geometry.js';
import { STYLE } from '../style.js';

type Point = { x: number; y: number };

/** Tests the open interior, so an arrow may touch a node boundary but cannot
 * cross or lie entirely inside its label box. */
export function segmentIntersectsRect(p1: Point, p2: Point, r: BBox): boolean {
  const epsilon = 0.001;
  let lo = 0;
  let hi = 1;
  for (const axis of ['x', 'y'] as const) {
    const min = r[axis] + epsilon;
    const max = r[axis] + (axis === 'x' ? r.w : r.h) - epsilon;
    if (min >= max) return false;
    const delta = p2[axis] - p1[axis];
    if (Math.abs(delta) < 1e-9) {
      if (p1[axis] <= min || p1[axis] >= max) return false;
      continue;
    }
    const a = (min - p1[axis]) / delta;
    const b = (max - p1[axis]) / delta;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo >= hi) return false;
  }
  return lo < hi && hi > 0 && lo < 1;
}

/** Find the shortest clear polyline through corners outside node boxes. This
 * path is used only after the straight and single-bend routes are blocked. */
function routedDetour(start: Point, end: Point, obstacles: BBox[]): Point[] | undefined {
  const safe = STYLE.canvas.safe;
  const withinCanvas = ({ x, y }: Point) => x >= safe && y >= safe && x <= STYLE.canvas.w - safe && y <= STYLE.canvas.h - safe;
  for (const clearance of [24, 8, 1]) {
    const candidates: Point[] = [start, end];
    for (const r of obstacles) {
      for (const x of [r.x - clearance, r.x + r.w + clearance]) {
        for (const y of [r.y - clearance, r.y + r.h + clearance]) {
          const point = { x, y };
          if (withinCanvas(point) && !obstacles.some((box) => point.x > box.x && point.x < box.x + box.w && point.y > box.y && point.y < box.y + box.h)) candidates.push(point);
        }
      }
    }
    const n = candidates.length;
    const distance = Array<number>(n).fill(Infinity);
    const parent = Array<number>(n).fill(-1);
    const visited = Array<boolean>(n).fill(false);
    distance[0] = 0;
    for (let step = 0; step < n; step++) {
      let current = -1;
      for (let i = 0; i < n; i++) if (!visited[i] && (current < 0 || distance[i] < distance[current])) current = i;
      if (current < 0 || !Number.isFinite(distance[current])) break;
      if (current === 1) {
        const path: Point[] = [];
        for (let i = current; i >= 0; i = parent[i]) path.push(candidates[i]);
        return path.reverse();
      }
      visited[current] = true;
      for (let next = 0; next < n; next++) {
        if (next === current || visited[next]) continue;
        const a = candidates[current];
        const b = candidates[next];
        if (obstacles.some((r) => segmentIntersectsRect(a, b, r))) continue;
        const candidateDistance = distance[current] + Math.hypot(b.x - a.x, b.y - a.y);
        if (candidateDistance < distance[next]) {
          distance[next] = candidateDistance;
          parent[next] = current;
        }
      }
    }
  }
  return undefined;
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
export function routeEdges(edges: Edge[], boxes: Map<string, BBox>, containerIds: ReadonlySet<string> = new Set()): RoutedEdge[] {
  const others = (fromId: string, toId: string) => [...boxes.entries()].filter(([id]) => id !== fromId && id !== toId && !containerIds.has(id)).map(([, b]) => b);
  const leafBoxes = [...boxes.entries()].filter(([id]) => !containerIds.has(id)).map(([, b]) => b);

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
    // Both bends blocked (for example, one fan-out target behind another):
    // route through clear waypoints around boxes rather than across their labels.
    const detour = routedDetour(straightStart, straightEnd, leafBoxes);
    if (detour) return { ...edge, points: inset(detour) };

    // A missing path is explicit and hard-gated by runClaudeGates. Drawing an
    // arrow through a label would misstate the board's structure.
    return { ...edge, points: [] };
  });
}

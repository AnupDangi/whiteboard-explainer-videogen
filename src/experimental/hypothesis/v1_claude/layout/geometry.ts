import type { BBox } from '../types.js';
import type { IntrinsicSize } from './measure.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectCenter = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function intersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Center a row of items horizontally within `rect`, vertically centered on `rect`'s mid-line. */
export function rowLayout(rect: Rect, sizes: IntrinsicSize[], gap: number): BBox[] {
  const totalW = sizes.reduce((s, sz) => s + sz.w, 0) + gap * Math.max(0, sizes.length - 1);
  let x = rect.x + (rect.w - totalW) / 2;
  const midY = rect.y + rect.h / 2;
  return sizes.map((sz) => {
    const box = { x, y: midY - sz.h / 2, w: sz.w, h: sz.h };
    x += sz.w + gap;
    return box;
  });
}

/** Center a column of items vertically within `rect`, horizontally centered on `rect`'s mid-line. */
export function columnLayout(rect: Rect, sizes: IntrinsicSize[], gap: number): BBox[] {
  const totalH = sizes.reduce((s, sz) => s + sz.h, 0) + gap * Math.max(0, sizes.length - 1);
  let y = rect.y + (rect.h - totalH) / 2;
  const midX = rect.x + rect.w / 2;
  return sizes.map((sz) => {
    const box = { x: midX - sz.w / 2, y, w: sz.w, h: sz.h };
    y += sz.h + gap;
    return box;
  });
}

/**
 * Place items evenly around a circle centered in `rect`, starting at the top
 * (12 o'clock) and proceeding clockwise. Radius grows deterministically until
 * no two placed boxes overlap and every box stays within `rect`.
 */
export function circleLayout(rect: Rect, sizes: IntrinsicSize[], opts: { center?: IntrinsicSize; minRadius?: number; radialGap?: number } = {}): { center?: BBox; ring: BBox[] } {
  const c = rectCenter(rect);
  const centerBox: BBox | undefined = opts.center
    ? { x: c.x - opts.center.w / 2, y: c.y - opts.center.h / 2, w: opts.center.w, h: opts.center.h }
    : undefined;
  if (sizes.length === 0) return { center: centerBox, ring: [] };

  // Elliptical ring matched to the frame's aspect (a 16:9 board has more room sideways than vertically).
  const aspect = Math.min(1.8, Math.max(1, rect.w / rect.h));
  const maxRadius = rect.h / 2;
  const hub = opts.center ? Math.max(opts.center.w, opts.center.h) / 2 : 0;
  const smallest = Math.min(...sizes.map((s) => Math.min(s.w, s.h)));
  // Dense variants pack the ring tighter (hub_spoke dense uses 8, mirroring
  // layered_stack dense); the default keeps the roomier reference clearance.
  let radius = Math.max(opts.minRadius ?? 0, hub + smallest / 2 + (opts.radialGap ?? 24));
  const step = 6;
  let placement: BBox[] = [];
  do {
    placement = sizes.map((sz, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / sizes.length;
      const cx = c.x + radius * aspect * Math.cos(angle);
      const cy = c.y + radius * Math.sin(angle);
      return { x: cx - sz.w / 2, y: cy - sz.h / 2, w: sz.w, h: sz.h };
    });
    const overlapping = placement.some((a, i) => placement.some((b, j) => i !== j && intersects(a, b)));
    const centerOverlap = centerBox ? placement.some((a) => intersects(a, centerBox)) : false;
    if (!overlapping && !centerOverlap) break;
    radius += step;
  } while (radius <= maxRadius * 2); // bounded; the solver's fit step keeps any result inside the working rect
  return { center: centerBox, ring: placement };
}

/**
 * Push boxes apart along `axis`, but ONLY pairs that actually overlap in the
 * perpendicular axis first — two boxes in different template bands (e.g.
 * title_card's title/subtitle/strip rows) never share a y-range, so they are
 * never candidates for x-axis separation even though a naive "sort by x and
 * enforce gaps" pass would otherwise drag them apart across unrelated bands.
 * This is what "push overlaps along the primary template axis" (S8 step 4)
 * means: overlaps, not merely adjacency.
 */
export function resolveAxisOverlap(boxes: BBox[], axis: 'x' | 'y', gap: number): BBox[] {
  const other = axis === 'x' ? 'y' : 'x';
  const dim = axis === 'x' ? 'w' : 'h';
  const otherDim = axis === 'x' ? 'h' : 'w';
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i][axis] - boxes[j][axis]);
  const out = boxes.map((b) => ({ ...b }));
  for (let k = 1; k < order.length; k++) {
    const cur = out[order[k]];
    for (let m = 0; m < k; m++) {
      const prev = out[order[m]];
      const perpendicularOverlap = cur[other] < prev[other] + prev[otherDim] && cur[other] + cur[otherDim] > prev[other];
      if (!perpendicularOverlap) continue;
      const minStart = prev[axis] + prev[dim] + gap;
      if (cur[axis] < minStart) cur[axis] = minStart;
    }
  }
  return out;
}

/** Scale every box uniformly around `pivot`. */
export function scaleAround(boxes: BBox[], pivot: { x: number; y: number }, scale: number): BBox[] {
  return boxes.map((b) => ({
    x: pivot.x + (b.x - pivot.x) * scale,
    y: pivot.y + (b.y - pivot.y) * scale,
    w: b.w * scale,
    h: b.h * scale,
  }));
}

/** Scale every box vertically around `pivotY`, keeping x/width fixed. */
export function scaleVertical(boxes: BBox[], pivotY: number, scaleY: number): BBox[] {
  return boxes.map((b) => ({
    x: b.x,
    y: pivotY + (b.y - pivotY) * scaleY,
    w: b.w,
    h: b.h * scaleY,
  }));
}

export function unionBBox(boxes: BBox[]): BBox {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Boundary point of `box` along the direction toward `toward` (never the center — edges attach to the box edge). */
export function boundaryPoint(box: BBox, toward: { x: number; y: number }): { x: number; y: number } {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = box.w / 2;
  const hh = box.h / 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

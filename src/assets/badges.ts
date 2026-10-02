import type { Badge, PrimitiveVisual } from '../shared/types.js';
import { STYLE } from '../render/style.js';
import { ellipsePath } from '../render/pathmath.js';

/**
 * Badge composition (claude_pipeline.md §10 rung 3 / hypothesis/v1_claude/01
 * §4.1): a small glyph overlaid at the top-right of a base catalog asset,
 * e.g. lock + '⚠' = security flaw, brain + '✗' = wrong model. Deterministic,
 * fixed offset — never model-chosen coordinates.
 */
export function composeBadge(base: PrimitiveVisual, badge: Badge, size: { w: number; h: number }): PrimitiveVisual {
  const r = Math.min(size.w, size.h) * 0.14;
  const cx = size.w - r * 1.1;
  const cy = r * 1.1;
  const circle = ellipsePath(cx, cy, r, r);
  return {
    paths: [...base.paths, circle],
    fills: [...base.fills, { d: circle.d, fill: STYLE.canvas.bg }],
    texts: [...base.texts, { x: cx, y: cy + r * 0.35, text: badge, size: r * 1.3, anchor: 'middle' }],
  };
}

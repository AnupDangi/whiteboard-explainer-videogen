import { z } from 'zod';
import { emptyVisual, inset, linePath, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const ComparisonParamsSchema = z.object({ sides: z.array(z.string().min(1).max(24)).min(2).max(3) }).strict();
type P = z.infer<typeof ComparisonParamsSchema>;

/** Columns that share the same dimensions, one zone per side, with a header over each. */
export const comparisonKit: KitDef<P> = {
  name: 'comparison',
  paramsSchema: ComparisonParamsSchema,
  zones: (p) => p.sides,
  preferredSize: (p) => ({ w: 380 * p.sides.length, h: 640 }),
  layout({ params, rect, zoneCapacity }) {
    const sides = params.sides;
    const colW = rect.w / sides.length;
    const header = 70;
    const frame = emptyVisual();
    sides.forEach((side, i) => frame.texts.push(textRun(rect.x + colW * i + colW / 2, rect.y + 48, side, 36)));
    frame.paths.push(linePath(rect.x + 10, rect.y + header, rect.x + rect.w - 10, rect.y + header));
    for (let i = 1; i < sides.length; i++) frame.paths.push(linePath(rect.x + colW * i, rect.y + 6, rect.x + colW * i, rect.y + rect.h - 6));
    const cols: Rect[][] = sides.map((side, i) => {
      const cap = Math.max(1, zoneCapacity[side] ?? 1);
      const area: Rect = inset({ x: rect.x + colW * i, y: rect.y + header, w: colW, h: rect.h - header }, 14);
      const h = Math.min(120, (area.h - 10 * (cap - 1)) / cap);
      return Array.from({ length: cap }, (_, j) => ({ x: area.x, y: area.y + j * (h + 10), w: area.w, h }));
    });
    return {
      frame,
      slotRect(zone, index) { const list = cols[Math.max(0, sides.indexOf(zone ?? sides[0]!))]!; return list[Math.min(index, list.length - 1)]!; },
      slotCount: (zone) => cols[Math.max(0, sides.indexOf(zone ?? sides[0]!))]!.length,
    };
  },
};

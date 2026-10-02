import { z } from 'zod';
import { emptyVisual, gridCells, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const GraphParamsSchema = z.object({ nodes: z.number().int().min(2).max(9).optional(), layout: z.enum(['ring', 'grid']).optional() }).strict();
type P = z.infer<typeof GraphParamsSchema>;
const slotsFor = (p: P, capacity: number): number => Math.min(9, Math.max(p.nodes ?? 0, capacity, 2));

/** Node slots only; the relations between nodes are connect ops drawn as arrows between the nodes that hold them. */
export const graphKit: KitDef<P> = {
  name: 'graph',
  paramsSchema: GraphParamsSchema,
  zones: () => [],
  preferredSize: (p, capacity) => ({ w: 900, h: slotsFor(p, capacity) > 4 ? 640 : 480 }),
  layout({ params, label, rect, capacity }) {
    const n = slotsFor(params, capacity);
    const labelH = label ? 54 : 0;
    const area: Rect = { x: rect.x + 10, y: rect.y + labelH, w: rect.w - 20, h: rect.h - labelH - 10 };
    let slots: Rect[];
    if (params.layout === 'grid') slots = gridCells(area, n, 150, 70);
    else {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      const size = Math.min(150, Math.min(area.w, area.h) * 0.3);
      const rx = area.w / 2 - size / 2;
      const ry = area.h / 2 - size / 2;
      slots = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return { x: cx + rx * Math.cos(a) - size / 2, y: cy + ry * Math.sin(a) - size / 2, w: size, h: size }; });
    }
    const frame = emptyVisual();
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, n - 1)]!, slotCount: () => n };
  },
};

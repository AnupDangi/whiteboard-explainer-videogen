import { z } from 'zod';
import { arrowPaths, borderPoint, center, emptyVisual, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const CycleParamsSchema = z.object({ nodes: z.number().int().min(3).max(8).optional() }).strict();
type P = z.infer<typeof CycleParamsSchema>;
const slotsFor = (p: P, capacity: number): number => Math.min(8, Math.max(p.nodes ?? 0, capacity, 3));

/** Slots around a ring, clockwise from the top, joined by arrows that close the loop. */
export const cycleKit: KitDef<P> = {
  name: 'cycle',
  paramsSchema: CycleParamsSchema,
  zones: () => [],
  preferredSize: (p, capacity) => ({ w: 640, h: 640 + (slotsFor(p, capacity) > 5 ? 60 : 0) }),
  layout({ params, label, rect, capacity }) {
    const n = slotsFor(params, capacity);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const slot = Math.min(rect.w, rect.h) * (n > 5 ? 0.2 : 0.24);
    const radius = Math.min(rect.w, rect.h) / 2 - slot / 2 - 8;
    const centers = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }; });
    const slots: Rect[] = centers.map((c) => ({ x: c.x - slot / 2, y: c.y - slot / 2, w: slot, h: slot }));
    const frame = emptyVisual();
    for (let i = 0; i < n; i++) {
      const from = slots[i]!;
      const to = slots[(i + 1) % n]!;
      const a = borderPoint(from, center(to), 12);
      const b = borderPoint(to, center(from), 14);
      frame.paths.push(...arrowPaths(a.x, a.y, b.x, b.y, 22));
    }
    if (label) frame.texts.push(textRun(cx, cy + 12, label, 32));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, n - 1)]!, slotCount: () => n };
  },
};

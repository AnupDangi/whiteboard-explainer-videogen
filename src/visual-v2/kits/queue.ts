import { z } from 'zod';
import { arrowPaths, emptyVisual, linePath, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const QueueParamsSchema = z.object({ capacity: z.number().int().min(2).max(8).optional() }).strict();
type P = z.infer<typeof QueueParamsSchema>;
const slotsFor = (p: P, capacity: number): number => Math.max(p.capacity ?? 0, capacity, 3);

/** A horizontal pipe: items enter on the left and leave on the right, ordered by slot. */
export const queueKit: KitDef<P> = {
  name: 'queue',
  paramsSchema: QueueParamsSchema,
  zones: () => [],
  preferredSize: (p, capacity) => ({ w: 140 + 150 * slotsFor(p, capacity), h: 260 }),
  layout({ params, label, rect, capacity }) {
    const n = slotsFor(params, capacity);
    const labelH = label ? 54 : 0;
    const top = rect.y + labelH + 10;
    const bottom = rect.y + rect.h - 20;
    const left = rect.x + 20;
    const right = rect.x + rect.w - 56;
    const frame = emptyVisual();
    frame.paths.push(linePath(left, top, right, top), linePath(left, bottom, right, bottom), ...arrowPaths(right - 4, (top + bottom) / 2, rect.x + rect.w - 12, (top + bottom) / 2, 20));
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    const slotW = (right - left - 12) / n;
    const slots: Rect[] = Array.from({ length: n }, (_, i) => ({ x: left + 6 + i * slotW + 4, y: top + 10, w: slotW - 8, h: bottom - top - 20 }));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, n - 1)]!, slotCount: () => n };
  },
};

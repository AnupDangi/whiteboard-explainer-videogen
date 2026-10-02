import { z } from 'zod';
import { boxPath, emptyVisual, inset, linePath, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const StackParamsSchema = z.object({ capacity: z.number().int().min(2).max(10).optional() }).strict();
type P = z.infer<typeof StackParamsSchema>;
const PAD = 22;
const slotsFor = (p: P, capacity: number): number => Math.max(p.capacity ?? 0, capacity, 3);

/** An open-topped column with an ordered list of slots from the bottom up. */
export const stackKit: KitDef<P> = {
  name: 'stack',
  paramsSchema: StackParamsSchema,
  zones: () => [],
  preferredSize: (p, capacity) => ({ w: 380, h: 120 + 92 * slotsFor(p, capacity) }),
  layout({ params, label, rect, capacity }) {
    const n = slotsFor(params, capacity);
    const labelH = label ? 54 : 0;
    const top = rect.y + 8;
    const base = rect.y + rect.h - labelH - 10;
    const left = rect.x + PAD;
    const right = rect.x + rect.w - PAD;
    const frame = emptyVisual();
    frame.paths.push(linePath(left, top, left, base), linePath(left, base, right, base), linePath(right, base, right, top));
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + rect.h - 14, label, 32));
    const slotH = (base - top - 10) / n;
    const slots: Rect[] = Array.from({ length: n }, (_, i) => ({ x: left + 12, y: base - (i + 1) * slotH + 5, w: right - left - 24, h: slotH - 10 }));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, n - 1)]!, slotCount: () => n };
  },
};
export { boxPath, inset };

import { z } from 'zod';
import { emptyVisual, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const WeightedLinksParamsSchema = z.object({ left: z.number().int().min(1).max(6), right: z.number().int().min(1).max(6), labels: z.array(z.string().min(1).max(24)).length(2).optional() }).strict();
type P = z.infer<typeof WeightedLinksParamsSchema>;

/** Two columns of slots (zones left and right); the strength of each link is the weight of a connect op between two slots. */
export const weightedLinksKit: KitDef<P> = {
  name: 'weighted-links',
  paramsSchema: WeightedLinksParamsSchema,
  zones: () => ['left', 'right'],
  preferredSize: (p) => ({ w: 900, h: 170 * Math.max(p.left, p.right) + 90 }),
  layout({ params, rect }) {
    const header = params.labels ? 64 : 10;
    const column = (count: number, x: number, w: number): Rect[] => {
      const h = Math.min(120, (rect.h - header - 20) / count - 14);
      const total = count * h + (count - 1) * 14;
      const y0 = rect.y + header + (rect.h - header - total) / 2;
      return Array.from({ length: count }, (_, i) => ({ x, y: y0 + i * (h + 14), w, h }));
    };
    const w = Math.min(230, rect.w * 0.28);
    const left = column(params.left, rect.x + 10, w);
    const right = column(params.right, rect.x + rect.w - 10 - w, w);
    const frame = emptyVisual();
    if (params.labels) { frame.texts.push(textRun(rect.x + 10 + w / 2, rect.y + 44, params.labels[0]!, 30)); frame.texts.push(textRun(rect.x + rect.w - 10 - w / 2, rect.y + 44, params.labels[1]!, 30)); }
    return { frame, slotRect: (zone, index) => { const list = zone === 'right' ? right : left; return list[Math.min(index, list.length - 1)]!; }, slotCount: (zone) => (zone === 'right' ? right : left).length };
  },
};

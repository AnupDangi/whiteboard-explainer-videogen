import { z } from 'zod';
import { boxPath, emptyVisual, inset, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const ArrayParamsSchema = z.object({ length: z.number().int().min(2).max(12), indexed: z.boolean().optional() }).strict();
type P = z.infer<typeof ArrayParamsSchema>;

/** A row of numbered cells; a child's `slot` number is the cell it sits in. */
export const arrayKit: KitDef<P> = {
  name: 'array',
  paramsSchema: ArrayParamsSchema,
  zones: () => [],
  preferredSize: (p) => ({ w: 40 + 130 * p.length, h: 250 }),
  layout({ params, label, rect }) {
    const n = params.length;
    const labelH = label ? 54 : 0;
    const cellSize = Math.min((rect.w - 40) / n, rect.h - labelH - (params.indexed === false ? 20 : 70), 150 * Math.max(1, Math.min(2, rect.w / (40 + 130 * n))));
    const x0 = rect.x + (rect.w - cellSize * n) / 2;
    const y0 = rect.y + labelH + (rect.h - labelH - cellSize - (params.indexed === false ? 0 : 50)) / 2;
    const frame = emptyVisual();
    const cells: Rect[] = Array.from({ length: n }, (_, i) => ({ x: x0 + i * cellSize, y: y0, w: cellSize, h: cellSize }));
    for (const [i, cell] of cells.entries()) {
      frame.paths.push(boxPath(cell, 6));
      if (params.indexed !== false) frame.texts.push(textRun(cell.x + cell.w / 2, cell.y + cell.h + 38, String(i), 32));
    }
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    return { frame, slotRect: (_zone, index) => inset(cells[Math.min(index, n - 1)]!, 6), slotCount: () => n };
  },
};

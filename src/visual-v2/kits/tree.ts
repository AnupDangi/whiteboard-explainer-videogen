import { z } from 'zod';
import { emptyVisual, linePath, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const TreeParamsSchema = z.object({ shape: z.array(z.number().int().min(1).max(8)).min(2).max(4).optional() }).strict();
type P = z.infer<typeof TreeParamsSchema>;
const shapeOf = (p: P): number[] => p.shape ?? [1, 2, 4];

/** Level-order slots: `shape` is the node count per level, the kit draws the parent links. */
export const treeKit: KitDef<P> = {
  name: 'tree',
  paramsSchema: TreeParamsSchema,
  zones: () => [],
  preferredSize: (p) => ({ w: 140 * Math.max(...shapeOf(p)) + 120, h: 190 * shapeOf(p).length + 60 }),
  layout({ params, label, rect }) {
    const shape = shapeOf(params);
    const labelH = label ? 54 : 0;
    const levelH = (rect.h - labelH - 10) / shape.length;
    const size = Math.min(130, levelH - 40, (rect.w - 20) / Math.max(...shape) - 20);
    const slots: Rect[] = [];
    const levelStart: number[] = [];
    shape.forEach((count, level) => {
      levelStart.push(slots.length);
      const colW = (rect.w - 20) / count;
      for (let j = 0; j < count; j++) slots.push({ x: rect.x + 10 + colW * j + (colW - size) / 2, y: rect.y + labelH + level * levelH + (levelH - size) / 2, w: size, h: size });
    });
    const frame = emptyVisual();
    for (let level = 1; level < shape.length; level++) for (let j = 0; j < shape[level]!; j++) {
      const child = slots[levelStart[level]! + j]!;
      const parent = slots[levelStart[level - 1]! + Math.floor((j * shape[level - 1]!) / shape[level]!)]!;
      frame.paths.push(linePath(parent.x + parent.w / 2, parent.y + parent.h, child.x + child.w / 2, child.y));
    }
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, slots.length - 1)]!, slotCount: () => slots.length };
  },
};

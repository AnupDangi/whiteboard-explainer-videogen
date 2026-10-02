import { z } from 'zod';
import { boxPath, emptyVisual, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const LayeredStackParamsSchema = z.object({ layers: z.number().int().min(2).max(8), repeat: z.number().int().min(2).max(99).optional() }).strict();
type P = z.infer<typeof LayeredStackParamsSchema>;

/** N identical layers stacked with a small offset; a child's index is its layer, from the top. */
export const layeredStackKit: KitDef<P> = {
  name: 'layered-stack',
  paramsSchema: LayeredStackParamsSchema,
  zones: () => [],
  preferredSize: (p) => ({ w: 520, h: 130 + 96 * p.layers }),
  layout({ params, label, rect }) {
    const n = params.layers;
    const labelH = label || params.repeat ? 54 : 0;
    const area: Rect = { x: rect.x + 10, y: rect.y + labelH, w: rect.w - 20, h: rect.h - labelH - 10 };
    const layerH = area.h / n;
    const frame = emptyVisual();
    const layers: Rect[] = Array.from({ length: n }, (_, i) => ({ x: area.x, y: area.y + i * layerH + 4, w: area.w, h: layerH - 8 }));
    for (const layer of layers) frame.paths.push(boxPath(layer, 14));
    const title = [label, params.repeat ? `×${params.repeat}` : undefined].filter(Boolean).join(' ');
    if (title) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, title, 32));
    return { frame, slotRect: (_zone, index) => ({ x: layers[Math.min(index, n - 1)]!.x + 10, y: layers[Math.min(index, n - 1)]!.y + 6, w: layers[0]!.w - 20, h: layers[0]!.h - 12 }), slotCount: () => n };
  },
};

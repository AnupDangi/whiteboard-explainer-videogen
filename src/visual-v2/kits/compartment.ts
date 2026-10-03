import { z } from 'zod';
import { boxPath, dashedLinePaths, emptyVisual, gridCells, inset, linePath, textRun, type Rect } from './geometry.js';
import type { KitDef } from './types.js';

export const CompartmentParamsSchema = z.object({
  zones: z.array(z.string().min(1).max(24)).min(2).max(3),
  boundary: z.enum(['solid', 'semipermeable', 'dashed']).optional(),
  orientation: z.enum(['side', 'stacked']).optional(),
  zoneLabels: z.array(z.string().min(1).max(24)).max(3).optional(),
}).strict();
type P = z.infer<typeof CompartmentParamsSchema>;

/** Zones separated by a boundary; children are packed into the zone they are placed in. */
export const compartmentKit: KitDef<P> = {
  name: 'compartment',
  paramsSchema: CompartmentParamsSchema,
  zones: (p) => p.zones,
  preferredSize: (p) => (p.orientation === 'stacked' ? { w: 700, h: 680 } : { w: 820, h: 520 }),
  layout({ params, label, rect, zoneCapacity }) {
    const zones = params.zones;
    const stacked = params.orientation === 'stacked';
    const labelH = label ? 54 : 0;
    const outer: Rect = { x: rect.x, y: rect.y + labelH, w: rect.w, h: rect.h - labelH };
    const frame = emptyVisual();
    frame.paths.push(boxPath(outer, 26));
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    const zoneRects: Rect[] = zones.map((_, i) => (stacked
      ? { x: outer.x, y: outer.y + (outer.h / zones.length) * i, w: outer.w, h: outer.h / zones.length }
      : { x: outer.x + (outer.w / zones.length) * i, y: outer.y, w: outer.w / zones.length, h: outer.h }));
    for (let i = 1; i < zones.length; i++) {
      const z = zoneRects[i]!;
      const [x1, y1, x2, y2] = stacked ? [z.x, z.y, z.x + z.w, z.y] : [z.x, z.y, z.x, z.y + z.h];
      if (params.boundary === 'solid') frame.paths.push(linePath(x1, y1, x2, y2));
      else frame.paths.push(...dashedLinePaths(x1, y1, x2, y2, params.boundary === 'dashed' ? 30 : 12, params.boundary === 'dashed' ? 18 : 22));
    }
    const heading = 46;
    zones.forEach((zone, i) => { const text = params.zoneLabels?.[i]; if (text) frame.texts.push(textRun(zoneRects[i]!.x + zoneRects[i]!.w / 2, zoneRects[i]!.y + 38, text, 28)); });
    const cells = zones.map((zone, i) => {
      const area: Rect = inset({ x: zoneRects[i]!.x, y: zoneRects[i]!.y + (params.zoneLabels?.[i] ? heading : 0), w: zoneRects[i]!.w, h: zoneRects[i]!.h - (params.zoneLabels?.[i] ? heading : 0) }, 18);
      return gridCells(area, Math.max(1, zoneCapacity[zone] ?? 1), 190, 14);
    });
    return {
      frame,
      slotRect(zone, index) {
        const z = Math.max(0, zones.indexOf(zone ?? zones[0]!));
        const list = cells[z]!;
        return list[Math.min(index, list.length - 1)]!;
      },
      slotCount: (zone) => cells[Math.max(0, zones.indexOf(zone ?? zones[0]!))]!.length,
    };
  },
};

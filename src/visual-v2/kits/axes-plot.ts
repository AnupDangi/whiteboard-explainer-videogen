import { z } from 'zod';
import { renderPrimitive } from '../../render/primitives.js';
import { shiftVisual } from './geometry.js';
import type { KitDef } from './types.js';

export const AxesPlotParamsSchema = z.object({
  fn: z.enum(['linear', 'quadratic', 'cubic', 'sine', 'exp', 'log', 'normal']),
  params: z.array(z.number()).min(1).max(4),
  domain: z.tuple([z.number(), z.number()]),
  xLabel: z.string().max(24).optional(),
  yLabel: z.string().max(24).optional(),
}).strict().refine((p) => p.domain[0] < p.domain[1], 'domain must increase');
type P = z.infer<typeof AxesPlotParamsSchema>;

/** Axes and a curve drawn by the exact plot primitive; no child slots. */
export const axesPlotKit: KitDef<P> = {
  name: 'axes-plot',
  paramsSchema: AxesPlotParamsSchema,
  zones: () => [],
  preferredSize: () => ({ w: 820, h: 560 }),
  layout({ id, params, rect }) {
    const frame = shiftVisual(renderPrimitive({ id, anchor: 'sceneStart', prim: 'plot', fn: params.fn, params: params.params, domain: params.domain, ...(params.xLabel ? { xLabel: params.xLabel } : {}), ...(params.yLabel ? { yLabel: params.yLabel } : {}) } as never, { w: rect.w, h: rect.h }), rect.x, rect.y);
    return { frame, slotRect: () => { throw new Error('axes-plot has no slots'); }, slotCount: () => 0 };
  },
};

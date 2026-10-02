import { z } from 'zod';
import { typesetTex } from '../../render/math.js';
import { emptyVisual, textRun } from './geometry.js';
import type { KitDef } from './types.js';

export const EquationParamsSchema = z.object({ latex: z.string().min(1).max(160) }).strict();
type P = z.infer<typeof EquationParamsSchema>;

/** Typeset expression, centred in its rect and fitted by its aspect ratio. Step-by-step builds use equation elements and equationStep ops. */
export const equationKit: KitDef<P> = {
  name: 'equation',
  paramsSchema: EquationParamsSchema,
  zones: () => [],
  preferredSize: (p) => { const t = typesetTex(p.latex); return t ? { w: Math.max(300, Math.min(1100, 150 * t.aspect + 80)), h: 190 } : { w: 500, h: 160 }; },
  layout({ params, rect }) {
    const typeset = typesetTex(params.latex);
    const frame = emptyVisual();
    if (typeset) {
      const w = Math.min(rect.w - 40, (rect.h - 30) * typeset.aspect);
      const h = w / typeset.aspect;
      frame.embeds = [{ x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h, viewBox: typeset.viewBox, body: typeset.body }];
    } else frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + rect.h / 2, params.latex, 40));
    return { frame, slotRect: () => { throw new Error('equation has no slots'); }, slotCount: () => 0 };
  },
};

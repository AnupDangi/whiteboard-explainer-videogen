import { STYLE } from '../../render/style.js';
import { measureTextWidth } from '../../layout/measure.js';
import type { BoardElement } from '../board-state/types.js';
import type { Rect } from '../kits/geometry.js';

export const MIN_FONT = 28;

/** The largest font up to `base` that fits `text` on one line in `width`; below MIN_FONT it stops, so `fitsWidth` decides legality. */
export function fitFont(text: string, width: number, base: number = STYLE.font.sizes.body): number {
  const natural = measureTextWidth(text, base);
  return natural <= width ? base : Math.max(MIN_FONT, Math.floor((base * width) / natural));
}

/** True when `text` fits on one line in `width` at the size `fitFont` picks. */
export const fitsWidth = (text: string, width: number, base: number = STYLE.font.sizes.body): boolean => measureTextWidth(text, fitFont(text, width, base)) <= width + 0.5;

/** The text each element kind draws and the width it is drawn in; mirrors the renderer's slot rules. */
export function textSlot(el: BoardElement, rect: Rect): { text: string; width: number; base: number } | undefined {
  const spec = el.spec;
  switch (spec.type) {
    case 'token': return { text: spec.text, width: rect.w - 24, base: STYLE.font.sizes.body };
    case 'entity': return { text: spec.label, width: rect.w - 24, base: STYLE.font.sizes.body };
    case 'value': return { text: `${spec.label}: ${String(el.value ?? spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`, width: rect.w - 40, base: STYLE.font.sizes.body };
    case 'text': return { text: spec.text, width: rect.w, base: spec.role === 'title' ? STYLE.font.sizes.title : spec.role === 'label' ? STYLE.font.sizes.label : 30 };
    default: return undefined;
  }
}

/** Text that cannot fit its slot even at the smallest legal font. */
export function textOverflow(el: BoardElement, rect: Rect): string | undefined {
  const slot = textSlot(el, rect);
  return slot && !fitsWidth(slot.text, slot.width, slot.base) ? slot.text : undefined;
}

import { STYLE } from '../../render/style.js';
import { measureTextWidth } from '../../layout/measure.js';
import type { BoardElement } from '../board-state/types.js';
import type { Rect } from '../kits/geometry.js';

export const MIN_FONT = 24;

/** The largest font up to `base` that fits `text` on one line in `width`; below MIN_FONT it stops, so `fitsWidth` decides legality. */
export function fitFont(text: string, width: number, base: number = STYLE.font.sizes.body): number {
  const natural = measureTextWidth(text, base);
  return natural <= width ? base : Math.max(MIN_FONT, Math.floor((base * width) / natural));
}

export interface FittedText { size: number; lines: string[]; fits: boolean }
const LINE_HEIGHT = 1.15;

/** Greedy word wrap at `size`; a single word wider than the line stays on its own line and the caller sees it does not fit. */
function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const current = lines[lines.length - 1];
    if (current !== undefined && measureTextWidth(`${current} ${word}`, size) <= width) lines[lines.length - 1] = `${current} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/**
 * Fit a label into a slot: one line at the largest size that fits; otherwise the largest size at which the words wrap into up to
 * three lines inside the slot's height. `fits` is false only when even the smallest legal font cannot hold it.
 */
export function fitText(text: string, width: number, height: number, base: number = STYLE.font.sizes.body): FittedText {
  const single = fitFont(text, width, base);
  if (measureTextWidth(text, single) <= width + 0.5) return { size: single, lines: [text], fits: true };
  if (/\s/.test(text.trim())) {
    for (let size = base; size >= MIN_FONT; size -= 2) {
      const lines = wrap(text, width, size);
      if (lines.length >= 2 && lines.length <= 3 && lines.length * size * LINE_HEIGHT <= height && lines.every((line) => measureTextWidth(line, size) <= width + 0.5)) return { size, lines, fits: true };
    }
  }
  return { size: single, lines: [text], fits: false };
}

/** Where each wrapped line is drawn: centred as a block on (cx, cy). */
export function lineBaselines(cy: number, fitted: FittedText): number[] {
  return fitted.lines.map((_, i) => cy + (i - (fitted.lines.length - 1) / 2) * fitted.size * LINE_HEIGHT + fitted.size * 0.35);
}

/** True when `text` fits on one line in `width` at the size `fitFont` picks. */
export const fitsWidth = (text: string, width: number, base: number = STYLE.font.sizes.body): boolean => measureTextWidth(text, fitFont(text, width, base)) <= width + 0.5;

/** The text each element kind draws and the width it is drawn in; mirrors the renderer's slot rules. */
export function textSlot(el: BoardElement, rect: Rect): { text: string; width: number; height: number; base: number } | undefined {
  const spec = el.spec;
  switch (spec.type) {
    case 'token': return { text: spec.text, width: rect.w - 16, height: rect.h - 8, base: STYLE.font.sizes.body };
    case 'entity': return { text: spec.label, width: rect.w - 16, height: rect.h - 8, base: STYLE.font.sizes.body };
    case 'value': return { text: `${spec.label}: ${String(el.value ?? spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`, width: rect.w - 40, height: rect.h - 8, base: STYLE.font.sizes.body };
    case 'text': return { text: spec.text, width: rect.w, height: rect.h, base: spec.role === 'title' ? STYLE.font.sizes.title : spec.role === 'label' ? STYLE.font.sizes.label : 30 };
    default: return undefined;
  }
}

/** Text that cannot fit its slot even at the smallest legal font. */
export function textOverflow(el: BoardElement, rect: Rect): string | undefined {
  const slot = textSlot(el, rect);
  return slot && !fitText(slot.text, slot.width, slot.height, slot.base).fits ? slot.text : undefined;
}

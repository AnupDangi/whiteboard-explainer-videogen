import { labelBlockHeight, labelLines } from '../catalog/ladder.js';
import { Resvg } from '@resvg/resvg-js';
import type { Element } from '../types.js';
import { STYLE } from '../style.js';
import { RESVG_FONT_OPTIONS } from '../render/fonts.js';
import { escapeXml } from '../../shared/svg.js';
import { formulaSource, formulaTex, typesetTex } from '../render/math.js';

/**
 * Measure the rendered glyph ink with the same resvg text engine used by MP4
 * export. This is a visual bounding width, not an OpenType advance width; the
 * caller adds layout padding so side bearings and letter spacing do not cause
 * collisions. Using the actual renderer avoids assuming every glyph has the
 * same width (which is especially wrong for strings such as "iiii" and
 * "WWWW").
 */
const textWidthCache = new Map<string, number>();
const TEXT_MARGIN = 32;
const MAX_TEXT_CODEPOINTS = 512;
export const LINE_H: Record<'title' | 'body' | 'note', number> = { title: 76, body: 52, note: 38 };

const displayText = (text: string, uppercase: boolean): string =>
  (uppercase ? text.toUpperCase() : text).replace(/\s+/g, ' ').trim();

export function measureTextWidth(text: string, fontSize: number, uppercase: boolean = STYLE.font.uppercaseLabels): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error(`invalid text font size ${fontSize}`);
  const value = displayText(text, uppercase);
  if (!value) return 0;
  const codepoints = [...value].length;
  if (codepoints > MAX_TEXT_CODEPOINTS) throw new Error(`text exceeds ${MAX_TEXT_CODEPOINTS} codepoints and cannot be measured safely`);

  const key = `${STYLE.font.family}\0${STYLE.font.weight}\0${fontSize}\0${uppercase}\0${value}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;

  // Two em per codepoint is a deliberately generous viewBox bound, not the
  // measured width. The glyph extents come from resvg's text layout below.
  const width = Math.max(256, Math.ceil(codepoints * fontSize * 2 + TEXT_MARGIN * 2));
  const height = Math.ceil(fontSize * 3 + TEXT_MARGIN * 2);
  const baseline = TEXT_MARGIN + fontSize * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="${TEXT_MARGIN}" y="${baseline}" font-family="${escapeXml(STYLE.font.family)}" font-weight="${STYLE.font.weight}" font-size="${fontSize}">${escapeXml(value)}</text></svg>`;
  const bounds = new Resvg(svg, RESVG_FONT_OPTIONS).getBBox();
  if (!bounds) {
    textWidthCache.set(key, 0);
    return 0;
  }
  // Round-bodied glyphs (e.g. "3", "6", "8") legitimately overshoot their pen
  // origin by a small optical amount; scale the clipping tolerance with font
  // size so a single short glyph (as box-label wrapping now measures on its
  // own line) isn't mistaken for real viewport clipping.
  const overshoot = Math.max(1, fontSize * 0.05);
  if (bounds.x < TEXT_MARGIN - overshoot || bounds.x + bounds.width > width - TEXT_MARGIN + overshoot || bounds.y < 0 || bounds.y + bounds.height > height) {
    throw new Error(`text measurement viewport clipped a ${codepoints}-codepoint label`);
  }
  const measured = Math.ceil(bounds.width);
  textWidthCache.set(key, measured);
  return measured;
}

/** A box label stays on one line unless its padded single-line width would exceed this. */
export const BOX_MAX_ONE_LINE_W = 420;
const BOX_TEXT_PAD = 40;

/**
 * The single wrap decision shared by layout sizing and rendering: one line
 * when it fits BOX_MAX_ONE_LINE_W, otherwise at most two balanced lines
 * (catalog/ladder.ts's labelLines, the same split used for icon labels).
 * Short labels ("RED CELL") no longer grow a second line, which kept dense
 * boards from fitting at readable size.
 */
export function boxLabelLines(text: string, fontSize: number): string[] {
  if (!text.trim()) return [];
  return measureTextWidth(text, fontSize) + BOX_TEXT_PAD > BOX_MAX_ONE_LINE_W ? labelLines(text) : [text];
}

export interface IntrinsicSize {
  w: number;
  h: number;
}

export function measureElement(el: Element): IntrinsicSize {
  const pad = BOX_TEXT_PAD;
  const body = STYLE.font.sizes.body;
  const label = STYLE.font.sizes.label;
  const note = STYLE.font.sizes.note;
  switch (el.prim) {
    case 'box': {
      // Wraps only when one line is too wide (boxLabelLines); the box grows by one
      // line height only when it actually wraps, and never shrinks font below `body`.
      const lines = boxLabelLines(el.text ?? el.glyph ?? el.label ?? '', body);
      const lineWidths = lines.map((line) => measureTextWidth(line, body));
      const w = Math.max(STYLE.element.boxMinW, Math.max(0, ...lineWidths) + pad);
      const h = STYLE.element.boxMinH + (lines.length > 1 ? LINE_H.body : 0);
      return { w, h };
    }
    case 'pill':
      return { w: Math.max(140, measureTextWidth(el.text, body) + pad), h: 84 };
    case 'tokenStrip': {
      const gap = 20;
      const tokenWidths = el.tokens.map((token) => Math.max(80, measureTextWidth(token, label) + 24));
      return { w: tokenWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, tokenWidths.length - 1) * gap, h: 96 };
    }
    case 'operator':
      return el.symbol === 'softmax' ? { w: Math.max(220, measureTextWidth('SOFTMAX', body) + pad), h: 96 } : { w: 110, h: 110 };
    case 'meter': {
      const gap = 20;
      const barW = Math.max(64, ...(el.labels ?? []).map((text) => measureTextWidth(text, note) + 16));
      return { w: el.values.length * barW + Math.max(0, el.values.length - 1) * gap, h: 220 };
    }
    case 'matrix': {
      const cols = Math.max(...el.rows.map((r) => r.length));
      const cellW = Math.max(90, ...el.rows.flat().map((text) => measureTextWidth(text, note, false) + 16));
      return { w: cols * cellW + 24, h: el.rows.length * 64 + 24 };
    }
    case 'formula': {
      const tex = typesetTex(formulaTex(el));
      if (!tex) return { w: Math.max(220, measureTextWidth(formulaSource(el), body, false) + pad), h: 120 };
      return { w: Math.max(120, Math.round(120 * tex.aspect)), h: 120 };
    }
    case 'container': {
      // A container's footprint is decided by the solver once children are
      // placed inside it; give a sane minimum for measurement/overlap passes.
      return { w: 260 + el.children.length * 40, h: 220 };
    }
    case 'cylinder':
      return { w: 180, h: 200 };
    case 'stack':
      return { w: 220, h: 90 + el.count * 22 };
    case 'axis':
      return { w: 480, h: 320 };
    case 'hill':
      return { w: 480, h: 260 };
    case 'object': {
      // Icon square + uppercase label underneath (catalog/ladder.ts OBJECT_LABEL_H).
      const objectLabel = el.label ?? el.concept;
      const icon = STYLE.element.objectSize[0];
      const lines = labelLines(objectLabel);
      return { w: Math.max(icon, ...lines.map((line) => measureTextWidth(line, label) + 24)), h: icon + labelBlockHeight(objectLabel) };
    }
    case 'text':
      return { w: measureTextWidth(el.text, STYLE.font.sizes[el.size]) + pad, h: LINE_H[el.size] };
    case 'plot':
      return { w: 640, h: 420 };
    case 'numberLine':
      return { w: 760, h: 170 };
    case 'shape':
      return el.kind === 'rightTriangle' || el.kind === 'triangle' ? { w: 360, h: 300 } : el.kind === 'rectangle' ? { w: 320, h: 220 } : { w: 260, h: 260 };
    default: {
      const _exhaustive: never = el;
      throw new Error(`unhandled primitive ${JSON.stringify(_exhaustive)}`);
    }
  }
}

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { STYLE } from '../style.js';
import { partGroupId } from './mathIds.js';
export { partGroupId } from './mathIds.js';

/**
 * Offline TeX -> SVG typesetting for the `formula` primitive (hypothesis/v1_claude/04
 * spike S-4). Adapter ported from the retired ChatGPT track's `math.ts`, made
 * synchronous so `renderPrimitive` stays a pure, sync function.
 *
 * `fontCache: 'none'` inlines every glyph as a plain `<path>` (no `<use>`/`<defs>`
 * ids), so the output is self-contained and byte-identical for identical input.
 */
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

export interface TypesetFormula {
  /** Inner markup of MathJax's `<svg>` (glyph paths), colored with the global ink. */
  body: string;
  viewBox: string;
  /** width / height of the typeset expression. */
  aspect: number;
}

/** Full TeX for a formula element: `latex` as-is, or its `parts` each wrapped in a \\cssId group. */
export function formulaTex(el: { id: string; latex?: string; parts?: Array<{ tex: string }> }): string {
  if (el.parts?.length) return el.parts.map((p, i) => `\\cssId{${partGroupId(el.id, i)}}{${p.tex}}`).join(' ');
  return el.latex ?? '';
}

/** Human-readable source (no \\cssId wrappers), for fallbacks and messages. */
export const formulaSource = (el: { latex?: string; parts?: Array<{ tex: string }> }): string => el.parts?.map((p) => p.tex).join(' ') ?? el.latex ?? '';

const cache = new Map<string, TypesetFormula | null>();

/**
 * Returns `null` when MathJax reports a TeX error, so the caller can fall back to
 * showing the literal source instead of rendering an error glyph.
 */
export function typesetTex(latex: string): TypesetFormula | null {
  if (cache.has(latex)) return cache.get(latex)!;
  let result: TypesetFormula | null = null;
  const html = adaptor.outerHTML(mathDocument.convert(latex, { display: true }));
  const svg = html.match(/<svg[\s\S]*<\/svg>/)?.[0];
  const viewBox = svg?.match(/viewBox="([^"]+)"/)?.[1];
  if (svg && viewBox && !/data-mjx-error|merror/.test(svg)) {
    const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
    const body = svg
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '')
      .replace(/currentColor/g, STYLE.stroke.color)
      .replace(/<title>[\s\S]*?<\/title>/g, '');
    result = { body, viewBox, aspect: vw / Math.max(1e-6, vh) };
  }
  cache.set(latex, result);
  return result;
}

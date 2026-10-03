import { load } from 'cheerio';
import type { Element } from 'domhandler';
import svgpath from 'svgpath';

/**
 * Deterministic SVG flattening for icon ingest. Real-world icon packs arrive in dialects the strict ingest subset
 * rejects (transforms, CSS classes, style="" attributes, gradients, non-zero viewBox origins, stray <title>/<desc>).
 * This pass bakes all of that into plain `<path fill stroke stroke-width fill-rule>` elements in a 0-origin viewBox,
 * so the strict subset parser downstream sees one canonical form. Pure arithmetic and attribute resolution only:
 * no semantics, no network. Anything it cannot represent faithfully (clip-path, mask, filter, <use>, <text>,
 * <image>, nested <svg>) is still rejected, never approximated.
 */
export const MAX_FLATTEN_PATHS = 40;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const isIdentity = (m: Matrix): boolean => m.every((value, index) => Math.abs(value - IDENTITY[index]) < 1e-9);
const r3 = (value: number): string => String(Math.round(value * 1000) / 1000);
const num = (value: string | undefined, fallback = 0): number => (value === undefined || value.trim() === '' ? fallback : Number.parseFloat(value));

/** Shape element -> path data (shared with the strict ingest parser). */
export function shapeToPath(tag: string, attrs: Record<string, string>): string | undefined {
  switch (tag.toLowerCase()) {
    case 'path': return attrs.d;
    case 'circle': {
      const cx = num(attrs.cx), cy = num(attrs.cy), r = num(attrs.r);
      return `M${r3(cx - r)} ${r3(cy)}a${r3(r)} ${r3(r)} 0 1 0 ${r3(2 * r)} 0a${r3(r)} ${r3(r)} 0 1 0 ${r3(-2 * r)} 0z`;
    }
    case 'ellipse': {
      const cx = num(attrs.cx), cy = num(attrs.cy), rx = num(attrs.rx), ry = num(attrs.ry);
      return `M${r3(cx - rx)} ${r3(cy)}a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(2 * rx)} 0a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(-2 * rx)} 0z`;
    }
    case 'rect': {
      const x = num(attrs.x), y = num(attrs.y), width = num(attrs.width), height = num(attrs.height);
      const rx = Math.min(num(attrs.rx, num(attrs.ry)), width / 2);
      const ry = Math.min(num(attrs.ry, num(attrs.rx)), height / 2);
      if (!rx && !ry) return `M${r3(x)} ${r3(y)}h${r3(width)}v${r3(height)}h${r3(-width)}z`;
      return `M${r3(x + rx)} ${r3(y)}h${r3(width - 2 * rx)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(ry)}v${r3(height - 2 * ry)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(ry)}h${r3(-(width - 2 * rx))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(-ry)}v${r3(-(height - 2 * ry))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(-ry)}z`;
    }
    case 'line': return `M${r3(num(attrs.x1))} ${r3(num(attrs.y1))}L${r3(num(attrs.x2))} ${r3(num(attrs.y2))}`;
    case 'polyline':
    case 'polygon': {
      const points = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (points.length < 4 || points.length % 2 !== 0 || points.some((point) => !Number.isFinite(point))) return undefined;
      let d = `M${r3(points[0])} ${r3(points[1])}`;
      for (let i = 2; i + 1 < points.length; i += 2) d += `L${r3(points[i])} ${r3(points[i + 1])}`;
      return tag.toLowerCase() === 'polygon' ? `${d}z` : d;
    }
    default: return undefined;
  }
}

function parseTransform(value: string | undefined): Matrix | undefined {
  if (!value || !value.trim()) return IDENTITY;
  let matrix = IDENTITY;
  let consumed = 0;
  const pattern = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    consumed = pattern.lastIndex;
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((arg) => !Number.isFinite(arg))) return undefined;
    let next: Matrix | undefined;
    switch (match[1]) {
      case 'matrix': next = args.length === 6 ? args as Matrix : undefined; break;
      case 'translate': next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]; break;
      case 'scale': next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const angle = ((args[0] ?? 0) * Math.PI) / 180;
        const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
        const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
        next = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX': next = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': next = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: next = undefined;
    }
    if (!next) return undefined;
    matrix = multiply(matrix, next);
  }
  return consumed >= value.trimEnd().length ? matrix : undefined;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', gray: '#808080', grey: '#808080', cyan: '#00ffff', magenta: '#ff00ff',
  silver: '#c0c0c0', gold: '#ffd700', navy: '#000080', teal: '#008080', maroon: '#800000', lime: '#00ff00',
};

/** Normalise a paint value to what the strict parser understands: `none`, `currentColor`, `url(...)`, or #hex. */
function normalizePaint(value: string): string {
  const paint = value.trim();
  const lower = paint.toLowerCase();
  if (lower === 'transparent') return 'none';
  if (lower in NAMED) return NAMED[lower];
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/i.exec(paint);
  if (rgb) {
    const channel = (part: string): number => Math.max(0, Math.min(255, Math.round(part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part))));
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => channel(part).toString(16).padStart(2, '0')).join('')}`;
  }
  return paint;
}

const CSS_PROPS = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'display', 'visibility', 'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'stop-color']);
const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'display', 'visibility', 'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'stop-color'];

function parseDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    if (CSS_PROPS.has(key)) out[key] = declaration.slice(colon + 1).replace(/!important/i, '').trim();
  }
  return out;
}

interface CssRule { selector: string; declarations: Record<string, string> }

function parseStyleSheet(text: string): CssRule[] {
  const rules: CssRule[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  for (const block of clean.split('}')) {
    const brace = block.indexOf('{');
    if (brace < 0 || block.includes('@')) continue;
    const declarations = parseDeclarations(block.slice(brace + 1));
    for (const selector of block.slice(0, brace).split(',')) {
      const trimmed = selector.trim();
      if (trimmed) rules.push({ selector: trimmed, declarations });
    }
  }
  return rules;
}

function selectorMatches(selector: string, element: Element): boolean {
  if (selector === '*') return true;
  const parsed = /^([a-z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/i.exec(selector);
  if (!parsed) return false;
  const [, tag, cls, id] = parsed;
  if (tag && tag.toLowerCase() !== element.name.toLowerCase()) return false;
  if (cls && !(element.attribs.class ?? '').split(/\s+/).includes(cls)) return false;
  if (id && element.attribs.id !== id) return false;
  return Boolean(tag || cls || id);
}

const UNSUPPORTED_RENDERED = new Set(['use', 'image', 'text', 'tspan', 'foreignobject', 'mask', 'clippath', 'pattern', 'filter', 'switch', 'marker', 'symbol']);
const SKIPPED_CONTAINERS = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'script', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern', 'filter', 'symbol', 'marker', 'sodipodi:namedview']);
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);

interface Painted { d: string; fill: string; stroke: string; strokeWidth: number; fillRule: string }

export function flattenSvg(source: string): { ok: true; svg: string } | { ok: false; reason: string } {
  const $ = load(source, { xmlMode: true });
  const root = $('svg').first().get(0) as Element | undefined;
  if (!root) return { ok: false, reason: 'no-viewbox: missing <svg> root' };
  if ($('svg').length > 1) return { ok: false, reason: 'unsupported-element: nested <svg>' };

  const rules = $('style').toArray().flatMap((node) => parseStyleSheet($(node).text()));
  const byId = new Map<string, Element>();
  $('[id]').each((_, node) => { byId.set((node as Element).attribs.id, node as Element); });

  const resolved = (element: Element): Record<string, string> => {
    const props: Record<string, string> = {};
    for (const key of PRESENTATION) if (element.attribs[key] !== undefined) props[key] = element.attribs[key];
    for (const rule of rules) if (selectorMatches(rule.selector, element)) Object.assign(props, rule.declarations);
    if (element.attribs.style) Object.assign(props, parseDeclarations(element.attribs.style));
    return props;
  };

  const gradientColor = (reference: string, depth = 0): string | undefined => {
    const id = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(reference.trim())?.[1];
    const gradient = id ? byId.get(id) : undefined;
    if (!gradient || depth > 4 || !/gradient$/i.test(gradient.name)) return undefined;
    const stops = $(gradient).children('stop').toArray() as Element[];
    if (!stops.length) {
      const href = gradient.attribs.href ?? gradient.attribs['xlink:href'];
      return href?.startsWith('#') ? gradientColor(`url(${href})`, depth + 1) : undefined;
    }
    const stop = stops[Math.floor((stops.length - 1) / 2)];
    const props = resolved(stop);
    return props['stop-color'] ? normalizePaint(props['stop-color']) : undefined;
  };

  // Root viewBox -> 0-origin box. Missing viewBox falls back to numeric width/height.
  const box = (root.attribs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  let [x0, y0, w, h] = box.length === 4 && box.every(Number.isFinite) ? box : [0, 0, num(root.attribs.width, NaN), num(root.attribs.height, NaN)];
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { ok: false, reason: 'no-viewbox: a numeric viewBox is required' };
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) { x0 = 0; y0 = 0; }

  /** A clip-path whose only content is one rect spanning the whole icon frame clips nothing and can be dropped. */
  const clipCoversFrame = (reference: string): boolean => {
    const id = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(reference.trim())?.[1];
    const clipPath = id ? byId.get(id) : undefined;
    const children = clipPath ? ($(clipPath).children().toArray() as Element[]) : [];
    if (!clipPath || clipPath.name.toLowerCase() !== 'clippath' || children.length !== 1 || children[0].name.toLowerCase() !== 'rect' || children[0].attribs.transform) return false;
    const rect = children[0].attribs;
    const [rx, ry] = [num(rect.x), num(rect.y)];
    return rx <= x0 + 1e-6 && ry <= y0 + 1e-6 && rx + num(rect.width) >= x0 + w - 1e-6 && ry + num(rect.height) >= y0 + h - 1e-6;
  };

  const painted: Painted[] = [];
  let failure: string | undefined;

  const walk = (element: Element, inherited: Record<string, string>, matrix: Matrix): void => {
    if (failure) return;
    const tag = element.name.toLowerCase();
    if (SKIPPED_CONTAINERS.has(tag) && element !== root) return;
    if (UNSUPPORTED_RENDERED.has(tag)) { failure = `unsupported-element: <${element.name}>`; return; }
    const own = resolved(element);
    if (own.display === 'none' || own.visibility === 'hidden' || own.visibility === 'collapse') return;
    const clip = element.attribs['clip-path'];
    if ((clip && !clipCoversFrame(clip)) || element.attribs.mask || element.attribs.filter) { failure = `unsupported-element: ${clip && !clipCoversFrame(clip) ? 'clip-path' : element.attribs.mask ? 'mask' : 'filter'}`; return; }
    const local = parseTransform(element.attribs.transform);
    if (!local) { failure = 'transform: unparsable transform'; return; }
    const next = multiply(matrix, local);
    const props: Record<string, string> = { ...inherited };
    for (const key of ['fill', 'stroke', 'stroke-width', 'fill-rule', 'color', 'fill-opacity', 'stroke-opacity']) if (own[key] !== undefined) props[key] = own[key];

    if (SHAPES.has(tag)) {
      const d0 = shapeToPath(tag, element.attribs);
      if (!d0) { failure = `bad-geometry: <${element.name}>`; return; }
      let d: string;
      try {
        d = isIdentity(next) ? d0 : svgpath(d0).matrix(next).abs().round(3).toString();
      } catch { failure = `bad-geometry: <${element.name}>`; return; }
      let fill = normalizePaint(props.fill ?? '#000000');
      let stroke = normalizePaint(props.stroke ?? 'none');
      if (/^url\(/i.test(fill)) fill = gradientColor(fill) ?? fill;
      if (/^url\(/i.test(stroke)) stroke = gradientColor(stroke) ?? stroke;
      if (fill.toLowerCase() === 'currentcolor' && props.color) fill = normalizePaint(props.color);
      if (stroke.toLowerCase() === 'currentcolor' && props.color) stroke = normalizePaint(props.color);
      if (num(props['fill-opacity'], 1) === 0 || num(own.opacity, 1) === 0) fill = 'none';
      if (num(props['stroke-opacity'], 1) === 0 || num(own.opacity, 1) === 0) stroke = 'none';
      const scale = Math.sqrt(Math.abs(next[0] * next[3] - next[1] * next[2])) || 1;
      painted.push({ d, fill, stroke, strokeWidth: Math.round(num(props['stroke-width'], 1) * scale * 1000) / 1000, fillRule: props['fill-rule'] ?? 'nonzero' });
      return;
    }
    for (const child of element.children) if (child.type === 'tag') walk(child as Element, props, next);
  };

  walk(root, {}, [1, 0, 0, 1, -x0, -y0]);
  if (failure) return { ok: false, reason: failure };

  // Over the path budget: merge neighbouring paths that paint identically (visually equivalent for fills/strokes).
  let items = painted;
  if (items.length > MAX_FLATTEN_PATHS) {
    const merged: Painted[] = [];
    for (const item of items) {
      const last = merged[merged.length - 1];
      if (last && last.fill === item.fill && last.stroke === item.stroke && last.strokeWidth === item.strokeWidth && last.fillRule === item.fillRule) last.d = `${last.d}${item.d}`;
      else merged.push({ ...item });
    }
    items = merged;
  }

  const body = items.map((item) => {
    const stroke = item.stroke.toLowerCase() === 'none' ? '' : ` stroke="${item.stroke}" stroke-width="${item.strokeWidth}"`;
    const rule = item.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
    return `<path d="${item.d}" fill="${item.fill}"${stroke}${rule}/>`;
  }).join('');
  return { ok: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(w)} ${r3(h)}">${body}</svg>` };
}

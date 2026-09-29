import { createHash } from 'node:crypto';
import { svgPathProperties } from 'svg-path-properties';
import { LICENSE_ALLOWLIST } from './normalize.js';

/** Offline deterministic SVG ingest into the house raw catalog format. */
export const MAX_ICON_PATHS = 40;

export interface IconLibraryManifest {
  schemaVersion: 'icon-library-manifest/v1';
  libraryId: string;
  version: string;
  license: string;
  attribution: string;
  icons: Array<{ file: string; names: string[]; tags?: string[]; meaning?: string; category?: string }>;
}

export interface LibraryRawEntry {
  id: string;
  set: string;
  name: string;
  tags: string[];
  category: string | null;
  vb: { w: number; h: number };
  /** `color` is set only on designed detail strokes; ink outline strokes omit it. */
  strokes: Array<{ d: string; len: number; w: number; color?: string }>;
  /** `color` keeps an icon's own designed body colour (lowercase #rrggbb) for `main` fills. */
  fills: Array<{ d: string; role: 'main' | 'white' | 'ink'; rule?: 'evenodd'; color?: string }>;
  license: string;
  contentHash: string;
}

export interface LibraryCatalog {
  schemaVersion: 'claude-catalog/v2';
  libraryId: string;
  version: string;
  license: string;
  attribution: string;
  entries: LibraryRawEntry[];
}

const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const FORBIDDEN_TAGS = new Set(['use', 'defs', 'image', 'text', 'style', 'script', 'mask', 'clippath', 'lineargradient', 'radialgradient', 'pattern', 'foreignobject']);
const SHAPE_TAGS = /<(\/?)\s*(svg|g|path|circle|ellipse|rect|line|polyline|polygon)\b((?:\s[^>]*?)?)\s*(\/?)>/gi;
const ATTR = /([a-zA-Z:-]+)="([^"]*)"/g;
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-rule'];
const attrMap = (source: string): Record<string, string> => Object.fromEntries([...source.matchAll(ATTR)].map((match) => [match[1], match[2]]));
const number = (value: string | undefined, fallback = 0): number => value === undefined || value === '' ? fallback : Number(value);
const r3 = (value: number): string => String(Math.round(value * 1000) / 1000);

function unsupportedTag(svg: string): string | undefined {
  for (const match of svg.matchAll(/<\s*([a-z][\w:-]*)\b/gi)) {
    const tag = match[1];
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return tag;
    if (FORBIDDEN_TAGS.has(tag.toLowerCase())) return tag;
  }
  return undefined;
}

function shapeToPath(tag: string, attrs: Record<string, string>): string | undefined {
  switch (tag.toLowerCase()) {
    case 'path': return attrs.d;
    case 'circle': {
      const cx = number(attrs.cx), cy = number(attrs.cy), r = number(attrs.r);
      return `M${r3(cx - r)} ${r3(cy)}a${r3(r)} ${r3(r)} 0 1 0 ${r3(2 * r)} 0a${r3(r)} ${r3(r)} 0 1 0 ${r3(-2 * r)} 0z`;
    }
    case 'ellipse': {
      const cx = number(attrs.cx), cy = number(attrs.cy), rx = number(attrs.rx), ry = number(attrs.ry);
      return `M${r3(cx - rx)} ${r3(cy)}a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(2 * rx)} 0a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(-2 * rx)} 0z`;
    }
    case 'rect': {
      const x = number(attrs.x), y = number(attrs.y), width = number(attrs.width), height = number(attrs.height);
      const rx = Math.min(number(attrs.rx, number(attrs.ry)), width / 2);
      const ry = Math.min(number(attrs.ry, number(attrs.rx)), height / 2);
      if (!rx && !ry) return `M${r3(x)} ${r3(y)}h${r3(width)}v${r3(height)}h${r3(-width)}z`;
      return `M${r3(x + rx)} ${r3(y)}h${r3(width - 2 * rx)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(ry)}v${r3(height - 2 * ry)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(ry)}h${r3(-(width - 2 * rx))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(-ry)}v${r3(-(height - 2 * ry))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(-ry)}z`;
    }
    case 'line': return `M${r3(number(attrs.x1))} ${r3(number(attrs.y1))}L${r3(number(attrs.x2))} ${r3(number(attrs.y2))}`;
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

/** `var(--token, #hex)` resolves to its literal fallback, which is the designed colour. */
export function resolvePaint(value: string): string {
  const match = /^var\(\s*--[a-z0-9-]+\s*,\s*(#[0-9a-f]{3,8})\s*\)$/i.exec(value.trim());
  return match ? match[1] : value.trim();
}

/** Lowercase #rrggbb for a 3- or 6-digit hex colour; undefined for anything else. */
export function hexColor(value: string): string | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1]?.toLowerCase();
  if (!hex) return undefined;
  return `#${hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex}`;
}

function paintRole(value: string): 'ink' | 'white' | 'main' | undefined {
  const paint = value.trim().toLowerCase();
  if (paint === 'currentcolor' || paint === 'black') return 'ink';
  if (paint === 'white') return 'white';
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(paint)?.[1];
  if (!hex) return undefined;
  const expanded = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(expanded.slice(index, index + 2), 16) / 255);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  if (luminance >= 0.97) return 'white';
  return luminance < 0.35 ? 'ink' : 'main';
}

function pathLength(d: string): number {
  try {
    const length = new svgPathProperties(d).getTotalLength();
    return Number.isFinite(length) ? length : 0;
  } catch {
    return 0;
  }
}

export function ingestSvg(svg: string, meta: { id: string; set: string; name: string; tags: string[]; category: string | null; license: string }): { ok: true; entry: LibraryRawEntry } | { ok: false; reason: string } {
  const badTag = unsupportedTag(svg);
  if (badTag) return { ok: false, reason: `unsupported-element: <${badTag}>` };
  if (/\stransform\s*=/i.test(svg)) return { ok: false, reason: 'transform: flatten transforms before ingest' };

  const stack: Array<Record<string, string>> = [{}];
  let viewBox: { w: number; h: number } | undefined;
  const strokes: LibraryRawEntry['strokes'] = [];
  const fills: LibraryRawEntry['fills'] = [];

  for (const match of svg.matchAll(SHAPE_TAGS)) {
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing) {
      if ((tag.toLowerCase() === 'g' || tag.toLowerCase() === 'svg') && stack.length > 1) stack.pop();
      continue;
    }
    const own = attrMap(rawAttrs);
    const inherited = Object.fromEntries(INHERITED.filter((key) => stack[stack.length - 1][key] !== undefined).map((key) => [key, stack[stack.length - 1][key]]));
    const attrs = { ...inherited, ...own };
    if (tag.toLowerCase() === 'svg') {
      if (viewBox) return { ok: false, reason: 'unsupported-element: nested <svg>' };
      const box = (own.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
      if (box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) return { ok: false, reason: 'no-viewbox: a numeric viewBox is required' };
      if (box[0] !== 0 || box[1] !== 0) return { ok: false, reason: 'transform: viewBox origin must be 0 0' };
      viewBox = { w: box[2], h: box[3] };
      if (!selfClosing) stack.push(attrs);
      continue;
    }
    if (tag.toLowerCase() === 'g') {
      if (!selfClosing) stack.push(attrs);
      continue;
    }

    const d = shapeToPath(tag, own);
    if (!d) return { ok: false, reason: `bad-geometry: <${tag}>` };
    const fill = resolvePaint(attrs.fill ?? 'black');
    const stroke = attrs.stroke === undefined ? undefined : resolvePaint(attrs.stroke);
    if (/^url\(/i.test(fill) || (stroke && /^url\(/i.test(stroke))) return { ok: false, reason: 'unsupported-paint: gradients and patterns are not allowed' };

    if (fill.toLowerCase() !== 'none') {
      const role = paintRole(fill);
      if (!role) return { ok: false, reason: `unknown-color: fill ${fill}` };
      const color = role === 'main' ? hexColor(fill) : undefined;
      fills.push({ d, role, ...(attrs['fill-rule'] === 'evenodd' ? { rule: 'evenodd' as const } : {}), ...(color ? { color } : {}) });
    }
    if (stroke && stroke.toLowerCase() !== 'none') {
      const role = paintRole(stroke);
      if (!role) return { ok: false, reason: `unknown-color: stroke ${stroke}` };
      const len = pathLength(d);
      if (len <= 0) return { ok: false, reason: `bad-geometry: stroke <${tag}> has no measurable path length` };
      // Non-ink strokes are designed details (white highlights, coloured veins); they keep their colour.
      const color = role === 'ink' ? undefined : hexColor(stroke) ?? '#ffffff';
      strokes.push({ d, len: Math.round(len * 100) / 100, w: number(attrs['stroke-width'], 1), ...(color ? { color } : {}) });
    }
  }

  if (!viewBox) return { ok: false, reason: 'no-viewbox: missing <svg> root' };
  if (!strokes.some((stroke) => stroke.color === undefined)) return { ok: false, reason: 'no-ink: the reveal needs at least one dark outline stroke' };
  if (strokes.length + fills.length > MAX_ICON_PATHS) return { ok: false, reason: `too-many-paths: ${strokes.length + fills.length} > ${MAX_ICON_PATHS}` };

  const body = { id: meta.id, set: meta.set, name: meta.name, tags: [...meta.tags].sort(), category: meta.category, vb: viewBox, strokes, fills, license: meta.license };
  const contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ok: true, entry: { ...body, contentHash } };
}

const slug = (file: string): string => file.replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function ingestLibrary(manifest: IconLibraryManifest, readSvg: (file: string) => string): { catalog: LibraryCatalog; rejected: Array<{ file: string; reason: string }> } {
  if (manifest.schemaVersion !== 'icon-library-manifest/v1') throw new Error(`unsupported manifest schema ${String(manifest.schemaVersion)}`);
  if (!LICENSE_ALLOWLIST.includes(manifest.license)) throw new Error(`license ${manifest.license} is not allowlisted`);
  if (!/^[a-z0-9-]+$/.test(manifest.libraryId)) throw new Error('libraryId must be lowercase letters, digits, and hyphens');

  const entries: LibraryRawEntry[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  const icons = [...manifest.icons].sort((left, right) => left.file.localeCompare(right.file));
  const seen = new Set<string>();
  for (const icon of icons) {
    const id = `${manifest.libraryId}:${slug(icon.file)}`;
    if (seen.has(id)) {
      rejected.push({ file: icon.file, reason: `duplicate-id: ${id}` });
      continue;
    }
    seen.add(id);
    const names = icon.names.map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (!names.length) {
      rejected.push({ file: icon.file, reason: 'no-name: at least one name is required' });
      continue;
    }
    let svg: string;
    try {
      svg = readSvg(icon.file);
    } catch (error) {
      rejected.push({ file: icon.file, reason: `unreadable: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const result = ingestSvg(svg, {
      id,
      set: manifest.libraryId,
      name: names[0],
      tags: [...(icon.tags ?? []), ...names.slice(1)],
      category: icon.category ?? null,
      license: manifest.license,
    });
    if (result.ok) entries.push(result.entry);
    else rejected.push({ file: icon.file, reason: result.reason });
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  rejected.sort((left, right) => left.file.localeCompare(right.file));
  return {
    catalog: { schemaVersion: 'claude-catalog/v2', libraryId: manifest.libraryId, version: manifest.version, license: manifest.license, attribution: manifest.attribution, entries },
    rejected,
  };
}

import { createHash } from 'node:crypto';
import { svgPathProperties } from 'svg-path-properties';
import { LICENSE_ALLOWLIST } from './normalize.js';
import { flattenSvg, shapeToPath } from './svgFlatten.js';

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
  /** Bridge-driven catalogs only. */
  conceptId?: string;
  houseFamily?: string;
  domain?: string;
  /** Curated concept type of what the icon depicts (vendored pictorial sets: `entity`); lets similarity compare types without a Bridge concept. */
  conceptType?: string;
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

function unsupportedTag(svg: string): string | undefined {
  for (const match of svg.matchAll(/<\s*([a-z][\w:-]*)\b/gi)) {
    const tag = match[1];
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return tag;
    if (FORBIDDEN_TAGS.has(tag.toLowerCase())) return tag;
  }
  return undefined;
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

type IngestMeta = { id: string; set: string; name: string; tags: string[]; category: string | null; license: string };
type IngestResult = { ok: true; entry: LibraryRawEntry } | { ok: false; reason: string };

/** Failures a deterministic flatten (transforms, CSS, gradients, metadata, origin shift, path merge) can recover from. */
const RECOVERABLE = /^(transform|unsupported-element|unsupported-paint|unknown-color|too-many-paths|no-viewbox|no-ink)\b/;

/**
 * Strict-subset ingest with a deterministic flatten fallback. Files the strict parser already accepts stay
 * byte-identical (so frozen catalogs keep their content hashes); only rejected files get flattened and retried.
 */
export function ingestSvg(svg: string, meta: IngestMeta, options: { allowFillOnly?: boolean; flatten?: boolean } = {}): IngestResult {
  const strict = ingestStrict(svg, meta, options);
  if (strict.ok || options.flatten === false || !RECOVERABLE.test(strict.reason)) return strict;
  const flat = flattenSvg(svg);
  return flat.ok ? ingestStrict(flat.svg, meta, options) : flat;
}

function ingestStrict(svg: string, meta: IngestMeta, options: { allowFillOnly?: boolean } = {}): IngestResult {
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
  const fillOnlyOk = options.allowFillOnly === true && strokes.length === 0 && fills.length > 0;
  if (!fillOnlyOk && !strokes.some((stroke) => stroke.color === undefined)) return { ok: false, reason: 'no-ink: the reveal needs at least one dark outline stroke' };
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

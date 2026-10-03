import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { svgPathProperties } from 'svg-path-properties';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PaletteToken, PrimitiveVisual } from '../shared/types.js';
import { STYLE, paletteFill } from '../render/style.js';
import type { CatalogEntry } from './catalog.js';
import { stableJson } from '../shared/artifacts.js';
import { ALL_LIBRARIES, ENABLED_LIBRARIES, setCatalogDataDir, type CatalogLibrary } from './registry.js';

/**
 * Streamline icons (free duotone sets, CC BY 4.0) ingested offline by
 * scripts/build-catalog.mjs from a local @iconify/json copy — no network at
 * run time (hypothesis/v1_claude/01 §4, plan Phase 2).
 *
 * Normalization (01 §4.2) happens here at render time: the dark outline
 * becomes STYLE ink at a fixed on-screen width, the pastel body takes the
 * element's palette token, white highlights stay white, and small solid
 * details become ink. The result is one style family: black marker outline
 * + one flat pastel fill, drawn outline-first (reference frames).
 */
interface RawEntry {
  id: string;
  set: string;
  name: string;
  tags: string[];
  category: string | null;
  vb: { w: number; h: number };
  strokes: Array<{ d: string; len: number; w: number; color?: string }>;
  fills: Array<{ d: string; role: 'main' | 'white' | 'ink'; rule?: 'evenodd'; color?: string }>;
  license: string;
  contentHash?: string;
  author?: string;
  sourceUrl?: string;
  providerId?: string;
  conceptId?: string;
  houseFamily?: string;
  domain?: string;
}

interface RawCatalog {
  schemaVersion: 'claude-catalog/v1' | 'claude-catalog/v2';
  attribution: string;
  entries: RawEntry[];
}

// tsc mirrors src/ under dist/ but does not copy data files; read them from the source tree.
const RAW_HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
export const CATALOG_DATA_DIR = resolve(RAW_HERE.includes(DIST_SRC) ? RAW_HERE.replace(DIST_SRC, `${sep}src${sep}`) : RAW_HERE, 'data');
setCatalogDataDir(CATALOG_DATA_DIR);

/** On-screen outline width (px at 1080p) for an icon drawn at its intrinsic size. */
export const ICON_INK_PX = 5.5;

/** Default fill per Iconify category when the element names none — varied pastel bodies like the reference. */
const CATEGORY_FILL: Record<string, PaletteToken> = {
  NatureEcology: 'green',
  FoodDrink: 'orange',
  Health: 'red',
  MoneyShopping: 'yellow',
  WorkEducation: 'yellow',
  ArtificialIntelligence: 'purple',
  Programming: 'purple',
  ComputerDevices: 'blue',
  InterfaceEssential: 'blue',
  MapTravel: 'green',
  Culture: 'orange',
  Entertainment: 'orange',
};

/** Libraries ingested before bridge families existed carry no per-entry family. */
function defaultHouseFamily(libraryId: string): string {
  if (libraryId === 'assetlab-sketchy-downshift') return 'simi-house-v1/general-drawon';
  if (libraryId.startsWith('bridge-sketchi')) return 'simi-house-v1/technical-brand';
  return 'simi-house-v1/domain-outline';
}

const loadedLibraries = new Map<string, { attribution: string[]; entries: CatalogEntry[] }>();

const glyphLengthCache = new Map<string, number>();
function glyphPathLength(d: string): number {
  let length = glyphLengthCache.get(d);
  if (length === undefined) {
    try { const measured = new svgPathProperties(d).getTotalLength(); length = Number.isFinite(measured) ? measured : 0; } catch { length = 0; }
    glyphLengthCache.set(d, length);
  }
  return length;
}

/**
 * Solid single-colour glyphs (no outline strokes, only dark fills) look heavy next to the house style (black outline
 * + flat pastel body). Treat each dark fill as an OUTLINE (drawn first, so it still animates ink-then-fill) with a
 * pastel body; highlights stay white. Multi-colour icons that carry their own designed colours are left untouched.
 */
export function asOutlinedGlyph<T extends { strokes: Array<{ d: string; len: number; w: number; color?: string }>; fills: Array<{ d: string; role: "main" | "white" | "ink"; rule?: "evenodd"; color?: string }> }>(raw: T): T {
  const monochrome = raw.strokes.length === 0 && raw.fills.length > 0 && raw.fills.every((item) => item.role !== 'main');
  if (!monochrome) return raw;
  const inks = raw.fills.filter((item) => item.role === 'ink');
  if (!inks.length) return raw;
  return {
    ...raw,
    strokes: inks.slice(0, 12).map((item) => ({ d: item.d, len: Math.round(glyphPathLength(item.d)), w: 1 })).filter((stroke) => stroke.len > 0),
    fills: raw.fills.map((item) => (item.role === 'ink' ? { ...item, role: 'main' as const } : item)),
  };
}

function renderRaw(rawEntry: RawEntry, size: { w: number; h: number }, fill?: PaletteToken): PrimitiveVisual {
  const raw = asOutlinedGlyph(rawEntry);
  const s = Math.min(size.w / raw.vb.w, size.h / raw.vb.h);
  const tx = (size.w - raw.vb.w * s) / 2;
  const ty = (size.h - raw.vb.h * s) / 2;
  const transform = `translate(${+tx.toFixed(3)},${+ty.toFixed(3)}) scale(${+s.toFixed(5)})`;
  const explicit = fill && fill !== 'none';
  const main = paletteFill(explicit ? fill : CATEGORY_FILL[raw.category ?? ''] ?? 'blue');
  // An icon that carries its own designed colours keeps them unless the element names a palette fill.
  const body = (f: RawEntry['fills'][number]): string => (!explicit && f.color ? f.color : main);
  return {
    paths: raw.strokes.map((p) => ({ d: p.d, length: p.len, width: (p.color ? p.w : ICON_INK_PX / s), transform, pxScale: s, ...(p.color ? { color: p.color } : {}) })),
    fills: raw.fills.map((f) => ({
      d: f.d,
      fill: f.role === 'main' ? body(f) : f.role === 'white' ? '#FFFFFF' : STYLE.stroke.color,
      transform,
      ...(f.rule ? { fillRule: f.rule } : {}),
    })),
    texts: [],
  };
}

const libraryListKey = (libraries: readonly CatalogLibrary[]): string => JSON.stringify(libraries.map(({ libraryId, file, embeddings, house }) => [libraryId, file, embeddings, house]));

export function loadCatalogLibraries(libraries: readonly CatalogLibrary[] = ENABLED_LIBRARIES): { attribution: string[]; entries: CatalogEntry[] } {
  const key = libraryListKey(libraries);
  const existing = loadedLibraries.get(key);
  if (existing) return existing;

  const attribution: string[] = [];
  const entries: CatalogEntry[] = [];
  for (const library of libraries) {
    const raw = JSON.parse(readFileSync(resolve(CATALOG_DATA_DIR, library.file), 'utf8')) as RawCatalog;
    if (raw.schemaVersion !== 'claude-catalog/v1' && raw.schemaVersion !== 'claude-catalog/v2') {
      throw new Error(`${library.libraryId}: unsupported catalog schema ${String(raw.schemaVersion)}`);
    }
    attribution.push(raw.attribution);
    entries.push(...raw.entries.map((entry): CatalogEntry => ({
      id: entry.id,
      names: [entry.name],
      tags: entry.tags,
      meaning: entry.category ?? '',
      source: raw.schemaVersion === 'claude-catalog/v1' && library.libraryId === 'streamline'
        ? `streamline:${entry.set.replace(/^streamline-/, '')}`
        : `${library.libraryId}:${entry.set}`,
      license: entry.license,
      lane: entry.strokes.length + entry.fills.length > 10 ? 'rich-illustration' : 'simple-symbol',
      strokePaths: entry.strokes.length + entry.fills.length,
      contentHash: entry.contentHash ?? createHash('sha256').update(stableJson({ vb: entry.vb, strokes: entry.strokes, fills: entry.fills }), 'utf8').digest('hex'),
      attribution: raw.attribution,
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
      ...(entry.providerId ? { providerId: entry.providerId } : {}),
      ...(entry.conceptId ? { conceptId: entry.conceptId } : {}),
      houseFamily: entry.houseFamily ?? defaultHouseFamily(library.libraryId),
      ...(entry.domain ? { domain: entry.domain } : {}),
      render: (size, fill) => renderRaw(entry, size, fill),
    })));
  }
  const loaded = { attribution, entries };
  loadedLibraries.set(key, loaded);
  return loaded;
}

export function loadStreamlineCatalog(): { attribution: string; entries: CatalogEntry[] } {
  const streamline = loadCatalogLibraries(ALL_LIBRARIES.filter((library) => library.libraryId === 'streamline'));
  return { attribution: streamline.attribution[0] ?? '', entries: streamline.entries };
}

/**
 * Attribution lines for every library that supplied an asset, keyed by the
 * resolution `source` prefix (`<libraryId>:`). Written next to each video.
 */
export function attributionForSources(sources: readonly string[]): string[] {
  const lines: string[] = [];
  for (const library of ALL_LIBRARIES) {
    const prefix = library.libraryId === 'streamline' ? 'streamline:' : `${library.libraryId}:`;
    if (!sources.some((source) => source.startsWith(prefix))) continue;
    lines.push(...loadCatalogLibraries([library]).attribution);
  }
  return lines;
}

import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PaletteToken, PrimitiveVisual } from '../types.js';
import { STYLE, paletteFill } from '../style.js';
import type { CatalogEntry } from './catalog.js';

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
  strokes: Array<{ d: string; len: number; w: number }>;
  fills: Array<{ d: string; role: 'main' | 'white' | 'ink'; rule?: 'evenodd' }>;
  license: string;
}

interface RawCatalog {
  schemaVersion: 'claude-catalog/v1';
  attribution: string;
  entries: RawEntry[];
}

// tsc mirrors src/ under dist/ but does not copy data files; read them from the source tree.
const RAW_HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
export const CATALOG_DATA_DIR = resolve(RAW_HERE.includes(DIST_SRC) ? RAW_HERE.replace(DIST_SRC, `${sep}src${sep}`) : RAW_HERE, 'data');

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

let loaded: { raw: RawCatalog; entries: CatalogEntry[] } | undefined;

function renderRaw(raw: RawEntry, size: { w: number; h: number }, fill?: PaletteToken): PrimitiveVisual {
  const s = Math.min(size.w / raw.vb.w, size.h / raw.vb.h);
  const tx = (size.w - raw.vb.w * s) / 2;
  const ty = (size.h - raw.vb.h * s) / 2;
  const transform = `translate(${+tx.toFixed(3)},${+ty.toFixed(3)}) scale(${+s.toFixed(5)})`;
  const main = paletteFill(fill && fill !== 'none' ? fill : CATEGORY_FILL[raw.category ?? ''] ?? 'blue');
  return {
    paths: raw.strokes.map((p) => ({ d: p.d, length: p.len, width: ICON_INK_PX / s, transform, pxScale: s })),
    fills: raw.fills.map((f) => ({
      d: f.d,
      fill: f.role === 'main' ? main : f.role === 'white' ? '#FFFFFF' : STYLE.stroke.color,
      transform,
      ...(f.rule ? { fillRule: f.rule } : {}),
    })),
    texts: [],
  };
}

export function loadStreamlineCatalog(): { attribution: string; entries: CatalogEntry[] } {
  if (!loaded) {
    const raw = JSON.parse(readFileSync(resolve(CATALOG_DATA_DIR, 'streamline.json'), 'utf8')) as RawCatalog;
    const entries: CatalogEntry[] = raw.entries.map((e) => ({
      id: e.id,
      names: [e.name],
      tags: e.tags,
      meaning: e.category ?? '',
      source: `streamline:${e.set.replace(/^streamline-/, '')}`,
      license: e.license,
      lane: e.strokes.length + e.fills.length > 10 ? 'rich-illustration' : 'simple-symbol',
      strokePaths: e.strokes.length + e.fills.length,
      render: (size, fill) => renderRaw(e, size, fill),
    }));
    loaded = { raw, entries };
  }
  return { attribution: loaded.raw.attribution, entries: loaded.entries };
}

export const STREAMLINE_ATTRIBUTION = (): string => loadStreamlineCatalog().attribution;

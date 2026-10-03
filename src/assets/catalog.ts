import type { NormalizationLane, PaletteToken, PrimitiveVisual } from '../shared/types.js';
import { STYLE } from '../render/style.js';
import { ellipsePath, polylinePath, roundedRectPath } from '../render/pathmath.js';

/**
 * Seed catalog (claude_pipeline.md §11 / hypothesis/v1_claude/01 §4.1).
 *
 * Small hand-authored procedural seed catalog. Each `render()` is a
 * deterministic vector recipe. Source-generated retrieval ranks the separate
 * Streamline house catalog with local embeddings; this seed catalog supplies
 * exact literal matches and a limited lexical fallback when no ranked
 * candidates were provided. Descriptors must remain visually generic: do not
 * add lesson-topic keywords (for example, mapping a leaf icon to
 * photosynthesis) because that can select a misleading icon by association.
 */
export interface CatalogEntry {
  id: string;
  names: string[];
  tags: string[];
  meaning: string;
  source: string;
  license: string;
  lane: NormalizationLane;
  strokePaths: number;
  /** Asset Lab bridge concept id, normalized house family and taxonomy domain (bridge-driven catalogs only). */
  conceptId?: string;
  houseFamily?: string;
  domain?: string;
  /** Source evidence carried through catalogue ingest for export attribution. */
  contentHash?: string;
  attribution?: string;
  author?: string;
  sourceUrl?: string;
  providerId?: string;
  /** `fill` is the element's palette token; procedural entries keep their own fixed accents. */
  render: (size: { w: number; h: number }, fill?: PaletteToken) => PrimitiveVisual;
}

const accent = STYLE.palette.blue;

function simple(id: string, names: string[], tags: string[], meaning: string, render: CatalogEntry['render'], strokePaths: number): CatalogEntry {
  return { id, names, tags, meaning, source: 'generated', license: 'manual', lane: 'simple-symbol', strokePaths, render };
}
function rich(id: string, names: string[], tags: string[], meaning: string, render: CatalogEntry['render'], strokePaths: number): CatalogEntry {
  return { id, names, tags, meaning, source: 'generated', license: 'manual', lane: 'rich-illustration', strokePaths, render };
}

export const CATALOG: CatalogEntry[] = [
  simple('key', ['key'], ['access', 'unlock', 'identifier', 'security'], 'represents access, unlocking, identifiers', ({ w, h }) => {
    const head = ellipsePath(w * 0.28, h * 0.3, w * 0.2, w * 0.2);
    const shaft = polylinePath([{ x: w * 0.28, y: h * 0.5 }, { x: w * 0.28, y: h * 0.85 }]);
    const teeth = polylinePath([{ x: w * 0.28, y: h * 0.85 }, { x: w * 0.45, y: h * 0.85 }, { x: w * 0.45, y: h * 0.7 }]);
    return { paths: [head, shaft, teeth], fills: [], texts: [] };
  }, 3),
  simple('lock', ['lock', 'padlock'], ['security', 'privacy', 'protection'], 'represents security, restriction, privacy', ({ w, h }) => {
    const body = roundedRectPath(w * 0.2, h * 0.45, w * 0.6, h * 0.4, 10);
    const shackle = ellipsePath(w * 0.5, h * 0.35, w * 0.22, h * 0.22);
    return { paths: [body, shackle], fills: [], texts: [] };
  }, 2),
  rich('treasure_chest', ['treasure chest', 'chest'], ['value', 'reward', 'storage'], 'represents stored value, reward, savings', ({ w, h }) => {
    const base = roundedRectPath(w * 0.1, h * 0.45, w * 0.8, h * 0.4, 8);
    const lid = roundedRectPath(w * 0.1, h * 0.25, w * 0.8, h * 0.25, 12);
    const clasp = roundedRectPath(w * 0.44, h * 0.42, w * 0.12, h * 0.14, 4);
    return { paths: [base, lid, clasp], fills: [{ d: base.d, fill: accent }], texts: [] };
  }, 3),
  rich('brain', ['brain'], ['intelligence', 'thinking', 'model', 'cognition'], 'represents intelligence, reasoning, a model', ({ w, h }) => {
    const left = ellipsePath(w * 0.35, h * 0.5, w * 0.28, h * 0.35);
    const right = ellipsePath(w * 0.65, h * 0.5, w * 0.28, h * 0.35);
    const fold = polylinePath([{ x: w * 0.5, y: h * 0.2 }, { x: w * 0.5, y: h * 0.8 }]);
    return { paths: [left, right, fold], fills: [{ d: left.d, fill: accent }], texts: [] };
  }, 3),
  rich('robot', ['robot', 'assistant', 'ai'], ['automation', 'ai', 'assistant'], 'represents an AI system or automated agent', ({ w, h }) => {
    const head = roundedRectPath(w * 0.25, h * 0.15, w * 0.5, h * 0.35, 12);
    const body = roundedRectPath(w * 0.2, h * 0.55, w * 0.6, h * 0.35, 10);
    const antenna = polylinePath([{ x: w * 0.5, y: h * 0.15 }, { x: w * 0.5, y: h * 0.02 }]);
    return { paths: [head, body, antenna], fills: [{ d: head.d, fill: accent }], texts: [] };
  }, 3),
  simple('magnet', ['magnet'], ['magnetism', 'field'], 'represents a magnet or magnetic source', ({ w, h }) => {
    const u = polylinePath([{ x: w * 0.25, y: h * 0.15 }, { x: w * 0.25, y: h * 0.75 }, { x: w * 0.4, y: h * 0.75 }, { x: w * 0.4, y: h * 0.15 }]);
    const u2 = polylinePath([{ x: w * 0.6, y: h * 0.15 }, { x: w * 0.6, y: h * 0.75 }, { x: w * 0.75, y: h * 0.75 }, { x: w * 0.75, y: h * 0.15 }]);
    return { paths: [u, u2], fills: [], texts: [] };
  }, 2),
  simple('coil', ['coil', 'wire coil', 'loop of wire'], ['circuit'], 'represents a coil of wire in a circuit', ({ w, h }) => {
    const loops = [0, 1, 2, 3].map((i) => ellipsePath(w * (0.2 + i * 0.2), h * 0.5, w * 0.09, h * 0.35));
    return { paths: loops, fills: [], texts: [] };
  }, 4),
  simple('leaf', ['leaf'], ['plant', 'nature'], 'represents a leaf, plant tissue', ({ w, h }) => {
    const body = ellipsePath(w * 0.5, h * 0.5, w * 0.4, h * 0.32);
    const vein = polylinePath([{ x: w * 0.15, y: h * 0.5 }, { x: w * 0.85, y: h * 0.5 }]);
    return { paths: [body, vein], fills: [{ d: body.d, fill: STYLE.palette.green }], texts: [] };
  }, 2),
  rich('sun', ['sun', 'sunlight'], ['light', 'energy', 'source'], 'represents sunlight or an energy source', ({ w, h }) => {
    const core = ellipsePath(w * 0.5, h * 0.5, w * 0.22, w * 0.22);
    const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const r1 = w * 0.28, r2 = w * 0.42;
      const cx = w * 0.5, cy = h * 0.5;
      return polylinePath([{ x: cx + r1 * Math.cos(rad), y: cy + r1 * Math.sin(rad) }, { x: cx + r2 * Math.cos(rad), y: cy + r2 * Math.sin(rad) }]);
    });
    return { paths: [core, ...rays], fills: [{ d: core.d, fill: STYLE.palette.yellow }], texts: [] };
  }, 9),
  simple('battery', ['battery'], ['power', 'source', 'energy'], 'represents an electrical power source', ({ w, h }) => {
    const body = roundedRectPath(w * 0.1, h * 0.3, w * 0.7, h * 0.4, 8);
    const nub = roundedRectPath(w * 0.8, h * 0.42, w * 0.1, h * 0.16, 4);
    return { paths: [body, nub], fills: [], texts: [] };
  }, 2),
  simple('gear', ['gear', 'cog'], ['mechanism', 'process', 'engineering'], 'represents a mechanical process or system', ({ w, h }) => {
    const ring = ellipsePath(w * 0.5, h * 0.5, w * 0.3, w * 0.3);
    const hub = ellipsePath(w * 0.5, h * 0.5, w * 0.1, w * 0.1);
    return { paths: [ring, hub], fills: [], texts: [] };
  }, 2),
  simple('lightbulb', ['lightbulb', 'bulb', 'idea'], ['idea', 'insight', 'energy'], 'represents an idea or insight', ({ w, h }) => {
    const bulb = ellipsePath(w * 0.5, h * 0.4, w * 0.26, w * 0.26);
    const base = roundedRectPath(w * 0.38, h * 0.62, w * 0.24, h * 0.18, 4);
    return { paths: [bulb, base], fills: [{ d: bulb.d, fill: STYLE.palette.yellow }], texts: [] };
  }, 2),
  simple('book', ['book', 'document', 'source'], ['knowledge', 'reference', 'source document'], 'represents a document or reference source', ({ w, h }) => {
    const cover = roundedRectPath(w * 0.15, h * 0.15, w * 0.7, h * 0.7, 6);
    const spine = polylinePath([{ x: w * 0.5, y: h * 0.15 }, { x: w * 0.5, y: h * 0.85 }]);
    return { paths: [cover, spine], fills: [], texts: [] };
  }, 2),
  simple('clock', ['clock', 'time', 'timer'], ['time', 'duration', 'speed'], 'represents time or duration', ({ w, h }) => {
    const face = ellipsePath(w * 0.5, h * 0.5, w * 0.35, w * 0.35);
    const hourHand = polylinePath([{ x: w * 0.5, y: h * 0.5 }, { x: w * 0.5, y: h * 0.3 }]);
    const minHand = polylinePath([{ x: w * 0.5, y: h * 0.5 }, { x: w * 0.65, y: h * 0.5 }]);
    return { paths: [face, hourHand, minHand], fills: [], texts: [] };
  }, 3),
  simple('cloud', ['cloud'], ['gas', 'weather', 'network'], 'represents a gas, atmosphere, or a network/cloud service', ({ w, h }) => {
    const a = ellipsePath(w * 0.35, h * 0.55, w * 0.22, h * 0.2);
    const b = ellipsePath(w * 0.6, h * 0.45, w * 0.26, h * 0.24);
    const c = ellipsePath(w * 0.8, h * 0.58, w * 0.18, h * 0.16);
    return { paths: [a, b, c], fills: [], texts: [] };
  }, 3),
  simple('person', ['person', 'student', 'learner', 'user'], ['human', 'role', 'audience'], 'represents a person, learner, or user', ({ w, h }) => {
    const head = ellipsePath(w * 0.5, h * 0.25, w * 0.15, w * 0.15);
    const body = polylinePath([{ x: w * 0.3, y: h * 0.85 }, { x: w * 0.5, y: h * 0.45 }, { x: w * 0.7, y: h * 0.85 }]);
    return { paths: [head, body], fills: [], texts: [] };
  }, 2),
  simple('scale', ['scale', 'balance', 'weighing scale'], ['weight', 'balance', 'comparison'], 'represents balance, weighting, comparison', ({ w, h }) => {
    const beam = polylinePath([{ x: w * 0.2, y: h * 0.3 }, { x: w * 0.8, y: h * 0.3 }]);
    const post = polylinePath([{ x: w * 0.5, y: h * 0.15 }, { x: w * 0.5, y: h * 0.85 }]);
    const left = ellipsePath(w * 0.2, h * 0.5, w * 0.1, h * 0.06);
    const right = ellipsePath(w * 0.8, h * 0.5, w * 0.1, h * 0.06);
    return { paths: [beam, post, left, right], fills: [], texts: [] };
  }, 4),
  simple('compass', ['compass', 'direction', 'navigation'], ['direction', 'guidance', 'navigation'], 'represents direction or guidance', ({ w, h }) => {
    const ring = ellipsePath(w * 0.5, h * 0.5, w * 0.32, w * 0.32);
    const needle = polylinePath([{ x: w * 0.5, y: h * 0.25 }, { x: w * 0.5, y: h * 0.75 }]);
    return { paths: [ring, needle], fills: [], texts: [] };
  }, 2),
];

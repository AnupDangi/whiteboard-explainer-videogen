import type { Badge, PaletteToken, ResolutionRecord, PrimitiveVisual, TextRun } from '../types.js';
import { STYLE } from '../style.js';
import type { CatalogEntry } from './catalog.js';
import { allCatalogEntries, type Candidate } from './semantic.js';
import { LICENSE_ALLOWLIST, normalizeCatalogEntry } from './normalize.js';
import { composeBadge } from './badges.js';
import { styledTextBoxVisual } from '../render/primitives.js';
import { isHouseSource } from './registry.js';

/** Lexical starting points only; experiment E4 has not calibrated these values. */
export const TAU_HIGH = 0.6;
export const TAU_MID = 0.3;

/**
 * Embedding-score thresholds (cosine, local MiniLM). These are uncalibrated
 * starting points; use the E4 harness on frozen labeled concept-asset pairs
 * before changing them or calling them calibrated.
 */
export const TAU_HIGH_EMB = 0.62;
export const TAU_MID_EMB = 0.5;

const tokenize = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Generic lexical token-overlap fallback, used only when no embedding candidates were supplied. */
export function semanticScore(concept: string, entry: CatalogEntry): number {
  const q = tokenize(concept);
  const bag = tokenize([...entry.names, ...entry.tags, entry.meaning].join(' '));
  return jaccard(q, bag);
}

export interface ObjectResolution {
  resolution: ResolutionRecord;
  visual: PrimitiveVisual;
}

const singular = (s: string) => (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s);

/**
 * Asset resolution ladder (claude_pipeline.md §10). Every branch resolves —
 * rung 4 is unconditional — so a final render can never contain an
 * unresolved `object` element (a non-compensable hard failure).
 *
 * Order: exact/alias name (rung 2, score 1) -> embedding-ranked candidates
 * when supplied (rung 2 >= TAU_HIGH_EMB, rung 3 >= TAU_MID_EMB) -> lexical
 * overlap (rung 2 >= TAU_HIGH, rung 3 >= TAU_MID) -> styled text box.
 * `catalog` defaults to Streamline + the procedural seed catalog.
 */
export function resolveObject(
  concept: string,
  opts: { badge?: Badge; count?: number; label?: string; fill?: PaletteToken; candidates?: Candidate[]; size: { w: number; h: number } },
  catalog: CatalogEntry[] = allCatalogEntries(),
): ObjectResolution {
  const conceptLower = concept.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const wanted = new Set([conceptLower, singular(conceptLower)]);
  const isHouse = (e: CatalogEntry) => isHouseSource(e.source);
  const exactOf = (pool: CatalogEntry[]) => pool.find((e) => e.names.some((n) => wanted.has(n.toLowerCase())));
  const topCandidate = opts.candidates?.[0];
  const candidateEntry = topCandidate ? catalog.find((e) => e.id === topCandidate.id) : undefined;

  // Preference keeps ONE style family on screen: house-style (Streamline) exact name,
  // then a strong house-style embedding match, and only then a procedural seed entry.
  let best: { entry: CatalogEntry; score: number; rung: 2 | 3 } | undefined;
  const houseExact = exactOf(catalog.filter(isHouse));
  const anyExact = exactOf(catalog);
  if (houseExact) best = { entry: houseExact, score: 1, rung: 2 };
  else if (candidateEntry && topCandidate!.score >= TAU_HIGH_EMB) best = { entry: candidateEntry, score: topCandidate!.score, rung: 2 };
  else if (anyExact) best = { entry: anyExact, score: 1, rung: 2 };
  else if (candidateEntry && topCandidate!.score >= TAU_MID_EMB) best = { entry: candidateEntry, score: topCandidate!.score, rung: 3 };
  if (!best && !opts.candidates?.length) {
    let lex: { entry: CatalogEntry; score: number } | undefined;
    for (const entry of catalog) {
      const score = semanticScore(conceptLower, entry);
      if (!lex || score > lex.score) lex = { entry, score };
    }
    if (lex && lex.score >= TAU_MID) best = { ...lex, rung: lex.score >= TAU_HIGH ? 2 : 3 };
  }

  const attachBadge = (visual: PrimitiveVisual, iconSize: { w: number; h: number }): PrimitiveVisual => (opts.badge ? composeBadge(visual, opts.badge, iconSize) : visual);
  const labelText = opts.label ?? concept;

  if (best) {
    const norm = normalizeCatalogEntry(best.entry);
    const side = iconSide(opts.size);
    const icon = attachBadge(best.entry.render({ w: side, h: side }, opts.fill), { w: side, h: side });
    return {
      visual: withLabelBelow(icon, side, labelText, opts.size, opts.count),
      resolution: { rung: best.rung, assetId: best.entry.id, score: best.score, license: best.entry.license, lane: norm.lane, source: best.entry.source },
    };
  }

  // Rung 4: always resolves. No unlicensed/unresolvable asset ever reaches the renderer.
  const visual = styledTextBoxVisual(opts.label ?? concept, opts.size, opts.badge);
  return {
    visual,
    resolution: { rung: 4, assetId: null, score: opts.candidates?.[0]?.score ?? 0, license: 'manual', lane: 'text-fallback', source: 'generated' },
  };
}

/** Height reserved under an icon for its uppercase label (reference frames label every icon underneath). */
export const OBJECT_LABEL_H = 56;

export const iconSide = (size: { w: number; h: number }): number => Math.max(1, Math.min(size.w, size.h - OBJECT_LABEL_H));

const prefixTransform = (dx: number, existing?: string) => (dx === 0 ? existing : `translate(${dx},0)${existing ? ` ${existing}` : ''}`);

/**
 * Place an icon visual (drawn in a `side`x`side` box) centered at the top of
 * the element box, with its label written underneath. `count` > 1 adds a
 * small "xN" multiplier beside the icon rather than drawing N copies.
 */
export function withLabelBelow(icon: PrimitiveVisual, side: number, label: string, size: { w: number; h: number }, count?: number): PrimitiveVisual {
  const dx = (size.w - side) / 2;
  const texts: TextRun[] = icon.texts.map((t) => ({ ...t, x: t.x + dx }));
  texts.push({ x: size.w / 2, y: side + OBJECT_LABEL_H - 14, text: label.toUpperCase(), size: STYLE.font.sizes.label, anchor: 'middle' });
  if (count && count > 1) texts.push({ x: dx - 8, y: side * 0.3, text: `×${count}`, size: STYLE.font.sizes.label, anchor: 'end' });
  return {
    paths: icon.paths.map((p) => ({ ...p, transform: prefixTransform(dx, p.transform) })),
    fills: icon.fills.map((f) => ({ ...f, transform: prefixTransform(dx, f.transform) })),
    texts,
    embeds: icon.embeds?.map((e) => ({ ...e, x: e.x + dx })),
  };
}

export function assertLicenseAllowed(license: string): void {
  if (!LICENSE_ALLOWLIST.includes(license)) throw new Error(`Asset license "${license}" is not in the allowlist`);
}

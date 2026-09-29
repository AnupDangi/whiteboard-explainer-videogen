import type { Badge, PaletteToken, ResolutionRecord, PrimitiveVisual, TextRun } from '../types.js';
import { STYLE } from '../style.js';
import type { CatalogEntry } from './catalog.js';
import { allCatalogEntries, type Candidate } from './semantic.js';
import { normalizeCatalogEntry } from './normalize.js';
import { composeBadge } from './badges.js';
import { styledTextBoxVisual } from '../render/primitives.js';
import { renderSemanticRole, renderTopology, isSemanticRole, isSemanticTopology } from '../render/semanticCore.js';
import { loadBridge, bridgeConceptFor, bridgeDiagramsForConcept, bridgeHasAsset, type BridgeConcept } from './bridge.js';
import { isHouseSource } from './registry.js';
import type { IconPin } from './iconPins.js';

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
 * Next-best pick after the top choice was avoided (cross-scene repetition for
 * a different concept). Mirrors resolveObject's priority — exact-name matches
 * first, then strong embedding candidates, then weaker embedding
 * candidates, then lexical overlap — with every tier fully ordered so the
 * result stays deterministic. Returns undefined when nothing un-avoided
 * qualifies (the caller falls through to the rung-4 text box).
 */
function nextBest(
  catalog: CatalogEntry[],
  conceptLower: string,
  wanted: Set<string>,
  candidates: Candidate[] | undefined,
  excludeId: string,
  avoid: ReadonlySet<string>,
): { entry: CatalogEntry; score: number; rung: 2 | 3 } | undefined {
  const usable = (id: string): boolean => id !== excludeId && !avoid.has(id);
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const ranked: Array<{ entry: CatalogEntry; score: number; rung: 2 | 3 }> = [];
  const seen = new Set<string>();
  const push = (entry: CatalogEntry, score: number, rung: 2 | 3): void => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    ranked.push({ entry, score, rung });
  };
  for (const entry of catalog.filter((e) => usable(e.id) && e.names.some((name) => wanted.has(name.toLowerCase().replace(/[_-]+/g, ' ')))).sort((a, b) => a.id.localeCompare(b.id))) {
    push(entry, 1, 2);
  }
  for (const candidate of candidates ?? []) {
    const entry = byId.get(candidate.id);
    if (!entry || !usable(entry.id)) continue;
    if (candidate.score >= TAU_HIGH_EMB) push(entry, candidate.score, 2);
  }
  for (const candidate of candidates ?? []) {
    const entry = byId.get(candidate.id);
    if (!entry || !usable(entry.id)) continue;
    if (candidate.score >= TAU_MID_EMB && candidate.score < TAU_HIGH_EMB) push(entry, candidate.score, 3);
  }
  if (!candidates?.length) {
    const lex = catalog
      .filter((entry) => usable(entry.id))
      .map((entry) => ({ entry, score: semanticScore(conceptLower, entry) }))
      .filter(({ score }) => score >= TAU_MID)
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    for (const { entry, score } of lex) push(entry, score, score >= TAU_HIGH ? 2 : 3);
  }
  return ranked[0];
}

/**
 * Asset resolution ladder (Teaching Compiler V1 R0–R9; claude_pipeline.md §10).
 * Every branch resolves — R8/R9 are unconditional — so a final render can
 * never contain an unresolved `object` element (a non-compensable failure).
 *
 * Order: R0 verified pin -> R1 diagram (explicit strategy, or bridge concept
 * whose preferred strategy is diagram-first) -> R2 semantic-core role ->
 * R3 house literal (exact name) -> R4 approved metaphor -> R5 typed
 * retrieval (embedding >= TAU_HIGH_EMB rung 2 / >= TAU_MID_EMB rung 3, then
 * lexical; non-exact candidates must be type-compatible, R6 domain assets
 * have no V1 library and fall through) -> R7 state/topology (explicit
 * strategy only) -> R8 labelled primitive -> R9 minimal text.
 *
 * A pin means ONLY "reuse this already-validated representation for this
 * referent" — never "the planner chose it, therefore it is correct". A pin
 * naming no renderable entry (catalog id or synthetic core:/topo:/diagram:
 * ref) is stale and ignored. `catalog` defaults to the enabled house
 * libraries (assetlab-sketchy-downshift).
 */
export interface VisualRequest {
  badge?: Badge;
  count?: number;
  label?: string;
  fill?: PaletteToken;
  candidates?: Candidate[];
  pin?: IconPin;
  size: { w: number; h: number };
  /** Asset ids used by the previous scene for DIFFERENT concepts; a colliding best pick falls through to the next-best candidate. */
  avoidAssetIds?: ReadonlySet<string>;
  /** Stable bridge concept id for this referent (preferred over name matching). */
  conceptId?: string;
  /** Requested semantic role (R2). */
  semanticRole?: string;
  /** Requested resolution strategy (R1/R2/R7 explicit paths). */
  visualStrategy?: 'diagram' | 'semantic-core' | 'literal' | 'metaphor' | 'retrieval' | 'topology' | 'labelled' | 'text';
  /** Board template (maps to topology grammar for R7). */
  template?: string;
}

const isSyntheticRef = (id: string): boolean =>
  id.startsWith('core:') || id.startsWith('topo:') || id.startsWith('diagram:');

/** R4 — explicit concept <-> metaphor mappings. Curated only: an entry here is a claim that this metaphor teaches the concept. Empty in V1 (mechanism ready for curation). */
export const APPROVED_METAPHORS: Record<string, { role?: string; asset?: string }> = {};

const TEMPLATE_TOPOLOGY: Record<string, string> = {
  chain: 'chain',
  fan_out: 'fan_out',
  convergence: 'convergence',
  cycle: 'cycle',
  hub_spoke: 'hub_spoke',
  compare_2: 'comparison',
  threshold: 'threshold',
};

/**
 * R1 policy: which diagram-spec templates have a procedural topology
 * equivalent in V1. Spec-only templates (annotated-scene, plot, chart, tree)
 * fall through until their renderers exist (§3 gap).
 */
const DIAGRAM_TOPOLOGY: Record<string, string> = {
  flow: 'chain',
  cycle: 'cycle',
  'network-graph': 'hub_spoke',
};

export function topologyForDiagram(template: string): string | undefined {
  return DIAGRAM_TOPOLOGY[template];
}

function requestConcept(visual: Pick<VisualRequest, 'conceptId'>, concept: string): BridgeConcept | undefined {
  if (visual.conceptId) {
    const byId = bridgeConceptFor(visual.conceptId);
    if (byId) return byId;
  }
  return bridgeConceptFor(concept);
}

/**
 * R5 type gate: a non-exact candidate may only serve a request whose bridge
 * concept type it shares (or when either side is untyped — the gate cannot
 * judge what it cannot see). Exact-name matches bypass (R3 owns them).
 */
export function typeCompatible(requestType: string | undefined, entry: CatalogEntry): boolean {
  if (!requestType) return true;
  const entryType = bridgeConceptFor(entry.names[0] ?? '')?.conceptType;
  if (!entryType) return true;
  return requestType === entryType;
}

export function resolveObject(
  concept: string,
  opts: VisualRequest,
  catalog: CatalogEntry[] = allCatalogEntries(),
): ObjectResolution {
  const conceptLower = concept.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const wanted = new Set([conceptLower, singular(conceptLower)]);
  const isHouse = (e: CatalogEntry) => isHouseSource(e.source);
  const exactOf = (pool: CatalogEntry[]) => pool.filter((entry) => entry.names.some((name) => wanted.has(name.toLowerCase().replace(/[_-]+/g, ' ')))).sort((a, b) => a.id.localeCompare(b.id))[0];
  const topCandidate = opts.candidates?.[0];
  const candidateEntry = topCandidate ? catalog.find((e) => e.id === topCandidate.id) : undefined;
  const bridge = loadBridge();
  const bConcept = requestConcept(opts, concept);
  const base = { conceptId: bConcept?.conceptId, bridgeVersion: bridge.catalogVersion } as const;
  const labelText = opts.label ?? concept;
  const attachBadge = (visual: PrimitiveVisual, iconSize: { w: number; h: number }): PrimitiveVisual => (opts.badge ? composeBadge(visual, opts.badge, iconSize) : visual);

  const renderEntry = (
    entry: CatalogEntry, score: number, rung: 2 | 3, strategy: ResolutionRecord['strategy'],
    extra?: Partial<ResolutionRecord>,
  ): ObjectResolution => {
    const norm = normalizeCatalogEntry(entry);
    const side = iconSide(opts.size, labelText);
    const icon = attachBadge(entry.render({ w: side, h: side }, opts.fill), { w: side, h: side });
    return {
      visual: withLabelBelow(icon, side, labelText, opts.size, opts.count),
      resolution: { rung, assetId: entry.id, score, license: entry.license, lane: norm.lane, source: entry.source, strategy, ...base, ...extra },
    };
  };

  // R0 — verified pin. Valid only when it names a renderable entry: a catalog
  // id, or a synthetic core:/topo:/diagram: ref (deterministic re-render).
  // Anything else is stale (renamed asset, swapped catalog) and ignored.
  if (opts.pin && (catalog.some((e) => e.id === opts.pin!.assetId) || isSyntheticRef(opts.pin.assetId) || bridgeHasAsset(opts.pin.assetId))) {
    const pinnedEntry = catalog.find((entry) => entry.id === opts.pin!.assetId);
    if (pinnedEntry) {
      return renderEntry(pinnedEntry, opts.pin.score, opts.pin.rung, 'R0-verified-pin');
    }
    if (opts.pin.assetId.startsWith('core:')) {
      const role = opts.pin.assetId.slice('core:'.length);
      if (isSemanticRole(role)) {
        const out = renderCoreRole(role, opts, base);
        out.resolution.strategy = 'R0-verified-pin';
        return out;
      }
    }
    if (opts.pin.assetId.startsWith('topo:')) {
      const drawn = renderTopology(opts.pin.assetId.slice('topo:'.length), opts.size.w, opts.size.h);
      if (drawn) {
        return {
          visual: attachBadge(drawn, opts.size),
          resolution: { rung: 2, assetId: opts.pin.assetId, score: opts.pin.score, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R0-verified-pin', ...base },
        };
      }
    }
    // Stale synthetic ref (role/topology retired): fall through.
  }

  // R1 — diagram. Explicit strategy, or a bridge concept whose preferred
  // strategy is diagram-first (mechanisms explain better than literals).
  const diagrams = bConcept ? bridgeDiagramsForConcept(bConcept.conceptId) : [];
  if ((opts.visualStrategy === 'diagram' && diagrams.length > 0) || (opts.visualStrategy === undefined && bConcept?.preferredStrategies[0] === 'diagram' && diagrams.length > 0)) {
    const diagram = diagrams.sort((a, b) => a.ref.localeCompare(b.ref))[0];
    const topology = topologyForDiagram(diagram.topology);
    const drawn = topology ? renderTopology(topology, opts.size.w, opts.size.h) : undefined;
    if (drawn) {
      return {
        visual: attachBadge(drawn, opts.size),
        resolution: { rung: 2, assetId: `diagram:${diagram.ref}`, score: 0.9, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R1-diagram', diagramRef: diagram.ref, ...base },
      };
    }
  }

  // R2 — semantic core role (explicit request only).
  if (opts.semanticRole && (opts.visualStrategy === undefined || opts.visualStrategy === 'semantic-core') && isSemanticRole(opts.semanticRole)) {
    return renderCoreRole(opts.semanticRole, opts, base);
  }

  // Preference keeps ONE style family on screen: house-style exact name,
  // then a strong house-style embedding match, and only then any exact entry.
  let best: { entry: CatalogEntry; score: number; rung: 2 | 3 } | undefined;
  const houseExact = exactOf(catalog.filter(isHouse));
  const anyExact = exactOf(catalog);
  if (houseExact) best = { entry: houseExact, score: 1, rung: 2 };
  else if (candidateEntry && topCandidate!.score >= TAU_HIGH_EMB) best = { entry: candidateEntry, score: topCandidate!.score, rung: 2 };
  else if (anyExact) best = { entry: anyExact, score: 1, rung: 2 };
  else if (candidateEntry && topCandidate!.score >= TAU_MID_EMB) best = { entry: candidateEntry, score: topCandidate!.score, rung: 3 };

  // Cross-scene differentiation: when the previous scene already used this
  // icon for a different concept, fall through to the next-best candidate
  // instead of repeating the same visual. Pins always win (handled at R0)
  // and are never avoided. Deterministic: every ranking below is fully
  // ordered (score, then asset id), so the same inputs always pick the same
  // alternate. When every catalog candidate is avoided, best stays undefined
  // and the R8/R9 fallbacks below still resolve.
  if (best && opts.avoidAssetIds?.has(best.entry.id)) {
    const alt = nextBest(catalog, conceptLower, wanted, opts.candidates, best.entry.id, opts.avoidAssetIds) ?? undefined;
    best = alt;
  }
  // R3 — house literal wins when it is exact (mechanism auto-diagram above
  // already ran; an exact literal for a non-mechanism concept serves here).
  if (best && best.score === 1) {
    return renderEntry(best.entry, best.score, best.rung, 'R3-house-literal');
  }

  // R4 — approved metaphor (curated concept -> role or asset).
  const metaphor = APPROVED_METAPHORS[bConcept?.conceptId ?? ''] ?? APPROVED_METAPHORS[conceptLower];
  if (metaphor && (opts.visualStrategy === undefined || opts.visualStrategy === 'metaphor')) {
    if (metaphor.role && isSemanticRole(metaphor.role)) {
      const out = renderCoreRole(metaphor.role, opts, base);
      out.resolution.strategy = 'R4-approved-metaphor';
      return out;
    }
    if (metaphor.asset) {
      const entry = catalog.find((e) => e.id === metaphor.asset);
      if (entry) return renderEntry(entry, 0.85, 2, 'R4-approved-metaphor');
    }
  }

  // R5 — typed retrieval. Non-exact candidates must be type-compatible with
  // the request concept (R6 domain assets: no V1 library, falls through).
  const requestType = bConcept?.conceptType;
  if (best && typeCompatible(requestType, best.entry)) {
    return renderEntry(best.entry, best.score, best.rung, 'R5-typed-retrieval');
  }
  if (!opts.candidates?.length) {
    const lex = catalog
      .filter((entry) => typeCompatible(requestType, entry))
      .map((entry) => ({ entry, score: semanticScore(conceptLower, entry) }))
      .filter(({ score }) => score >= TAU_MID)
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))[0];
    if (lex) return renderEntry(lex.entry, lex.score, lex.score >= TAU_HIGH ? 2 : 3, 'R5-typed-retrieval');
  }

  // R7 — state/topology fallback (explicit strategy only). Rung 2, not 3:
  // a confident procedural drawing is not a weak catalog match, so the
  // semantic-asset-mismatch gate must not fire on it.
  if (opts.visualStrategy === 'topology') {
    const topoName = (opts.semanticRole && isSemanticTopology(opts.semanticRole) ? opts.semanticRole : undefined)
      ?? (opts.template ? TEMPLATE_TOPOLOGY[opts.template] : undefined);
    if (topoName) {
      const drawn = renderTopology(topoName, opts.size.w, opts.size.h);
      if (drawn) {
        return {
          visual: attachBadge(drawn, opts.size),
          resolution: { rung: 2, assetId: `topo:${topoName}`, score: 0.8, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R7-state-topology', semanticRole: opts.semanticRole, ...base },
        };
      }
    }
  }

  // R8/R9: always resolve. No unlicensed/unresolvable asset ever reaches the renderer.
  const fallbackLabel = opts.label ?? concept;
  const visual = styledTextBoxVisual(fallbackLabel, opts.size, opts.badge);
  const labelled = conceptLower.length > 0 && (opts.visualStrategy === undefined || opts.visualStrategy === 'labelled' || opts.visualStrategy === 'text');
  return {
    visual,
    resolution: {
      rung: 4, assetId: null, score: opts.candidates?.[0]?.score ?? 0, license: 'manual',
      lane: labelled ? 'labelled-primitive' : 'text-only', source: 'generated',
      strategy: labelled ? 'R8-labelled-primitive' : 'R9-minimal-text', ...base,
    },
  };
}

/** Render a semantic-core role with its concept label (R2/R4). */
function renderCoreRole(
  role: string,
  opts: VisualRequest,
  base: { conceptId: string | undefined; bridgeVersion: string },
): ObjectResolution {
  const labelText = opts.label ?? '';
  const side = iconSide(opts.size, labelText);
  const drawn = renderSemanticRole(role, side);
  if (!drawn) {
    const visual = styledTextBoxVisual(labelText, opts.size, opts.badge);
    return {
      visual,
      resolution: { rung: 4, assetId: null, score: 0, license: 'manual', lane: 'labelled-primitive', source: 'generated', strategy: 'R8-labelled-primitive', semanticRole: role, ...base },
    };
  }
  const icon = opts.badge ? composeBadge(drawn, opts.badge, { w: side, h: side }) : drawn;
  return {
    visual: withLabelBelow(icon, side, labelText, opts.size, opts.count),
    resolution: { rung: 2, assetId: `core:${role}`, score: 0.9, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R2-semantic-core', semanticRole: role, ...base },
  };
}

/** Height reserved under an icon for its uppercase label (reference frames label every icon underneath). */
export const OBJECT_LABEL_H = 56;

/** Extra height per wrapped label line (label font ~32 px at 1.15 leading). */
export const OBJECT_LABEL_LINE_H = 37;

/**
 * Split a label into at most two balanced lines, as the reference frames do
 * ("CARBON / DIOXIDE"). One word stays on one line. Narrow labels let the
 * layout scale icons up instead of spreading one long line across the board.
 */
export function labelLines(label: string): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [label.trim()];
  let best = 1;
  let bestDiff = Infinity;
  for (let cut = 1; cut < words.length; cut++) {
    const diff = Math.abs(words.slice(0, cut).join(' ').length - words.slice(cut).join(' ').length);
    if (diff < bestDiff) { best = cut; bestDiff = diff; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export const labelBlockHeight = (label: string): number => OBJECT_LABEL_H + (labelLines(label).length - 1) * OBJECT_LABEL_LINE_H;

export const iconSide = (size: { w: number; h: number }, label = ''): number => Math.max(1, Math.min(size.w, size.h - labelBlockHeight(label)));

const prefixTransform = (dx: number, existing?: string) => (dx === 0 ? existing : `translate(${dx},0)${existing ? ` ${existing}` : ''}`);

/**
 * Place an icon visual (drawn in a `side`x`side` box) centered at the top of
 * the element box, with its label written underneath. `count` > 1 adds a
 * small "xN" multiplier beside the icon rather than drawing N copies.
 */
export function withLabelBelow(icon: PrimitiveVisual, side: number, label: string, size: { w: number; h: number }, count?: number): PrimitiveVisual {
  const dx = (size.w - side) / 2;
  const texts: TextRun[] = icon.texts.map((t) => ({ ...t, x: t.x + dx }));
  labelLines(label).forEach((line, index) => texts.push({ x: size.w / 2, y: side + OBJECT_LABEL_H - 14 + index * OBJECT_LABEL_LINE_H, text: line.toUpperCase(), size: STYLE.font.sizes.label, anchor: 'middle' }));
  if (count && count > 1) texts.push({ x: dx - 8, y: side * 0.3, text: `×${count}`, size: STYLE.font.sizes.label, anchor: 'end' });
  return {
    paths: icon.paths.map((p) => ({ ...p, transform: prefixTransform(dx, p.transform) })),
    fills: icon.fills.map((f) => ({ ...f, transform: prefixTransform(dx, f.transform) })),
    texts,
    embeds: icon.embeds?.map((e) => ({ ...e, x: e.x + dx })),
  };
}


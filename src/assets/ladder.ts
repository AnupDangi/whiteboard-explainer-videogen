import type { Badge, PaletteToken, ResolutionRecord, PrimitiveVisual, TextRun } from '../shared/types.js';
import { STYLE } from '../render/style.js';
import type { CatalogEntry } from './catalog.js';
import { allCatalogEntries, type Candidate } from './semantic.js';
import { normalizeCatalogEntry } from './normalize.js';
import { composeBadge } from './badges.js';
import { minimalTextVisual, styledTextBoxVisual } from '../render/primitives.js';
import { renderSemanticRole, renderTopology, isSemanticRole, isSemanticTopology } from '../render/semanticCore.js';
import { loadBridge, bridgeConceptFor, bridgeDiagramsForConcept, type BridgeConcept } from './bridge.js';
import type { IconPin } from './iconPins.js';
import { referentKeys } from './referent.js';
import { isExemptFamily } from './sceneFamily.js';
import { classifyDiagramAdapter } from './diagramAdapters.js';
import { loadApprovedMetaphors, type ApprovedMetaphor } from './metaphors.js';
export { classifyDiagramAdapter } from './diagramAdapters.js';

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

/** Taxonomy preference (final_plan/02 §17): an asset whose domain names the lesson domain outranks a 'general' one. */
export function domainMatches(entry: { domain?: string }, lessonDomain: string | undefined): boolean {
  if (!lessonDomain || !entry.domain || entry.domain === 'general') return false;
  const lesson = lessonDomain.toLowerCase();
  const domain = entry.domain.toLowerCase();
  return lesson.includes(domain) || domain.includes(lesson);
}

const singular = (s: string) => (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s);

const normalizedName = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/** A name shared by multiple bridge concepts does not identify a referent. */
function uniqueBridgeConcept(value: string): BridgeConcept | undefined {
  return bridgeConceptFor(value);
}

function nameIsAmbiguous(value: string): boolean {
  const want = normalizedName(value);
  return loadBridge().concepts.filter((item) => normalizedName(item.conceptId) === want || item.aliases.some((alias) => normalizedName(alias) === want)).length > 1;
}

/**
 * Asset resolution ladder (Teaching Compiler V1 R0–R11; final_plan/03_ARCHITECTURE.md).
 * Every branch resolves — R10/R11 are unconditional — so a final render can
 * never contain an unresolved `object` element (a non-compensable failure).
 *
 * R0 verified pin, R1 diagram, R2 semantic-core role, R3 Downshift literal,
 * R4 curated Flaticon literal, R5 approved metaphor, R6 typed Streamline,
 * R7 technical/brand Sketchi, R8 ontology-compatible fallback, R9 topology,
 * R10 labelled primitive, R11 minimal text. Provider rungs with no approved
 * renderable catalog entries simply fall through.
 *
 * A pin means ONLY "reuse this already-validated representation for this
 * referent" — never "the planner chose it, therefore it is correct". A pin
 * naming no renderable entry (catalog id or synthetic core:/topo:/diagram: ref)
 * is stale and ignored. `catalog` defaults to the enabled house
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
  /** Catalog entry id a cheap semantic validator confirmed depicts this referent (curated exact match). */
  validatedAssetId?: string;
  /** Primary icon family chosen for the scene; assets of other non-exempt families are filtered out before ranking. */
  sceneFamily?: string;
  /** Lesson domain (S3 lessonBible.domain); entries whose taxonomy domain matches rank first among exact literals. */
  lessonDomain?: string;
}

/** R5 — explicit concept <-> metaphor mappings. Empty until reviewed curation. */
export const APPROVED_METAPHORS: Record<string, ApprovedMetaphor> = loadApprovedMetaphors();

const TEMPLATE_TOPOLOGY: Record<string, string> = {
  chain: 'chain',
  fan_out: 'fan_out',
  convergence: 'convergence',
  cycle: 'cycle',
  hub_spoke: 'hub_spoke',
  compare_2: 'comparison',
  threshold: 'threshold',
};

function requestConcept(visual: Pick<VisualRequest, 'conceptId'>, concept: string): BridgeConcept | undefined {
  return visual.conceptId ? uniqueBridgeConcept(visual.conceptId) : uniqueBridgeConcept(concept);
}

/**
 * Similarity may only select an asset when both concepts have uniquely
 * identified, curated types. An inferred or absent type fails closed.
 */
export function typeCompatible(requestType: string | undefined, entry: CatalogEntry, requestInferred = false): boolean {
  if (!requestType || requestInferred) return false;
  const entryConcept = uniqueBridgeConcept(entry.names[0] ?? '');
  return Boolean(entryConcept && !entryConcept.inferred && entryConcept.conceptType && requestType === entryConcept.conceptType);
}

export function resolveObject(
  concept: string,
  opts: VisualRequest,
  fullCatalog: CatalogEntry[] = allCatalogEntries(),
): ObjectResolution {
  // Filter before ranking (final_plan/02 §17, §19): other-family assets never compete inside a scene.
  const catalog = opts.sceneFamily ? fullCatalog.filter((entry) => isExemptFamily(entry.houseFamily) || entry.houseFamily === opts.sceneFamily) : fullCatalog;
  const conceptLower = normalizedName(concept);
  // Exact literals match the full referent after determiner/plural normalisation only. Head-noun
  // suffixes (keys[1..]) are deliberately NOT exact keys: "passive transport" must not resolve to
  // a "transport" icon (a wrong icon is worse than none); Visual Discovery reports them as partial.
  const wanted = new Set([conceptLower, singular(conceptLower), ...referentKeys(conceptLower).slice(0, 1)]);
  const exactOf = (entry: CatalogEntry): boolean => entry.names.some((name) => wanted.has(normalizedName(name)));
  const bridge = loadBridge();
  const bConcept = requestConcept(opts, concept);
  // One teaching concept may depict multiple literal referents. Exactness is
  // therefore judged against the depicted noun, not the broader source ID.
  const exactAllowed = !nameIsAmbiguous(concept);
  const exactCompatible = (entry: CatalogEntry): boolean => exactAllowed && exactOf(entry);
  const diagrams = bConcept ? bridgeDiagramsForConcept(bConcept.conceptId) : [];
  const diagramPreferred = opts.visualStrategy === 'diagram'
    || (opts.visualStrategy === undefined && bConcept?.preferredStrategies[0] === 'diagram');
  const unsupportedDiagram = diagramPreferred
    ? diagrams.map((diagram) => ({ diagram, adapter: classifyDiagramAdapter(diagram) })).find(({ adapter }) => adapter.status === 'rejected')
    : undefined;
  const diagramRejection = unsupportedDiagram?.adapter.status === 'rejected'
    ? {
      ref: unsupportedDiagram.diagram.ref,
      topology: unsupportedDiagram.diagram.topology,
      reasonCode: unsupportedDiagram.adapter.reasonCode,
      reason: unsupportedDiagram.adapter.reason,
      missingFields: unsupportedDiagram.adapter.missingFields,
    }
    : undefined;
  const base = { conceptId: bConcept?.conceptId, bridgeVersion: bridge.catalogVersion } as const;
  const labelText = opts.label ?? concept;
  const attachBadge = (visual: PrimitiveVisual, iconSize: { w: number; h: number }): PrimitiveVisual => (opts.badge ? composeBadge(visual, opts.badge, iconSize) : visual);

  // An explicit text request is a hard choice of the last-resort representation.
  // It must not be relabelled R10 or opportunistically upgraded to a catalog asset.
  if (opts.visualStrategy === 'text') {
    return {
      visual: minimalTextVisual(labelText, opts.size, opts.badge),
      resolution: {
        rung: 4, assetId: null, score: 0, license: 'manual', lane: 'text-only', source: 'generated',
        strategy: 'R11-minimal-text', selectionBasis: 'procedural', ...(diagramRejection ? { diagramRejection } : {}), ...base,
      },
    };
  }

  // Explicit labelled representation is a hard S6 choice: do not upgrade it
  // to an asset merely because retrieval happens to find a match.
  if (opts.visualStrategy === 'labelled') {
    return {
      visual: styledTextBoxVisual(labelText, opts.size, opts.badge),
      resolution: { rung: 4, assetId: null, score: 0, license: 'manual', lane: 'labelled-primitive', source: 'generated', strategy: 'R10-labelled-primitive', selectionBasis: 'procedural', ...(diagramRejection ? { diagramRejection } : {}), ...base },
    };
  }

  const renderEntry = (
    entry: CatalogEntry, score: number, rung: 2 | 3, strategy: ResolutionRecord['strategy'],
    selectionBasis: NonNullable<ResolutionRecord['selectionBasis']> = 'exact',
    extra?: Partial<ResolutionRecord>,
  ): ObjectResolution => {
    const norm = normalizeCatalogEntry(entry);
    const side = iconSide(opts.size, labelText);
    const icon = attachBadge(entry.render({ w: side, h: side }, opts.fill), { w: side, h: side });
    return {
      visual: withLabelBelow(icon, side, labelText, opts.size, opts.count),
      resolution: { rung, assetId: entry.id, score, license: entry.license, lane: norm.lane, source: entry.source, strategy, selectionBasis, ...(entry.houseFamily ? { houseFamily: entry.houseFamily } : {}), ...(diagramRejection ? { diagramRejection } : {}), ...base, ...extra },
    };
  };

  const usable = (entry: CatalogEntry): boolean => !opts.avoidAssetIds?.has(entry.id) && normalizeCatalogEntry(entry).ok;
  const exact = (source: (entry: CatalogEntry) => boolean): CatalogEntry | undefined => exactAllowed
    ? catalog.filter((entry) => usable(entry) && source(entry) && exactCompatible(entry)).sort((a, b) => Number(domainMatches(b, opts.lessonDomain)) - Number(domainMatches(a, opts.lessonDomain)) || a.id.localeCompare(b.id))[0]
    : undefined;
  const typed = (entry: CatalogEntry): boolean => typeCompatible(bConcept?.conceptType, entry, bConcept?.inferred ?? true);
  const similarity = (source: (entry: CatalogEntry) => boolean): { entry: CatalogEntry; score: number; rung: 2 | 3 } | undefined => {
    const candidateScores = new Map((opts.candidates ?? []).map((candidate) => [candidate.id, candidate.score]));
    return catalog.filter((entry) => usable(entry) && source(entry) && !exactOf(entry) && typed(entry))
      .map((entry) => ({ entry, score: candidateScores.get(entry.id) ?? (opts.candidates?.length ? 0 : semanticScore(conceptLower, entry)) }))
      .filter(({ entry, score }) => score >= (opts.candidates?.length ? TAU_MID_EMB : TAU_MID)
        // Mid-confidence similarity additionally needs the taxonomy domain to agree with the lesson (§17).
        && (score >= (opts.candidates?.length ? TAU_HIGH_EMB : TAU_HIGH) || domainMatches(entry, opts.lessonDomain)))
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
      .map(({ entry, score }) => ({ entry, score, rung: score >= (opts.candidates?.length ? TAU_HIGH_EMB : TAU_HIGH) ? 2 as const : 3 as const }))[0];
  };
  const downshift = (entry: CatalogEntry): boolean => entry.source.startsWith('assetlab-sketchy-downshift:');
  const flaticon = (entry: CatalogEntry): boolean => entry.source.startsWith('flaticon:');
  const streamline = (entry: CatalogEntry): boolean => entry.source.startsWith('streamline:');
  const sketchi = (entry: CatalogEntry): boolean => entry.source.startsWith('sketchi:');

  // R0 continuity is accepted only for a renderable, semantically compatible
  // referent. The independent B4 gate still judges the resulting depiction.
  // Explicit S6 representation intent is part of referent identity. A pin
  // collected under a different intent must not override it.
  if (opts.pin && (!opts.visualStrategy || opts.pin.requestedStrategy === opts.visualStrategy)) {
    const pinnedEntry = catalog.find((entry) => entry.id === opts.pin!.assetId);
    if (pinnedEntry && normalizeCatalogEntry(pinnedEntry).ok && (exactCompatible(pinnedEntry) || typed(pinnedEntry))) {
      return renderEntry(pinnedEntry, opts.pin.score, opts.pin.rung, 'R0-verified-pin', opts.pin.selectionBasis ?? 'similarity');
    }
    if (opts.pin.assetId.startsWith('core:')) {
      const role = opts.pin.assetId.slice('core:'.length);
      if (isSemanticRole(role) && opts.semanticRole === role) {
        const out = renderCoreRole(role, opts, base);
        out.resolution.strategy = 'R0-verified-pin';
        return out;
      }
    }
    if (opts.pin.assetId.startsWith('topo:')) {
      const role = opts.pin.assetId.slice('topo:'.length);
      const requested = (opts.semanticRole && isSemanticTopology(opts.semanticRole) ? opts.semanticRole : undefined)
        ?? (opts.template ? TEMPLATE_TOPOLOGY[opts.template] : undefined);
      const drawn = opts.visualStrategy === 'topology' && role === requested ? renderTopology(role, opts.size.w, opts.size.h) : undefined;
      if (drawn) {
        return {
          visual: attachBadge(drawn, opts.size),
          resolution: { rung: 2, assetId: opts.pin.assetId, score: opts.pin.score, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R0-verified-pin', selectionBasis: 'procedural', ...base },
        };
      }
    }
    // Metadata-only diagram refs cannot be pinned as compiled drawings; they
    // fall through and are resolved by an available truthful rung.
    // Stale or semantically incompatible pin: resolve from current request.
  }

  // R1 — diagram. Explicit strategy, or a bridge concept whose preferred
  // strategy is diagram-first (mechanisms explain better than literals).
  if ((opts.visualStrategy === 'diagram' && diagrams.length > 0) || (opts.visualStrategy === undefined && bConcept?.preferredStrategies[0] === 'diagram' && diagrams.length > 0)) {
    const compiled = diagrams
      .map((diagram) => ({ diagram, adapter: classifyDiagramAdapter(diagram) }))
      .filter((item): item is { diagram: typeof diagrams[number]; adapter: { status: 'compiled'; topology: string } } => item.adapter.status === 'compiled')
      .sort((a, b) => a.diagram.ref.localeCompare(b.diagram.ref))[0];
    const diagramSide = iconSide(opts.size, labelText);
    const drawn = compiled ? renderTopology(compiled.adapter.topology, diagramSide, diagramSide) : undefined;
    if (drawn && compiled) {
      return {
        visual: withLabelBelow(attachBadge(drawn, { w: diagramSide, h: diagramSide }), diagramSide, labelText, opts.size, opts.count),
        resolution: { rung: 2, assetId: `diagram:${compiled.diagram.ref}`, score: 0.9, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R1-diagram', selectionBasis: 'procedural', diagramRef: compiled.diagram.ref, ...base },
      };
    }
  }

  // A role glyph must not replace a real pictorial object (Simi §6/§38: literal first, geometry for
  // abstractions). When S6 requested a role for a referent that has an exact literal asset and the referent
  // is not itself a role name, the literal wins.
  const literalAvailable = exactAllowed && catalog.some((entry) => usable(entry) && exactCompatible(entry));
  const roleUpgradedToLiteral = opts.visualStrategy === 'semantic-core' && literalAvailable && !isSemanticRole(conceptLower);

  // R2 — semantic core role (explicit request only).
  if (!roleUpgradedToLiteral && opts.semanticRole && (opts.visualStrategy === undefined || opts.visualStrategy === 'semantic-core') && isSemanticRole(opts.semanticRole)) {
    return renderCoreRole(opts.semanticRole, opts, base);
  }

  // R3/R4 — exact literal assets from approved provider lanes.
  const permitsLiteral = opts.visualStrategy === undefined || opts.visualStrategy === 'literal' || opts.visualStrategy === 'retrieval' || roleUpgradedToLiteral;
  const permitsRetrieval = opts.visualStrategy === undefined || opts.visualStrategy === 'retrieval';
  if (permitsLiteral && opts.validatedAssetId) {
    const validated = catalog.find((entry) => entry.id === opts.validatedAssetId);
    if (validated && usable(validated)) {
      const strategy = downshift(validated) ? 'R3-house-literal' : flaticon(validated) ? 'R4-curated-flaticon' : streamline(validated) ? 'R6-typed-streamline' : 'R8-ontology-fallback';
      return renderEntry(validated, 0.9, 2, strategy, 'curated');
    }
  }
  if (permitsLiteral) {
    const houseExact = exact(downshift);
    if (houseExact) return renderEntry(houseExact, 1, 2, 'R3-house-literal');
    const flaticonExact = exact(flaticon);
    if (flaticonExact) return renderEntry(flaticonExact, 1, 2, 'R4-curated-flaticon');
  }

  // R5 — approved metaphor (curated concept -> role or asset).
  const metaphor = APPROVED_METAPHORS[bConcept?.conceptId ?? ''] ?? APPROVED_METAPHORS[referentKeys(conceptLower)[0] ?? conceptLower] ?? APPROVED_METAPHORS[conceptLower];
  if (metaphor && (opts.visualStrategy === undefined || opts.visualStrategy === 'metaphor')) {
    if (metaphor.role && isSemanticRole(metaphor.role)) {
      const out = renderCoreRole(metaphor.role, opts, base);
      out.resolution.strategy = 'R5-approved-metaphor';
      out.resolution.reconnectTerm = metaphor.reconnectTerm;
      return out;
    }
    if (metaphor.topology) {
      const drawn = renderTopology(metaphor.topology, iconSide(opts.size, labelText), iconSide(opts.size, labelText));
      if (drawn) {
        const side = iconSide(opts.size, labelText);
        return {
          visual: withLabelBelow(attachBadge(drawn, { w: side, h: side }), side, labelText, opts.size, opts.count),
          resolution: { rung: 2, assetId: `topo:${metaphor.topology}`, score: 0.85, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R5-approved-metaphor', selectionBasis: 'curated', reconnectTerm: metaphor.reconnectTerm, ...base },
        };
      }
    }
    if (metaphor.asset) {
      const entry = catalog.find((e) => e.id === metaphor.asset);
      if (entry && normalizeCatalogEntry(entry).ok) return renderEntry(entry, 0.85, 2, 'R5-approved-metaphor', 'curated');
    }
  }

  // R6/R7 — provider-specific literal retrieval. Similarity still requires
  // curated type on both sides; an exact literal needs an unambiguous referent.
  if (permitsRetrieval) {
    const streamlineExact = exact(streamline);
    if (streamlineExact) return renderEntry(streamlineExact, 1, 2, 'R6-typed-streamline');
    const streamlineMatch = similarity(streamline);
    if (streamlineMatch) return renderEntry(streamlineMatch.entry, streamlineMatch.score, streamlineMatch.rung, 'R6-typed-streamline', 'similarity');
    const sketchiExact = exact(sketchi);
    if (sketchiExact) return renderEntry(sketchiExact, 1, 2, 'R7-technical-brand');
    const sketchiMatch = similarity(sketchi);
    if (sketchiMatch) return renderEntry(sketchiMatch.entry, sketchiMatch.score, sketchiMatch.rung, 'R7-technical-brand', 'similarity');
  }

  // R8 — other approved catalog assets. Keep literal exactness before any
  // similarity result; the latter is strictly type-gated.
  const other = (entry: CatalogEntry): boolean => !downshift(entry) && !flaticon(entry) && !streamline(entry) && !sketchi(entry);
  if (permitsLiteral) {
    const otherExact = exact(other);
    if (otherExact) return renderEntry(otherExact, 1, 2, 'R8-ontology-fallback');
  }
  if (permitsRetrieval) {
    const otherMatch = similarity(other);
    if (otherMatch) return renderEntry(otherMatch.entry, otherMatch.score, otherMatch.rung, 'R8-ontology-fallback', 'similarity');
    const houseMatch = similarity(downshift);
    if (houseMatch) return renderEntry(houseMatch.entry, houseMatch.score, houseMatch.rung, 'R8-ontology-fallback', 'similarity');
  }

  // R9 — state/topology fallback (explicit strategy only). Rung 2, not 3:
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
          resolution: { rung: 2, assetId: `topo:${topoName}`, score: 0.8, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R9-state-topology', selectionBasis: 'procedural', semanticRole: opts.semanticRole, ...base },
        };
      }
    }
  }

  // R10/R11: always resolve. No unlicensed/unresolvable asset reaches rendering.
  const fallbackLabel = opts.label ?? concept;
  const labelled = fallbackLabel.trim().length > 0;
  const visual = labelled
    ? styledTextBoxVisual(fallbackLabel, opts.size, opts.badge)
    : minimalTextVisual(fallbackLabel, opts.size, opts.badge);
  return {
    visual,
    resolution: {
      rung: 4, assetId: null, score: opts.candidates?.[0]?.score ?? 0, license: 'manual',
      lane: labelled ? 'labelled-primitive' : 'text-only', source: 'generated',
      strategy: labelled ? 'R10-labelled-primitive' : 'R11-minimal-text', selectionBasis: 'procedural', ...(diagramRejection ? { diagramRejection } : {}), ...base,
    },
  };
}

/** Render a semantic-core role with its concept label (R2/R5). */
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
      resolution: { rung: 4, assetId: null, score: 0, license: 'manual', lane: 'labelled-primitive', source: 'generated', strategy: 'R10-labelled-primitive', selectionBasis: 'procedural', semanticRole: role, ...base },
    };
  }
  const icon = opts.badge ? composeBadge(drawn, opts.badge, { w: side, h: side }) : drawn;
  return {
    visual: withLabelBelow(icon, side, labelText, opts.size, opts.count),
    resolution: { rung: 2, assetId: `core:${role}`, score: 0.9, license: 'manual', lane: 'procedural', source: 'semantic-core', strategy: 'R2-semantic-core', selectionBasis: 'procedural', semanticRole: role, ...base },
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

import type { TemplateId } from '../layout/templates/catalog.js';
/**
 * Claude-track pipeline types (claude_pipeline.md).
 *
 * Ordering this file encodes and must never violate:
 *   TeachingBeat[] -> marked NarrationScript -> AlignedAudio (TTS+forced align)
 *   -> resolved mention timestamps -> SceneSpec (hand-authored or Scene Planner)
 *   -> ResolvedScene (catalog/primitive ladder) -> LaidOutScene (deterministic template layout)
 *   -> Timeline (mention-anchored) -> rendered SVG/video.
 *
 * No stage below S8 (layout) ever carries model-chosen coordinates: SceneSpec
 * elements only carry an `anchor` and optional `slot`; concrete x/y/w/h are
 * produced exclusively by the layout solver.
 */

// ---------------------------------------------------------------------------
// S4 — Marked narration
// ---------------------------------------------------------------------------

/** A single `[[id|spoken phrase]]` occurrence found in raw scripted text. */
export interface RawMention {
  id: string;
  phrase: string;
  /** Character offset of the mention's phrase text within the STRIPPED (plain) text. */
  plainStart: number;
  plainEnd: number;
}

/** Exact spoken substring attributed to one source-backed essential claim. */
export interface SpokenClaimSpan {
  claimId: string;
  exactText: string;
  /** Character offsets within NarrationScene.plainText, derived by code. */
  plainStart: number;
  plainEnd: number;
}

export interface NarrationScene {
  sceneId: string;
  sectionId: string;
  /** Raw text, markers intact: "The [[q|query]] compares..." */
  rawText: string;
  /** Text with markers stripped to their spoken phrase: "The query compares..." */
  plainText: string;
  mentions: RawMention[];
  /** Present on generated lessons; absent only on older/uncontracted scene inputs. */
  claimSpans?: SpokenClaimSpan[];
}

export interface NarrationScript {
  schemaVersion: 'claude-narration-script/v1';
  scenes: NarrationScene[];
}

// ---------------------------------------------------------------------------
// S5 — Voice + forced alignment (fixture mode: deterministic word timings)
// ---------------------------------------------------------------------------

export interface AlignedWord {
  w: string;
  startMs: number;
  endMs: number;
}

export interface ResolvedMention {
  sceneId: string;
  mentionId: string;
  startMs: number;
  endMs: number;
  /** true when more than one candidate span matched and the first was chosen deterministically. */
  ambiguous: boolean;
  /** word index range consumed, inclusive-exclusive, for downstream cursor advancement/debugging. */
  wordRange: [number, number];
}

export interface AlignedAudio {
  schemaVersion: 'claude-aligned-audio/v1';
  /**
   * 'fixture' for deterministic fixture-mode timings; otherwise the aligner
   * identity that actually produced this audio's timings (see
   * shared/alignment/align.ts's AlignerIdentity). For audio stitched from
   * multiple independently-aligned scenes, this is the most-escalated
   * aligner among the contributing scenes (pass order: stable-ts ->
   * stable-ts-fast-mode -> torchaudio-wav2vec2-ctc -> stable-ts+collapsed-repair).
   */
  provider: 'fixture' | 'stable-ts' | 'stable-ts-fast-mode' | 'torchaudio-wav2vec2-ctc' | 'stable-ts+collapsed-repair';
  wavPath: string;
  durationMs: number;
  /** Per scene, in narration order, word timings covering that scene's plainText only. */
  sceneWords: Record<string, AlignedWord[]>;
  /** Absolute [startMs,endMs) each scene occupies on the shared audio master clock. */
  sceneBoundsMs: Record<string, { startMs: number; endMs: number }>;
  mentions: ResolvedMention[];
}

export interface MentionResolutionFailure {
  sceneId: string;
  mentionId: string;
  phrase: string;
  reason: 'missing-span' | 'empty-phrase';
}

// ---------------------------------------------------------------------------
// S6/S7 — Scene DSL (SceneSpec) — the LLM/hand-authored boundary
// ---------------------------------------------------------------------------

export type PaletteToken = 'blue' | 'yellow' | 'green' | 'orange' | 'purple' | 'red' | 'grey' | 'none';

export type Anchor = `mention:${string}` | `after:${string}` | 'sceneStart';

export type Badge = '✓' | '✗' | '?' | '!' | '$' | '⚠' | '↑' | '↓' | '⏱' | '🔒' | '★' | '+' | '−';

export type Glyph = '?' | '!' | '✓' | '✗' | '$' | 'Σ';

export type OperatorSymbol = '×' | '+' | '−' | '÷' | 'Σ' | '∫' | '=' | '→' | 'softmax';

export type { TemplateId };
import type { MoleculeGraph, ReactionGraph } from '../render/chemistry.js';

interface ElementBase {
  id: string;
  slot?: string;
  anchor: Anchor;
  label?: string;
  fill?: PaletteToken;
  /** S2 concept IDs represented by this element; the renderer ignores this semantic link. */
  conceptIds?: string[];
  evidenceRefs?: EvidenceReference[];
  origin?: 'illustrative-example' | 'fixture';
  /** Audit only: whether a board icon was a retrieval hint for its mention or a teacher metaphor from the catalog. */
  iconBasis?: 'retrieval' | 'metaphor';
  /**
   * S6 semantic request (Teaching Compiler V1 §4). The resolver — never the
   * planner — chooses the physical asset. All optional; absent fields fall
   * through the R0–R9 ladder by name matching. The renderer ignores these.
   */
  semanticRole?: string;
  visualStrategy?: 'diagram' | 'semantic-core' | 'literal' | 'metaphor' | 'retrieval' | 'topology' | 'labelled' | 'text';
}

export type ElementBody =
  | { prim: 'box'; text?: string; glyph?: Glyph }
  | { prim: 'pill'; text: string }
  | { prim: 'tokenStrip'; tokens: string[]; highlight?: number[] }
  | { prim: 'operator'; symbol: OperatorSymbol }
  | { prim: 'meter'; values: number[]; labels?: string[] }
  | { prim: 'matrix'; rows: string[][] }
  | { prim: 'formula'; latex?: string; parts?: FormulaPart[] }
  | { prim: 'container'; children: string[]; style: 'solid' | 'dashed' }
  | { prim: 'cylinder'; text?: string }
  | { prim: 'stack'; count: number; text?: string }
  | { prim: 'axis'; kind: 'line' | 'curve' | 'bars'; points?: number[][] }
  | { prim: 'hill'; peaks: number[]; marker?: number }
  | { prim: 'object'; concept: string; badge?: Badge; count?: number }
  | { prim: 'text'; text: string; size: 'title' | 'body' | 'note' }
  | CodeBody
  | ChemistryBody
  | PlotBody
  | NumberLineBody
  | ShapeBody;

/** Geometry drawn by code (math figures): side labels are placed on the sides, a right angle gets its corner mark. */
export interface ShapeBody {
  prim: 'shape';
  kind: 'rightTriangle' | 'triangle' | 'square' | 'rectangle' | 'circle';
  /** rightTriangle/triangle: [vertical leg, base, third side]; square/rectangle: [bottom, right]; circle: [radius]. */
  sideLabels?: string[];
  text?: string;
}

/**
 * One term of a formula written term by term (reveal-by-meaning): parts
 * without an anchor appear with the formula; anchored parts appear when
 * their mention is spoken. Exactly one of `latex` / `parts` is set.
 */
export interface FormulaPart {
  tex: string;
  anchor?: Anchor;
}

/** Closed function family: the model picks a family and parameters; code samples the curve. No model-written points or code. */
export type PlotFn = 'linear' | 'quadratic' | 'cubic' | 'sine' | 'exp' | 'log' | 'normal';

export interface PlotBody {
  prim: 'plot';
  fn: PlotFn;
  params: number[];
  domain: [number, number];
  markers?: Array<{ x: number; label?: string }>;
  /** Draw the tangent line at this x (slope intuition, derivatives). */
  tangentAt?: number;
  tangentAnchor?: Anchor;
  /** Successive x positions walked along the curve (e.g. gradient-descent steps). */
  trajectory?: number[];
  stepsAnchor?: Anchor;
  /** Rise/run triangle between two x positions on the curve (slope as rise over run). */
  riseRun?: [number, number];
  riseRunAnchor?: Anchor;
  xLabel?: string;
  yLabel?: string;
}

export interface NumberLineBody {
  prim: 'numberLine';
  min: number;
  max: number;
  ticks: number;
  points?: Array<{ x: number; label?: string }>;
  interval?: [number, number];
}

/** Static, display-only source excerpt. The pipeline never evaluates or executes this text. */
export interface CodeBody {
  prim: 'code';
  language: 'python' | 'javascript' | 'typescript' | 'sql' | 'pseudocode';
  /** Literal source, preserving spaces, case, punctuation, and LF line breaks. */
  source: string;
}

/** Exact, explicit chemistry. The cited source must state the computed expression. */
export type ChemistryBody =
  | { prim: 'molecule'; molecule: MoleculeGraph; structureNotation: string }
  | { prim: 'reaction'; reaction: ReactionGraph; structureNotation: string };

export type Element = ElementBase & ElementBody;

export interface Edge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
  /** 'none' draws no arrowhead (symmetric relations such as comparison). Default: one head at `to`. */
  head?: 'forward' | 'none';
  anchor?: Anchor;
  evidenceRefs?: EvidenceReference[];
  origin?: 'illustrative-example' | 'fixture';
  factualRelation?: {
    fromConceptId: string;
    toConceptId: string;
    type: 'causes' | 'feeds' | 'contains' | 'compares' | 'transforms' | 'requires' | 'produces' | 'opposes';
    evidenceRefs: EvidenceReference[];
  };
}

export type VisualDepictionStrategy = 'literal' | 'process' | 'comparison' | 'quantitative' | 'labelled-diagram';

export type VisualIntentTarget =
  | { kind: 'element'; elementId: string; evidenceSpanIds?: string[] }
  | { kind: 'edge'; fromElementId: string; toElementId: string; relationType: NonNullable<Edge['factualRelation']>['type']; evidenceSpanIds?: string[] };

/** A planner assertion is auditable but never itself proof of claim coverage. */
export interface VisualIntent {
  claimId: string;
  strategy: VisualDepictionStrategy;
  targets: VisualIntentTarget[];
}

/** Semantic requirements preserved from a validated board-v3 plan. */
export interface BoardIntent {
  schemaVersion: 'typed-board-intent/v4-layout-recipes';
  layout: 'flow' | 'fan_out' | 'convergence' | 'list' | 'compare' | 'cycle' | 'hub' | 'hierarchy_tree' | 'decision_tree' | 'timeline' | 'rule_exception' | 'claim_evidence';
  visualKind: 'process' | 'plain' | 'comparison' | 'worked-example' | 'formula' | 'code' | 'molecule' | 'reaction' | 'plot' | 'matrix' | 'number-line' | 'array' | 'geometry';
  roles: Array<{ elementId: string; role: 'input' | 'process' | 'output' | 'item' | 'attribute' | 'root' | 'branch' | 'leaf' | 'outcome' | 'event' | 'rule' | 'exception' | 'consequence' | 'claim' | 'evidence' }>;
  /** Concepts required by the source-derived scene contract; empty for uncontracted boards. */
  requiredConceptIds: string[];
  /** Source-backed relations required by the current scene's teaching context. */
  requiredRelations: Array<{
    from: string;
    to: string;
    type: NonNullable<Edge['factualRelation']>['type'];
    evidenceRefs: EvidenceReference[];
  }>;
  /** Claim-to-depiction links compiled from the validated S6 board. */
  visualIntents: VisualIntent[];
}

export interface SceneSpec {
  schemaVersion: 'claude-scene-spec/v1';
  sceneId: string;
  title: string;
  template: TemplateId;
  elements: Element[];
  edges: Edge[];
  focus?: string[];
  carryOver?: string[];
  titleConceptIds?: string[];
  titleEvidenceRefs?: EvidenceReference[];
  titleOrigin?: 'illustrative-example' | 'fixture';
  boardIntent?: BoardIntent;
}

// ---------------------------------------------------------------------------
// S7 — Resolution ladder output
// ---------------------------------------------------------------------------

export type NormalizationLane = 'simple-symbol' | 'rich-illustration' | 'procedural' | 'text-fallback' | 'labelled-primitive' | 'text-only';

/** Rung of the Teaching Compiler V1 resolution ladder (R0–R11). */
export type ResolutionStrategy =
  | 'R0-verified-pin'
  | 'R1-diagram'
  | 'R2-semantic-core'
  | 'R3-house-literal'
  | 'R4-curated-flaticon'
  | 'R5-approved-metaphor'
  | 'R6-typed-streamline'
  | 'R7-technical-brand'
  | 'R8-ontology-fallback'
  | 'R9-state-topology'
  | 'R10-labelled-primitive'
  | 'R11-minimal-text';

export interface ResolutionRecord {
  rung: 2 | 3 | 4;
  assetId: string | null;
  score: number;
  license: string;
  lane: NormalizationLane;
  source: string;
  /** Which canonical ladder rung produced this resolution. */
  strategy?: ResolutionStrategy;
  /** Why the selected representation is safe to associate with the request. */
  selectionBasis?: 'exact' | 'curated' | 'similarity' | 'procedural';
  /** Bridge concept id the request resolved against, when known. */
  conceptId?: string;
  /** R5 only: the real term the narration must reconnect the metaphor to (Simi benchmark §40). */
  reconnectTerm?: string;
  /** Normalised house family of the selected asset (one primary family per scene, final_plan/02 §19). */
  houseFamily?: string;
  /** R1 specs without a V1 procedural adapter are explicitly recorded before fallback. */
  diagramRejection?: {
    ref: string;
    topology: string;
    reasonCode: 'SPEC_ONLY_NOT_INSTANTIATED' | 'USE_EXACT_RENDERER' | 'UNSUPPORTED_TOPOLOGY';
    reason: string;
    missingFields: string[];
  };
  /** Semantic role served (R2/R7), when requested. */
  semanticRole?: string;
  /** Diagram ref served (R1), when requested. */
  diagramRef?: string;
  /** Bridge catalogVersion backing this resolution (provenance + cache identity). */
  bridgeVersion?: string;
}

/** A single drawable stroke path in an element's local coordinate space (origin top-left, sized to `intrinsicSize`). */
export interface StrokePath {
  d: string;
  length: number;
  /** Stroke width in the path's own (pre-transform) units; defaults to STYLE.stroke.width. */
  width?: number;
  /** Optional SVG transform placing the path in the element's local frame (e.g. an icon's viewBox scale). `length` stays in pre-transform units, which is what stroke-dasharray uses. */
  transform?: string;
  /** Screen px per `length` unit when `transform` scales the path (default 1); used for reveal timing and pen order. */
  pxScale?: number;
  /** Sub-group revealed by its own anchored `term` event (e.g. a plot's tangent or descent steps); ungrouped paths draw with the element. */
  group?: string;
  /** Colour of a designed detail stroke (e.g. a white check mark); omitted for the ink outline. */
  color?: string;
  /** S8 Rough.js provenance carried into the lock with its fixed path bytes. */
  roughSeed?: number;
  roughProfileVersion?: string;
}

export interface FillShape {
  d: string;
  fill: string;
  transform?: string;
  fillRule?: 'nonzero' | 'evenodd';
  group?: string;
}



export interface TextRun {
  x: number;
  y: number;
  text: string;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  group?: string;
  /** Preserve source whitespace for static code excerpts. */
  preserveSpace?: boolean;
}

/**
 * Primitive-rendering output (hypothesis/v1_claude/02 Day-1 contract):
 * separate stroke paths, fill shapes and text runs so the timeline/renderer
 * can reveal each independently (stroke draw-on, fill fade, text wipe) at any
 * requested timestamp without re-deriving geometry.
 */
export interface PrimitiveVisual {
  paths: StrokePath[];
  fills: FillShape[];
  texts: TextRun[];
  /** Pre-typeset vector content (MathJax formula glyphs), revealed with a wipe like text. */
  embeds?: EmbeddedSvg[];
}

export interface EmbeddedSvg {
  x: number;
  y: number;
  w: number;
  h: number;
  viewBox: string;
  body: string;
}

export interface ResolvedElement {
  element: Element;
  /** Only present for `prim: 'object'` elements; every other primitive resolves procedurally at rung 1 (implicit, not recorded). */
  resolution?: ResolutionRecord;
  /** Deterministic local-space visual for the resolved shape at full reveal, origin (0,0), sized to `intrinsicSize`. */
  visual: PrimitiveVisual;
  /** Intrinsic size in local (unscaled) units, used by the layout measurer. */
  intrinsicSize: { w: number; h: number };
  /** Sum of stroke path lengths in local units, for reveal-duration computation. */
  strokeLength: number;
}

export interface ResolvedScene {
  sceneId: string;
  title: string;
  template: TemplateId;
  elements: ResolvedElement[];
  edges: Edge[];
  focus: string[];
  carryOver: string[];
  boardIntent?: BoardIntent;
}

// ---------------------------------------------------------------------------
// S8 — Layout
// ---------------------------------------------------------------------------

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidOutElement {
  id: string;
  element: Element;
  resolution?: ResolutionRecord;
  visual: PrimitiveVisual;
  intrinsicSize: { w: number; h: number };
  strokeLength: number;
  bbox: BBox;
}

export interface RoutedEdge extends Edge {
  /** Straight or single-bend polyline points, from boundary to boundary (never centers). */
  points: Array<{ x: number; y: number }>;
  /** Fixed, seeded S8 edge ink; points remain the routing/topology geometry. */
  roughPath?: StrokePath;
  /** Where the edge label is drawn, chosen by layout to stay clear of nodes. */
  labelBox?: BBox;
  /** No clear position existed; the label overlaps a node (reported by the gates). */
  labelOverlapsNode?: boolean;
}

export interface LaidOutScene {
  sceneId: string;
  title: string;
  template: TemplateId;
  elements: LaidOutElement[];
  edges: RoutedEdge[];
  occupancy: number;
  carryOver: string[];
  focus: string[];
  boardIntent?: BoardIntent;
}

// ---------------------------------------------------------------------------
// S9 — Timeline
// ---------------------------------------------------------------------------

export type RevealTrack = 'stroke' | 'fill' | 'wipe' | 'grow' | 'emphasis' | 'hold' | 'edge' | 'term';

/**
 * Sub-phase durations (ms) inside ONE primary reveal event, in draw order:
 * outline strokes (sequenced path by path) -> fill fade -> label/text wipe.
 * Keeping them inside a single event means one element holds one
 * concurrency slot for its whole reveal (hypothesis/v1_claude/01 §7:
 * "fills fade in after its outline completes").
 */
export interface RevealPhases {
  strokeMs: number;
  fillMs: number;
  textMs: number;
}

export interface TimelineEvent {
  elementId: string;
  track: RevealTrack;
  t0: number;
  t1: number;
  /** Present on primary stroke/wipe/grow events. */
  phases?: RevealPhases;
  /** Present on `edge` events: index into LaidOutScene.edges. */
  edgeIndex?: number;
  /** Present on `term` events: the sub-group revealed (formula part `p<i>`, plot `tangent`/`steps`/`riseRun`). */
  group?: string;
  params?: unknown;
}

export interface Timeline {
  sceneId: string;
  events: TimelineEvent[];
  sceneStartMs: number;
  sceneEndMs: number;
}

// ---------------------------------------------------------------------------
// Pipeline-level failure record (mirrors shared RunFailure shape)
// ---------------------------------------------------------------------------

export interface StageFailure {
  code: string;
  stage: string;
  message: string;
  hard: boolean;
  failureClass?: 'P' | 'S' | 'C' | 'T' | 'R' | 'A';
}
import type { EvidenceReference } from './contracts.js';

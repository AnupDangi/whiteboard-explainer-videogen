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

export interface NarrationScene {
  sceneId: string;
  sectionId: string;
  /** Raw text, markers intact: "The [[q|query]] compares..." */
  rawText: string;
  /** Text with markers stripped to their spoken phrase: "The query compares..." */
  plainText: string;
  mentions: RawMention[];
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

export type TemplateId =
  | 'title_card'
  | 'hub_spoke'
  | 'chain'
  | 'convergence'
  | 'fan_out'
  | 'list_icon'
  | 'compare_2'
  | 'threshold'
  | 'weighted_blend'
  | 'layered_stack'
  | 'cycle'
  | 'formula_focus'
  | 'plot_focus';

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

export type Element = ElementBase & ElementBody;

export interface Edge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
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

/** Semantic requirements preserved from a validated board-v2 plan. */
export interface BoardIntent {
  schemaVersion: 'typed-board-intent/v1';
  layout: 'flow' | 'fan_out' | 'convergence' | 'list' | 'compare' | 'cycle' | 'hub';
  visualKind: 'process' | 'comparison' | 'worked-example' | 'formula' | 'plot' | 'matrix' | 'number-line';
  roles: Array<{ elementId: string; role: 'input' | 'process' | 'output' | 'item' | 'attribute' }>;
  /** Concepts required by the source-derived scene contract; empty for uncontracted boards. */
  requiredConceptIds: string[];
  /** Source-backed relations required by the current scene's teaching context. */
  requiredRelations: Array<{
    from: string;
    to: string;
    type: NonNullable<Edge['factualRelation']>['type'];
    evidenceRefs: EvidenceReference[];
  }>;
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

export type NormalizationLane = 'simple-symbol' | 'rich-illustration' | 'procedural' | 'text-fallback';

export interface ResolutionRecord {
  rung: 2 | 3 | 4;
  assetId: string | null;
  score: number;
  license: string;
  lane: NormalizationLane;
  source: string;
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
}
import type { EvidenceReference } from '../shared/contracts.js';

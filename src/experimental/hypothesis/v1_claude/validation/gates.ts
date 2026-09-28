import type { Edge, Element, LaidOutScene, ResolutionRecord, StageFailure, Timeline } from '../types.js';
import { TEMPLATE_SPECS } from '../templates/catalog.js';
import { withFailureClass } from '../../shared/failure-taxonomy.js';
import type { EvidenceReference, NeutralElement, NeutralTimelineEvent } from '../../shared/contracts.js';
import { MAX_CONCURRENT_REVEALS, MIN_READABLE_FONT_PX, STYLE } from '../style.js';

import { LICENSE_ALLOWLIST } from '../catalog/normalize.js';
import { maxIdleWindowMs, nominalRevealMs } from '../timeline/compile.js';
import { formulaSource } from '../render/math.js';

const evidenceKey = (ref: EvidenceReference): string => JSON.stringify([
  ref.sourceId, ref.spanId, ref.startChar, ref.endChar, ref.startLine, ref.endLine, ref.quote,
]);

/** Minimum element scale vs measured size: the solver's smallest deliberate factor (layout/solver.ts GROWTH_FACTORS). Anything smaller is silent over-shrink and fails loudly instead of rendering tiny. */
export const MIN_ELEMENT_SCALE = 0.6;

/**
 * Check the semantic structure retained by a compiled typed board. This does
 * not score visual quality; it only prevents a board from silently dropping
 * source-required concepts/relations or the explicit roles required by its
 * selected structural template.
 */
/** The parts of a scene the adequacy check reads; a compiled SceneSpec (before layout) satisfies it too. */
export interface BoardAdequacyInput {
  sceneId: string;
  template: LaidOutScene['template'];
  elements: ReadonlyArray<{ id: string; element: Element }>;
  edges: readonly Edge[];
  boardIntent?: LaidOutScene['boardIntent'];
}

export function typedBoardAdequacyFailures(scene: BoardAdequacyInput): StageFailure[] {
  const intent = scene.boardIntent;
  if (!intent) return [];
  const failures: StageFailure[] = [];
  const elementsByConcept = new Map<string, Array<BoardAdequacyInput['elements'][number]>>();
  for (const element of scene.elements) {
    for (const conceptId of element.element.conceptIds ?? []) {
      elementsByConcept.set(conceptId, [...(elementsByConcept.get(conceptId) ?? []), element]);
    }
  }

  for (const conceptId of intent.requiredConceptIds) {
    if (!elementsByConcept.has(conceptId)) {
      failures.push({ code: 'board-concept-omitted', stage: 'planner', message: `${scene.sceneId}: typed board omits required source concept ${conceptId}`, hard: true });
    }
  }

  for (const relation of intent.requiredRelations) {
    const edge = scene.edges.find((candidate) => candidate.factualRelation?.fromConceptId === relation.from
      && candidate.factualRelation.toConceptId === relation.to
      && candidate.factualRelation.type === relation.type
      && (elementsByConcept.get(relation.from) ?? []).some((element) => element.element.id === candidate.from)
      && (elementsByConcept.get(relation.to) ?? []).some((element) => element.element.id === candidate.to));
    const actualRefs = new Set((edge?.factualRelation?.evidenceRefs ?? []).map(evidenceKey));
    const expectedRefs = relation.evidenceRefs.map(evidenceKey);
    const evidenceMatches = expectedRefs.length > 0 && expectedRefs.some((ref) => actualRefs.has(ref));
    if (!edge || !evidenceMatches) {
      failures.push({
        code: 'board-relation-omitted', stage: 'planner',
        message: `${scene.sceneId}: typed board must draw and cite source relation ${relation.from} -[${relation.type}]-> ${relation.to}`,
        hard: true,
      });
    }
  }

  // Every declared semantic role must still point at a visible node and each
  // visible node must have at most one declared role. This catches role loss
  // or metadata detached from the actual rendered board.
  const ids = new Set(scene.elements.map((element) => element.id));
  const roleIds = new Set<string>();
  for (const role of intent.roles) {
    if (roleIds.has(role.elementId)) {
      failures.push({ code: 'board-role-duplicate', stage: 'planner', message: `${scene.sceneId}: typed board assigns multiple roles to ${role.elementId}`, hard: true });
      continue;
    }
    roleIds.add(role.elementId);
    const element = scene.elements.find((candidate) => candidate.id === role.elementId);
    if (!element || !ids.has(role.elementId) || !(element.element.conceptIds?.length)) {
      failures.push({ code: 'board-role-detached', stage: 'planner', message: `${scene.sceneId}: typed board role ${role.role} is not attached to a visible concept node (${role.elementId})`, hard: true });
    } else if (intent.layout === 'convergence' && scene.template === 'convergence') {
      // Structured visuals (formula/plot/…) keep the model's layout in the intent but place nodes as callouts.
      const expectedSlot = role.role === 'process' ? 'operator' : role.role === 'output' ? 'output' : role.role === 'input' ? 'input' : undefined;
      if (expectedSlot && element.element.slot !== expectedSlot) {
        failures.push({ code: 'board-role-misplaced', stage: 'planner', message: `${scene.sceneId}: convergence ${role.role} role ${role.elementId} must occupy the ${expectedSlot} slot`, hard: true });
      }
    }
  }
  if (intent.visualKind === 'process' && !intent.roles.some(({ role, elementId }) => role === 'process' && ids.has(elementId))) {
    failures.push({ code: 'board-role-incomplete', stage: 'planner', message: `${scene.sceneId}: process board intent requires a visible process-role node`, hard: true });
  }

  // These templates preserve their structural slots through SceneSpec ->
  // layout. Validate both the retained semantic intent and the visible slots.
  const slots = new Set(scene.elements.filter((element) => (element.element.conceptIds?.length ?? 0) > 0).map((element) => element.element.slot));
  const requiredSlots = TEMPLATE_SPECS[scene.template].requiredSlots ?? [];
  const missingSlots = requiredSlots.filter(({ slot }) => !slots.has(slot));
  if (missingSlots.length) {
    failures.push({
      code: 'board-role-incomplete', stage: 'planner',
      message: `${scene.sceneId}: ${scene.template} typed board is missing ${missingSlots.map(({ explanation }) => explanation).join(', ')}`,
      hard: true,
    });
  }

  return failures.map(withFailureClass);
}

/**
 * A weak catalog match shown as an icon teaches the wrong association: a wrong
 * icon is worse than no icon. Rung 3 is the weak-match zone (mid thresholds in
 * catalog/ladder.ts are explicitly uncalibrated starting points), so an object
 * element resolved there is a hard failure. The safe fallback is a labelled
 * primitive or short text (rung 4), never the doubtful asset.
 */
export interface AssetMismatchInput {
  sceneId: string;
  elements: ReadonlyArray<{
    id: string;
    element: Pick<Element, 'prim'> & { concept?: string; iconBasis?: Element['iconBasis'] };
    resolution?: ResolutionRecord;
  }>;
}

export function semanticAssetMismatchFailures(scene: AssetMismatchInput): StageFailure[] {
  const failures: StageFailure[] = [];
  for (const { id, element, resolution } of scene.elements) {
    if (element.prim !== 'object' || resolution?.rung !== 3) continue;
    failures.push({
      code: 'semantic-asset-mismatch', stage: 'resolve',
      message: `${scene.sceneId}: ${id} shows a weak catalog match for "${element.concept ?? id}" (asset ${resolution.assetId}, score ${resolution.score.toFixed(2)}, ${element.iconBasis ?? 'unknown basis'}); use a labelled primitive or short text instead`,
      hard: true,
    });
  }
  return failures.map(withFailureClass);
}

/** Review cue only: a word-only process may still be the right diagram for an abstract lesson. */
export function labelOnlyProcessWarnings(scene: BoardAdequacyInput): StageFailure[] {
  if (scene.boardIntent?.visualKind !== 'process') return [];
  const byId = new Map(scene.elements.map(({ id, element }) => [id, element]));
  const textOnly = (id: string): boolean => {
    const prim = byId.get(id)?.prim;
    return prim === 'box' || prim === 'pill' || prim === 'text';
  };
  return scene.edges
    .filter((edge) => edge.factualRelation && textOnly(edge.from) && textOnly(edge.to))
    .map((edge) => ({
      code: 'board-label-only-process', stage: 'planner' as const,
      message: `${scene.sceneId}: source relation ${edge.from} -> ${edge.to} is shown with text-only endpoints; review whether a geometric or state-change depiction would teach it more clearly`,
      hard: false,
    }));
}

/** Container elements are organizational (they hug their children) and are excluded from overlap/leaf accounting per claude_pipeline.md §20's "excluding declared containers/badges". */
export function toNeutralElements(scene: LaidOutScene): NeutralElement[] {
  return scene.elements
    .filter((e) => e.element.prim !== 'container')
    .map((e) => ({ id: `${scene.sceneId}:${e.id}`, kind: e.element.prim, label: e.element.label, bbox: e.bbox, sourceRef: e.resolution?.assetId ?? undefined, evidenceRefs: e.element.evidenceRefs }));
}

export function toNeutralEvents(scene: LaidOutScene, timeline: Timeline, timeOriginMs = 0): NeutralTimelineEvent[] {
  return timeline.events.map((ev) => {
    // An edge event is attributed to its source element (neutral bundles only know elements).
    // Guard an out-of-range edgeIndex: fall back to the raw elementId (an "a->b"
    // edge label no element carries), so the shared deterministicGates emits a
    // `dangling-event` hard failure instead of this throwing a TypeError.
    const edge = ev.track === 'edge' && ev.edgeIndex !== undefined ? scene.edges[ev.edgeIndex] : undefined;
    const from = edge?.from ?? ev.elementId;
    return {
    elementId: `${scene.sceneId}:${from}`,
    action: ev.track,
    // Timelines use the lesson clock; per-scene gates and module clips use a
    // local clock. Callers pass the scene/module start when validating those.
    startMs: ev.t0 - timeOriginMs,
    endMs: ev.t1 - timeOriginMs,
    anchor: scene.elements.find((e) => e.id === ev.elementId)?.element.anchor,
    pedagogicalHold: ev.track === 'hold',
    };
  });
}

/**
 * Track-specific hard gates beyond the shared neutral checks (claude_pipeline.md
 * §20). The shared `deterministicGates` (src/experimental/hypothesis/shared/evaluation.ts)
 * already covers schema/overlap/safe-area/timeline-bounds/av-sync/unsafe-svg/license
 * generically across both tracks; this adds the Claude-specific readability,
 * concurrency, and resolution-completeness checks.
 */
const isFactual = (element: Element): boolean => Boolean(element.conceptIds?.length || element.evidenceRefs?.length);
const isPrimaryReveal = (track: string): boolean => track !== 'hold' && track !== 'emphasis' && track !== 'edge' && track !== 'term';

/**
 * Source-backed content that never becomes visible: an element or relation
 * arrow with no reveal, or one squeezed to zero duration at the scene end.
 */
export function timelineVisibilityFailures(scene: LaidOutScene, timeline: Timeline): StageFailure[] {
  const failures: StageFailure[] = [];
  const endMs = timeline.sceneEndMs;
  const visible = (t0: number, t1: number) => t1 - t0 >= 1 && t0 < endMs - 1;
  for (const el of scene.elements) {
    if (!isFactual(el.element) || scene.carryOver?.includes(el.id)) continue;
    const reveal = timeline.events.find((event) => event.elementId === el.id && isPrimaryReveal(event.track));
    if (!reveal || !visible(reveal.t0, reveal.t1)) failures.push({ code: 'reveal-invisible', stage: 'timeline', message: `${scene.sceneId}: source-backed element ${el.id} is never visibly drawn before the scene ends`, hard: true });
  }
  scene.edges.forEach((edge, edgeIndex) => {
    if (!edge.factualRelation) return;
    const event = timeline.events.find((candidate) => candidate.track === 'edge' && candidate.edgeIndex === edgeIndex);
    if (!event || !visible(event.t0, event.t1)) failures.push({ code: 'reveal-invisible', stage: 'timeline', message: `${scene.sceneId}: source relation ${edge.from} -> ${edge.to} (${edge.factualRelation.type}) is never visibly drawn`, hard: true });
  });
  return failures.map(withFailureClass);
}

/** Reveals shortened below their nominal drawing time to fit the scene audio. */
function compressedReveals(scene: LaidOutScene, timeline: Timeline): { count: number; slowest: number } {
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  let count = 0;
  let slowest = 1;
  for (const event of timeline.events) {
    const el = event.phases ? byId.get(event.elementId) : undefined;
    if (!el) continue;
    const nominal = nominalRevealMs(el);
    const actual = event.t1 - event.t0;
    if (nominal > 0 && actual < nominal - 1) { count += 1; slowest = Math.min(slowest, actual / nominal); }
  }
  return { count, slowest };
}

export function runClaudeGates(scene: LaidOutScene, timeline: Timeline): { failures: StageFailure[]; warnings: StageFailure[] } {
  const failures: StageFailure[] = [];
  const warnings: StageFailure[] = [];

  // The retained S6 intent marks typed-board-v2 output. Older SceneSpec
  // artifacts omit it and remain backward-compatible without this gate.
  if (scene.boardIntent) {
    failures.push(...typedBoardAdequacyFailures(scene));
    warnings.push(...labelOnlyProcessWarnings(scene));
  }
  failures.push(...semanticAssetMismatchFailures(scene));

  for (const el of scene.elements) {
    if (el.element.prim === 'object' && !el.resolution) {
      failures.push({ code: 'unresolved-object', stage: 'resolve', message: `${el.id} is an object element with no resolution record`, hard: true });
    }
    if (el.resolution && !LICENSE_ALLOWLIST.includes(el.resolution.license)) {
      failures.push({ code: 'license', stage: 'resolve', message: `${el.id} resolved to an unlicensed asset (${el.resolution.license})`, hard: true });
    }
    const sy = el.bbox.h / Math.max(1e-6, el.intrinsicSize.h);
    for (const t of el.visual.texts) {
      const renderedPx = t.size * sy;
      if (renderedPx < MIN_READABLE_FONT_PX) {
        // G6 is a hard floor for every visible text run, including annotations.
        failures.push({ code: 'min-readable-text', stage: 'layout', message: `${el.id} label renders at ${renderedPx.toFixed(1)}px < ${MIN_READABLE_FONT_PX}px`, hard: true });
      }
    }
    // Small-element floor: a leaf scaled below the solver's smallest
    // deliberate factor is over-shrunk content, not a layout fit — fail hard
    // instead of rendering a tiny unreadable element. Containers are
    // excluded (their intrinsic size is a placeholder; the solver hugs them
    // to their children).
    if (el.element.prim !== 'container') {
      const scale = Math.min(el.bbox.w / Math.max(1e-6, el.intrinsicSize.w), sy);
      if (scale < MIN_ELEMENT_SCALE - 1e-9) {
        failures.push({ code: 'tiny-element', stage: 'layout', message: `${el.id} renders at ${(scale * 100).toFixed(0)}% of measured size, below the ${(MIN_ELEMENT_SCALE * 100).toFixed(0)}% readable floor`, hard: true });
      }
    }
  }

  // Concurrency: at most MAX_CONCURRENT_REVEALS element reveals active at any instant.
  // Arrows (`edge`) and formula terms (`term`) are sub-reveals of elements already on the board,
  // scheduled outside the element servers (timeline/compile.ts).
  const reveals = timeline.events.filter((e) => e.track !== 'hold' && e.track !== 'emphasis' && e.track !== 'edge' && e.track !== 'term');
  const boundaries = [...new Set(reveals.flatMap((e) => [e.t0, e.t1]))].sort((a, b) => a - b);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const mid = (boundaries[i] + boundaries[i + 1]) / 2;
    const active = reveals.filter((e) => e.t0 <= mid && mid < e.t1).length;
    if (active > MAX_CONCURRENT_REVEALS) {
      failures.push({ code: 'concurrency', stage: 'timeline', message: `${active} simultaneous reveals at ${mid}ms exceeds ${MAX_CONCURRENT_REVEALS}`, hard: true });
      break;
    }
  }

  // G5 occupancy at scene end: outside the band is a warning; a board that
  // leaves most of the frame empty is a hard failure (a draft, not a lesson).
  // Structured boards (formula / plot / matrix / number-line / worked-example,
  // by element prim or board visual kind) and compare boards (by board layout
  // or compare_2 template) carry meaning in few elements and are exempt.
  // Detection is structural only: element count, union-bbox occupancy, prims,
  // template, board intent — never lesson wording. A single-node board can be
  // scaled up to the sparse floor by occupancy growth, so <2 elements fails on
  // its own.
  const STRUCTURAL_PRIMS: string[] = ['formula', 'plot', 'matrix', 'numberLine'];
  const STRUCTURAL_VISUAL_KINDS: string[] = ['formula', 'plot', 'matrix', 'number-line', 'worked-example'];
  const structured = scene.elements.some((el) => STRUCTURAL_PRIMS.includes(el.element.prim))
    || (scene.boardIntent ? STRUCTURAL_VISUAL_KINDS.includes(scene.boardIntent.visualKind) : false);
  const compare = (scene.boardIntent?.layout === 'compare') || scene.template === 'compare_2';
  if (!structured && !compare && scene.elements.length > 0 && (scene.occupancy < STYLE.occupancy.sparse || scene.elements.length < 2)) {
    failures.push({ code: 'board-too-sparse', stage: 'layout', message: `board covers ${Math.round(scene.occupancy * 100)}% of the frame (< ${Math.round(STYLE.occupancy.sparse * 100)}%) with ${scene.elements.length} elements; it needs more or larger nodes`, hard: true });
  } else if (scene.occupancy < STYLE.occupancy.min || scene.occupancy > STYLE.occupancy.max) {
    warnings.push({ code: 'occupancy', stage: 'layout', message: `occupancy ${scene.occupancy.toFixed(2)} outside [${STYLE.occupancy.min}, ${STYLE.occupancy.max}]`, hard: false });
  }
  // G9 idle: the longest stretch, including the end of the scene, with no new
  // content drawn. Emphasis rings are filler and are reported, not counted.
  const idle = maxIdleWindowMs(timeline);
  if (idle > STYLE.motion.maxIdleMs) {
    const filled = idle - maxIdleWindowMs(timeline, { countEmphasis: true });
    warnings.push({ code: 'idle', stage: 'timeline', message: `${Math.round(idle)}ms without new content exceeds ${STYLE.motion.maxIdleMs}ms${filled > 0 ? ` (emphasis rings fill ${Math.round(filled)}ms of it)` : ''}`, hard: false });
  }
  failures.push(...timelineVisibilityFailures(scene, timeline));
  const compressed = compressedReveals(scene, timeline);
  if (compressed.count) {
    warnings.push({ code: 'timeline-compressed', stage: 'timeline', message: `${compressed.count} reveal(s) were sped up to fit the narration (fastest at ${Math.round(compressed.slowest * 100)}% of normal drawing time)`, hard: false });
  }
  const crowdedLabels = scene.edges.filter((edge) => edge.labelOverlapsNode).map((edge) => `${edge.from}->${edge.to}`);
  if (crowdedLabels.length) warnings.push({ code: 'edge-label-overlap', stage: 'layout', message: `no clear place for arrow label(s) ${crowdedLabels.join(', ')}; they overlap a node`, hard: false });
  // Formula error: a TeX expression MathJax could not typeset is a hard failure (hypothesis plan "formula error").
  for (const el of scene.elements) {
    if (el.element.prim === 'formula' && !(el.visual.embeds?.length)) {
      failures.push({ code: 'formula-error', stage: 'render', message: `${el.id}: MathJax could not typeset "${formulaSource(el.element)}"`, hard: true });
    }
  }

  if (scene.elements.length < 2 || scene.elements.length > 9) {
    warnings.push({ code: 'element-count', stage: 'planner', message: `scene has ${scene.elements.length} elements (expected 2-9)`, hard: false });
  }

  return { failures: failures.map(withFailureClass), warnings: warnings.map(withFailureClass) };
}

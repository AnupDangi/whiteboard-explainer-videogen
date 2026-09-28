import type { BoardIntent, LaidOutScene, StageFailure, Timeline } from '../types.js';
import type { EvidenceReference, NeutralElement, NeutralTimelineEvent } from '../../shared/contracts.js';
import { withFailureClass } from '../../shared/failure-taxonomy.js';
import { MAX_CONCURRENT_REVEALS, MIN_READABLE_FONT_PX, STYLE } from '../style.js';

import { LICENSE_ALLOWLIST } from '../catalog/normalize.js';
import { maxIdleWindowMs, revealPhases } from '../timeline/compile.js';
import { formulaSource } from '../render/math.js';

const evidenceKey = (ref: EvidenceReference): string => JSON.stringify([
  ref.sourceId, ref.spanId, ref.startChar, ref.endChar, ref.startLine, ref.endLine, ref.quote,
]);

/**
 * Check the semantic structure retained by a compiled typed board. This does
 * not score visual quality; it only prevents a board from silently dropping
 * source-required concepts/relations or the explicit roles required by its
 * selected structural template.
 */
export function typedBoardAdequacyFailures(
  scene: Pick<LaidOutScene, 'sceneId' | 'template' | 'elements' | 'edges' | 'boardIntent'>,
): StageFailure[] {
  const intent = scene.boardIntent;
  if (!intent) return [];
  const failures: StageFailure[] = [];
  const elementsByConcept = new Map<string, LaidOutScene['elements']>();
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
    } else if (intent.layout === 'convergence') {
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
  const requiredSlots: Array<{ slot: string; explanation: string }> = scene.template === 'convergence'
    ? [
      { slot: 'input', explanation: 'at least one input' },
      { slot: 'operator', explanation: 'a process/operator' },
      { slot: 'output', explanation: 'at least one output' },
    ]
    : scene.template === 'fan_out'
      ? [{ slot: 'source', explanation: 'a source' }, { slot: 'target', explanation: 'at least one target' }]
      : scene.template === 'hub_spoke'
        ? [{ slot: 'hub', explanation: 'a hub' }, { slot: 'spoke', explanation: 'at least one spoke' }]
        : scene.template === 'compare_2'
          ? [{ slot: 'left', explanation: 'a left alternative' }, { slot: 'right', explanation: 'a right alternative' }]
          : [];
  const missingSlots = requiredSlots.filter(({ slot }) => !slots.has(slot));
  if (missingSlots.length) {
    failures.push({
      code: 'board-role-incomplete', stage: 'planner',
      message: `${scene.sceneId}: ${scene.template} typed board is missing ${missingSlots.map(({ explanation }) => explanation).join(', ')}`,
      hard: true,
    });
  }

  // P1 taxonomy: pure label attached at the boundary; hard/soft unchanged.
  return failures.map(withFailureClass);
}

/** Minimum element scale vs measured size: the solver's smallest deliberate factor (layout/solver.ts GROWTH_FACTORS). Anything smaller is silent over-shrink and fails loudly here instead of rendering tiny. */
export const MIN_ELEMENT_SCALE = 0.6;

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
export function runClaudeGates(scene: LaidOutScene, timeline: Timeline): { failures: StageFailure[]; warnings: StageFailure[] } {
  const failures: StageFailure[] = [];
  const warnings: StageFailure[] = [];

  // The retained S6 intent marks typed-board-v2 output. Older SceneSpec
  // artifacts omit it and remain backward-compatible without this gate.
  if (scene.boardIntent) failures.push(...typedBoardAdequacyFailures(scene));

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

  // G5 occupancy band at scene end (Warn per hypothesis/v1_claude/03 §2).
  if (scene.occupancy < STYLE.occupancy.min || scene.occupancy > STYLE.occupancy.max) {
    warnings.push({ code: 'occupancy', stage: 'layout', message: `occupancy ${scene.occupancy.toFixed(2)} outside [${STYLE.occupancy.min}, ${STYLE.occupancy.max}]`, hard: false });
  }
  // G9 idle: no window longer than maxIdleMs without a reveal/edge/emphasis (Warn).
  const idle = maxIdleWindowMs(timeline);
  if (idle > STYLE.motion.maxIdleMs) {
    warnings.push({ code: 'idle', stage: 'timeline', message: `${Math.round(idle)}ms idle window exceeds ${STYLE.motion.maxIdleMs}ms`, hard: false });
  }
  // P4 audio-min: proportional compression (k < 1, timeline/compile.ts) and
  // idle-gap emphasis fills (compileTimelineFull) fit reveals to the audio
  // clock. Both are legitimate, but they were silent — a cramped draw had no
  // failure signal. Soft warnings only (never hard): they already flow into
  // the evaluation bundle via gateResult.warnings in both pipelines.
  const compressed: Array<{ id: string; k: number }> = [];
  for (const ev of timeline.events) {
    if (ev.track !== 'stroke' && ev.track !== 'wipe' && ev.track !== 'grow') continue;
    if (!ev.phases) continue;
    const el = scene.elements.find((candidate) => candidate.id === ev.elementId);
    if (!el) continue;
    const nominal = revealPhases(el).phases;
    const nominalTotal = nominal.strokeMs + nominal.fillMs + nominal.textMs;
    const actualTotal = ev.phases.strokeMs + ev.phases.fillMs + ev.phases.textMs;
    if (nominalTotal > 0 && nominalTotal - actualTotal > 0.5) {
      compressed.push({ id: ev.elementId, k: actualTotal / nominalTotal });
    }
  }
  if (compressed.length) {
    const minK = Math.min(...compressed.map((c) => c.k));
    warnings.push({ code: 'timeline-compressed', stage: 'timeline', message: `${scene.sceneId}: ${compressed.length} reveal(s) compressed to fit audio bounds (min k=${minK.toFixed(2)}): ${compressed.map((c) => c.id).join(', ')}`, hard: false });
  }
  // Idle-gap fills are `emphasis` events other than the closing focus
  // emphasis (focus id, last 400 ms of the scene). Those carry intent;
  // anything else is the compiler papering over a quiet window.
  const focusCloseT0 = Math.max(timeline.sceneStartMs, timeline.sceneEndMs - 400);
  const EPS_MS = 1e-6;
  const idleFilled = timeline.events.filter((ev) =>
    ev.track === 'emphasis'
    && !(Math.abs(ev.t0 - focusCloseT0) < EPS_MS && Math.abs(ev.t1 - timeline.sceneEndMs) < EPS_MS && (scene.focus ?? []).includes(ev.elementId)));
  if (idleFilled.length) {
    warnings.push({ code: 'timeline-idle-filled', stage: 'timeline', message: `${scene.sceneId}: ${idleFilled.length} idle-gap emphasis ring(s) fill quiet window(s) > ${STYLE.motion.maxIdleMs}ms on: ${[...new Set(idleFilled.map((e) => e.elementId))].join(', ')}`, hard: false });
  }
  // Formula error: a TeX expression MathJax could not typeset is a hard failure (hypothesis plan "formula error").
  for (const el of scene.elements) {
    if (el.element.prim === 'formula' && !(el.visual.embeds?.length)) {
      failures.push({ code: 'formula-error', stage: 'render', message: `${el.id}: MathJax could not typeset "${formulaSource(el.element)}"`, hard: true });
    }
  }

  if (scene.elements.length < 2 || scene.elements.length > 9) {
    warnings.push({ code: 'element-count', stage: 'planner', message: `scene has ${scene.elements.length} elements (expected 2-9)`, hard: false });
  }

  // board-too-sparse (hard): a non-structured, non-compare board that leaves
  // the frame near-empty is a content defect, not a style choice — the T8
  // planner minimum (3 nodes, except compare + structured visuals) only pays
  // off if layout enforces a fill floor. Structured boards (formula / plot /
  // matrix / number-line / worked-example, by element prim or board visual
  // kind) and compare boards (by board layout or compare_2 template) carry
  // meaning in few elements and are exempt. Detection is structural only:
  // element count, union-bbox occupancy, prims, template, board intent —
  // never lesson wording.
  const STRUCTURAL_PRIMS: string[] = ['formula', 'plot', 'matrix', 'numberLine'];
  const STRUCTURAL_VISUAL_KINDS: string[] = ['formula', 'plot', 'matrix', 'number-line', 'worked-example'];
  const structured = scene.elements.some((el) => STRUCTURAL_PRIMS.includes(el.element.prim))
    || (scene.boardIntent ? STRUCTURAL_VISUAL_KINDS.includes(scene.boardIntent.visualKind) : false);
  const compare = (scene.boardIntent?.layout === 'compare') || scene.template === 'compare_2';
  if (!structured && !compare && (scene.occupancy < STYLE.occupancy.hardMin || scene.elements.length < 2)) {
    failures.push({ code: 'board-too-sparse', stage: 'layout', message: `occupancy ${scene.occupancy.toFixed(2)} with ${scene.elements.length} elements is below the ${STYLE.occupancy.hardMin} floor`, hard: true });
  }

  // P1 taxonomy: pure labels attached at the boundary; hard/soft unchanged.
  return { failures: failures.map(withFailureClass), warnings: warnings.map(withFailureClass) };
}

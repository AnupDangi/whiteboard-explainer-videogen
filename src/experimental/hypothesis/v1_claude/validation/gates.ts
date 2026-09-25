import type { LaidOutScene, StageFailure, Timeline } from '../types.js';
import type { NeutralElement, NeutralTimelineEvent } from '../../shared/contracts.js';
import { MAX_CONCURRENT_REVEALS, MIN_READABLE_FONT_PX, STYLE } from '../style.js';

import { LICENSE_ALLOWLIST } from '../catalog/normalize.js';
import { maxIdleWindowMs } from '../timeline/compile.js';
import { formulaSource } from '../render/math.js';

/** Container elements are organizational (they hug their children) and are excluded from overlap/leaf accounting per claude_pipeline.md §20's "excluding declared containers/badges". */
export function toNeutralElements(scene: LaidOutScene): NeutralElement[] {
  return scene.elements
    .filter((e) => e.element.prim !== 'container')
    .map((e) => ({ id: `${scene.sceneId}:${e.id}`, kind: e.element.prim, label: e.element.label, bbox: e.bbox, sourceRef: e.resolution?.assetId ?? undefined, evidenceRefs: e.element.evidenceRefs }));
}

export function toNeutralEvents(scene: LaidOutScene, timeline: Timeline): NeutralTimelineEvent[] {
  return timeline.events.map((ev) => ({
    // An edge event is attributed to its source element (neutral bundles only know elements).
    elementId: `${scene.sceneId}:${ev.track === 'edge' && ev.edgeIndex !== undefined ? scene.edges[ev.edgeIndex].from : ev.elementId}`,
    action: ev.track,
    startMs: ev.t0,
    endMs: ev.t1,
    anchor: scene.elements.find((e) => e.id === ev.elementId)?.element.anchor,
    pedagogicalHold: ev.track === 'hold',
  }));
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
  // Formula error: a TeX expression MathJax could not typeset is a hard failure (hypothesis plan "formula error").
  for (const el of scene.elements) {
    if (el.element.prim === 'formula' && !(el.visual.embeds?.length)) {
      failures.push({ code: 'formula-error', stage: 'render', message: `${el.id}: MathJax could not typeset "${formulaSource(el.element)}"`, hard: true });
    }
  }

  if (scene.elements.length < 2 || scene.elements.length > 9) {
    warnings.push({ code: 'element-count', stage: 'planner', message: `scene has ${scene.elements.length} elements (expected 2-9)`, hard: false });
  }

  return { failures, warnings };
}

import type { ResolvedElement, ResolvedScene, SceneSpec } from './types.js';
import { measureElement } from './layout/measure.js';
import { renderPrimitive } from './render/primitives.js';
import { resolveObject } from './catalog/ladder.js';
import type { Candidate } from './catalog/semantic.js';
import { iconPinKey, type IconPin } from './catalog/iconPins.js';

/**
 * S7 — Resolution ladder. Every non-`object` primitive resolves procedurally
 * (implicit rung 1, not recorded per claude_pipeline.md §10 — only `object`
 * resolutions are scored/recorded). `object` elements run the catalog ladder
 * and are GUARANTEED to resolve (rung 4 is unconditional), so this function
 * never produces an element without a `visual` — an unresolved final element
 * would be a non-compensable hard failure downstream.
 */
export interface ResolveOptions {
  /** Embedding-ranked catalog candidates per lower-cased concept (catalog/semantic.ts rankConcepts), computed before this sync stage. */
  candidates?: Map<string, Candidate[]>;
  /** Lesson-level visual selections, keyed by source concept IDs and depicted referent. */
  pins?: ReadonlyMap<string, IconPin>;
}

export function resolveScene(spec: SceneSpec, options: ResolveOptions = {}): ResolvedScene {
  const elements: ResolvedElement[] = spec.elements.map((element) => {
    const intrinsicSize = measureElement(element);
    if (element.prim === 'object') {
      const { visual, resolution } = resolveObject(element.concept, {
        badge: element.badge,
        count: element.count,
        label: element.label ?? element.concept,
        fill: element.fill,
        candidates: options.candidates?.get(element.concept.trim().toLowerCase()),
        pin: options.pins?.get(iconPinKey(element)),
        size: intrinsicSize,
      });
      const strokeLength = visual.paths.reduce((s, p) => s + p.length * (p.pxScale ?? 1), 0);
      return { element, resolution, visual, intrinsicSize, strokeLength };
    }
    const visual = renderPrimitive(element, intrinsicSize);
    const strokeLength = visual.paths.reduce((s, p) => s + p.length, 0);
    return { element, visual, intrinsicSize, strokeLength };
  });

  return {
    sceneId: spec.sceneId,
    title: spec.title,
    template: spec.template,
    elements,
    edges: spec.edges,
    focus: spec.focus ?? [],
    carryOver: spec.carryOver ?? [],
    ...(spec.boardIntent ? { boardIntent: spec.boardIntent } : {}),
  };
}

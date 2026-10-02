import type { ResolvedElement, ResolvedScene, SceneSpec } from '../shared/types.js';
import { measureElement } from '../layout/measure.js';
import { renderPrimitive } from '../render/primitives.js';
import { resolveObject } from './ladder.js';
import { chooseSceneFamily } from './sceneFamily.js';
import type { Candidate } from './semantic.js';
import { iconPinKey, type IconPin } from './iconPins.js';

/**
 * S7 — Resolution ladder. Every non-`object` primitive resolves procedurally
 * (implicit rung 1, not recorded per claude_pipeline.md §10 — only `object`
 * resolutions are scored/recorded). `object` elements run the catalog ladder
 * and are GUARANTEED to resolve (rung 4 is unconditional), so this function
 * never produces an element without a `visual` — an unresolved final element
 * would be a non-compensable hard failure downstream.
 */
export interface PreviousSceneIcon {
  /** Concept label of the previous scene's object element (compared case-insensitively). */
  concept: string;
  /** Resolved asset id, or null for rung-4 text fallbacks (which cannot visually repeat). */
  assetId: string | null;
}

export interface ResolveOptions {
  /** Embedding-ranked catalog candidates per lower-cased concept (catalog/semantic.ts rankConcepts), computed before this sync stage. */
  candidates?: Map<string, Candidate[]>;
  /** Lesson-level visual selections, keyed by source concept IDs and depicted referent. */
  pins?: ReadonlyMap<string, IconPin>;
  /** Lower-cased referent -> catalog entry id confirmed by semantic validation (catalog/iconValidation.ts). */
  validated?: ReadonlyMap<string, string>;
  /** Lesson concept id -> validated catalog entry id (S3b Visual Discovery). */
  validatedByConcept?: ReadonlyMap<string, string>;
  /** Lesson domain for taxonomy preference among exact literals. */
  domain?: string;
  /** Icons used by the immediately previous scene, for cross-scene differentiation. */
  previousIcons?: ReadonlyArray<PreviousSceneIcon>;
}

/** Icons of a resolved scene's object elements, to feed the next scene's `previousIcons`. */
export function previousSceneIcons(resolved: ResolvedScene): PreviousSceneIcon[] {
  const out: PreviousSceneIcon[] = [];
  for (const e of resolved.elements) {
    if (e.element.prim !== 'object') continue;
    out.push({ concept: e.element.concept, assetId: e.resolution?.assetId ?? null });
  }
  return out;
}

const normConcept = (concept: string): string => concept.trim().toLowerCase();

export function resolveScene(spec: SceneSpec, options: ResolveOptions = {}): ResolvedScene {
  // Pass 1 (probe): resolve without a family constraint to see which families the scene wants.
  // Pass 2: lock the scene to the most-used family; assets of other families fall to the next rung.
  const probeFamilies = spec.elements.length && spec.elements.some((element) => element.prim === 'object')
    ? resolveElements(spec, options, undefined).map((entry) => entry.resolution?.houseFamily)
    : [];
  const sceneFamily = chooseSceneFamily(probeFamilies);
  const elements = resolveElements(spec, options, sceneFamily);
  return buildScene(spec, elements);
}

function resolveElements(spec: SceneSpec, options: ResolveOptions, sceneFamily: string | undefined): ResolvedElement[] {
  // One picture never stands for two different things in a scene: an icon an earlier element took is avoided by the
  // others (an element of the same concept keeps it, which is what pins mean).
  const usedInScene = new Map<string, string>();
  return spec.elements.map((element) => {
    const intrinsicSize = measureElement(element);
    if (element.prim === 'object') {
      // Cross-scene dedup: avoid the previous scene's icons except the one
      // that belongs to this same concept (same-concept repetition is
      // consistency, enforced by pins; different-concept repetition is the
      // contact-sheet defect this avoids). Concept comparison is normalized
      // text only — no topic knowledge.
      const avoid = [
        ...(options.previousIcons
          ?.filter((prev) => prev.assetId && normConcept(prev.concept) !== normConcept(element.concept))
          .map((prev) => prev.assetId as string) ?? []),
        ...[...usedInScene].filter(([, concept]) => concept !== normConcept(element.concept)).map(([assetId]) => assetId),
      ];
      const { visual, resolution } = resolveObject(element.concept, {
        badge: element.badge,
        count: element.count,
        label: element.label ?? element.concept,
        fill: element.fill,
        candidates: options.candidates?.get(element.concept.trim().toLowerCase()),
        pin: options.pins?.get(iconPinKey(element)),
        ...((options.validated?.get(normConcept(element.concept)) ?? (element.conceptIds?.[0] ? options.validatedByConcept?.get(element.conceptIds[0]) : undefined)) ? { validatedAssetId: (options.validated?.get(normConcept(element.concept)) ?? options.validatedByConcept?.get(element.conceptIds![0]!))! } : {}),
        ...(avoid?.length ? { avoidAssetIds: new Set(avoid) } : {}),
        size: intrinsicSize,
        ...(element.conceptIds?.[0] ? { conceptId: element.conceptIds[0] } : {}),
        ...(element.semanticRole ? { semanticRole: element.semanticRole } : {}),
        ...(element.visualStrategy ? { visualStrategy: element.visualStrategy } : {}),
        template: spec.template,
        ...(sceneFamily ? { sceneFamily } : {}),
        ...(options.domain ? { lessonDomain: options.domain } : {}),
      });
      const strokeLength = visual.paths.reduce((s, p) => s + p.length * (p.pxScale ?? 1), 0);
      if (resolution.assetId && !usedInScene.has(resolution.assetId)) usedInScene.set(resolution.assetId, normConcept(element.concept));
      return { element, resolution, visual, intrinsicSize, strokeLength };
    }
    const visual = renderPrimitive(element, intrinsicSize);
    const strokeLength = visual.paths.reduce((s, p) => s + p.length, 0);
    return { element, visual, intrinsicSize, strokeLength };
  });
}

function buildScene(spec: SceneSpec, elements: ResolvedElement[]): ResolvedScene {
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

import { createRequire } from 'node:module';
import type { RoughGenerator } from 'roughjs/bin/generator.js';
import { svgPathProperties } from 'svg-path-properties';
import { sha256 } from '../shared/artifacts.js';
import type { LaidOutElement, StrokePath } from '../shared/types.js';

export const ROUGH_RENDERER_VERSION = 'roughjs@4.6.6';
export const ROUGH_PROFILE_VERSION = 'classroom-ink/v1';

const rough = createRequire(import.meta.url)('roughjs') as { generator: () => RoughGenerator };

function seedFor(parts: readonly string[]): number {
  return Number.parseInt(sha256(parts.join('\0')).slice(0, 8), 16) || 1;
}

/** Compile one semantic path to fixed, seeded SVG strokes. */
export function roughenPath(path: StrokePath, seed: number): StrokePath[] {
  if (!path.d.trim()) return [path];
  const generator = rough.generator();
  const drawable = generator.path(path.d, {
    seed,
    roughness: 0.65,
    bowing: 0.35,
    stroke: path.color ?? '#172033',
    strokeWidth: path.width ?? 3,
    fill: 'none',
    disableMultiStroke: true,
    disableMultiStrokeFill: true,
    fixedDecimalPlaceDigits: 3,
  });
  return generator.toPaths(drawable).filter((item) => item.d.trim()).map((item) => ({
    ...path,
    d: item.d,
    length: new svgPathProperties(item.d).getTotalLength(),
    roughSeed: seed,
    roughProfileVersion: ROUGH_PROFILE_VERSION,
  }));
}

function supportsHandDrawnProfile(element: LaidOutElement): boolean {
  const primitive = element.element.prim;
  if (primitive === 'object') return element.resolution?.source === 'semantic-core';
  return !['formula', 'plot', 'numberLine', 'code', 'molecule', 'reaction'].includes(primitive);
}

/**
 * S8 compiles hand-drawn procedural strokes once. Exact adapters and approved
 * catalog SVGs remain untouched; the lock stores the resulting path bytes and
 * each deterministic seed, so S10 never invokes Rough.js.
 */
export function roughenElement(element: LaidOutElement, lessonId: string, sceneId: string): LaidOutElement {
  if (!supportsHandDrawnProfile(element)) return element;
  const paths = element.visual.paths.flatMap((path, index) => roughenPath(path, seedFor([
    ROUGH_RENDERER_VERSION,
    lessonId,
    sceneId,
    element.id,
    String(index),
    ROUGH_PROFILE_VERSION,
  ])));
  const strokeLength = paths.reduce((sum, path) => sum + path.length * (path.pxScale ?? 1), 0);
  return { ...element, visual: { ...element.visual, paths }, strokeLength };
}

export function roughenEdgePath(path: StrokePath, lessonId: string, sceneId: string, edgeIndex: number, edgeKey: string): StrokePath {
  const seed = seedFor([ROUGH_RENDERER_VERSION, lessonId, sceneId, edgeKey, String(edgeIndex), ROUGH_PROFILE_VERSION]);
  return roughenPath(path, seed)[0] ?? path;
}

// Stage L/M: fixed-seed Rough.js sketch geometry.
//
// Rule (chatgpt_pipeline.md): seed = hash(sceneId + elementId). Given the same
// (sceneId, elementId, shape params) this module must return byte-identical output on
// every call: it is invoked once per element per scene by the pipeline, never per frame,
// and its output backs a "nondeterministic render" hard-failure gate elsewhere in the
// system. No Math.random(), no Date.now(), no reliance on anything but the deterministic
// seeded RNG that roughjs itself derives from the numeric `seed` option.
//
// Coordinate convention: all shapes and the resulting path `d` strings are in the
// element's own LOCAL frame (origin at the element's box top-left, unscaled). The
// renderer composites an element by wrapping it in `translate(box.x, box.y)
// scale(box.scale)` — this module never needs (and never emits) absolute canvas
// coordinates, keeping generated geometry reusable independent of layout.

// roughjs's package entry point resolves (via "main") to a single-file CJS bundle
// (bundled/rough.cjs.js) with no submodule imports, so `import rough from 'roughjs'` is
// the only *runtime*-safe way to reach the generator: roughjs's `bin/*.js` sources use
// extensionless relative imports internally (e.g. `./fillers/hachure-filler`), which
// Node's ESM loader refuses to resolve, so importing `roughjs/bin/generator.js` directly
// works for `tsc --noEmit` type-checking but crashes at runtime with ERR_MODULE_NOT_FOUND.
// Types are still pulled from `bin/*.d.ts` (type-only imports are erased at compile time,
// so they never hit that broken runtime resolution path), and re-shaped into a small
// local interface because roughjs's default-export typing doesn't resolve cleanly under
// this project's NodeNext + esModuleInterop configuration.
import roughDefault from 'roughjs';
import type {Drawable, Options} from 'roughjs/bin/core.js';
import type {RoughGeometry} from './types.js';

interface RoughGeneratorLike {
  rectangle(x: number, y: number, width: number, height: number, options?: Options): Drawable;
  circle(x: number, y: number, diameter: number, options?: Options): Drawable;
  line(x1: number, y1: number, x2: number, y2: number, options?: Options): Drawable;
  path(d: string, options?: Options): Drawable;
  toPaths(drawable: Drawable): Array<{d: string; stroke: string; strokeWidth: number; fill?: string}>;
}

const rough = roughDefault as unknown as {
  generator(config?: {options?: Options}): RoughGeneratorLike;
};

// ---------------------------------------------------------------------------
// Deterministic string hash -> integer seed (FNV-1a, 32-bit).
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** seed = hash(sceneId + elementId), per chatgpt_pipeline.md. */
export function deriveSeed(sceneId: string, elementId: string): number {
  return fnv1aHash(`${sceneId}\u0000${elementId}`);
}

// ---------------------------------------------------------------------------
// Shape inputs (P0 primitives).
// ---------------------------------------------------------------------------

export type RoughShapeInput =
  | {kind: 'rectangle'; x: number; y: number; width: number; height: number}
  | {kind: 'circle'; x: number; y: number; diameter: number}
  | {kind: 'line'; x1: number; y1: number; x2: number; y2: number}
  | {kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; headSize?: number}
  | {kind: 'path'; d: string};

function buildDrawables(generator: RoughGeneratorLike, shape: RoughShapeInput): Drawable[] {
  switch (shape.kind) {
    case 'rectangle':
      return [generator.rectangle(shape.x, shape.y, shape.width, shape.height)];
    case 'circle':
      return [generator.circle(shape.x, shape.y, shape.diameter)];
    case 'line':
      return [generator.line(shape.x1, shape.y1, shape.x2, shape.y2)];
    case 'arrow': {
      const headSize = shape.headSize ?? Math.max(8, Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) * 0.12);
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
      const leftAngle = angle + Math.PI - Math.PI / 7;
      const rightAngle = angle + Math.PI + Math.PI / 7;
      const headLeftX = shape.x2 + headSize * Math.cos(leftAngle);
      const headLeftY = shape.y2 + headSize * Math.sin(leftAngle);
      const headRightX = shape.x2 + headSize * Math.cos(rightAngle);
      const headRightY = shape.y2 + headSize * Math.sin(rightAngle);
      // Arrow-as-two-lines (shaft + two head strokes), each generated in a fixed,
      // deterministic call order against the same seeded generator instance.
      return [
        generator.line(shape.x1, shape.y1, shape.x2, shape.y2),
        generator.line(shape.x2, shape.y2, headLeftX, headLeftY),
        generator.line(shape.x2, shape.y2, headRightX, headRightY),
      ];
    }
    case 'path':
      return [generator.path(shape.d)];
    default: {
      const exhaustive: never = shape;
      throw new Error(`Unknown rough shape kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Generate deterministic Rough.js sketch geometry for one element, once. Given the same
 * (sceneId, elementId, shape) it returns byte-identical `paths` on every call, because:
 *  1. the seed is a pure hash of (sceneId, elementId), and
 *  2. roughjs's own seeded PRNG is a pure function of that seed plus the fixed,
 *     in-order sequence of generator calls we make for a given shape.
 */
export function generateRoughGeometry(sceneId: string, elementId: string, shape: RoughShapeInput): RoughGeometry {
  const seed = deriveSeed(sceneId, elementId);
  const generator = rough.generator({options: {seed}});
  const drawables = buildDrawables(generator, shape);
  // roughjs already knows how to turn a Drawable's OpSets into path `d` strings via
  // generator.toPaths(); reuse that instead of hand-rolling SVG path serialization.
  const paths = drawables.flatMap((drawable) =>
    generator.toPaths(drawable).map((pathInfo) => ({d: pathInfo.d, strokeWidth: pathInfo.strokeWidth})),
  );
  return {seed, paths};
}

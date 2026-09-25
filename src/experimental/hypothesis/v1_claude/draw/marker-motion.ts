// Stage M: path-based marker motion. Given an already-generated SVG path `d` string
// (e.g. from rough-geometry.ts), find where a "pen/marker" sits at a given fraction of
// the path's total length, plus the direction it's travelling, so the renderer can move
// a marker glyph along the stroke while the ink is progressively revealed behind it.
//
// Pure arithmetic over the path definition: no randomness, no wall-clock, deterministic
// given the same (d, progress) input every time.

import {svgPathProperties} from 'svg-path-properties';

export interface MarkerPoint {
  x: number;
  y: number;
  angleDeg: number;
}

function safeAngleDeg(tangentX: number, tangentY: number): number {
  if (!Number.isFinite(tangentX) || !Number.isFinite(tangentY) || (tangentX === 0 && tangentY === 0)) {
    return 0;
  }
  return (Math.atan2(tangentY, tangentX) * 180) / Math.PI;
}

/**
 * Point + tangent direction at `progress` (0..1) along the total length of path `d`.
 * progress is clamped to [0,1] so callers can pass slightly-out-of-range values (e.g.
 * from an eased/overshooting animation curve) without throwing.
 */
export function markerAt(d: string, progress: number): MarkerPoint {
  const clamped = Math.min(1, Math.max(0, progress));
  const props = new svgPathProperties(d);
  const totalLength = props.getTotalLength();
  const lengthAtProgress = totalLength * clamped;
  const point = props.getPointAtLength(lengthAtProgress);
  if (totalLength === 0) {
    return {x: point.x, y: point.y, angleDeg: 0};
  }
  const tangent = props.getTangentAtLength(lengthAtProgress);
  return {x: point.x, y: point.y, angleDeg: safeAngleDeg(tangent.x, tangent.y)};
}

/** Total length in px of an SVG path `d` string. Shared with reveal-policy.ts so
 * StrokeReveal.totalLengthPx is derived from the exact same geometry the marker walks. */
export function pathLength(d: string): number {
  return new svgPathProperties(d).getTotalLength();
}

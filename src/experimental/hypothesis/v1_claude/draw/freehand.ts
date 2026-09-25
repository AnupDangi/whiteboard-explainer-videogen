// Stage N: perfect-freehand teacher annotation gestures.
//
// Each gesture (`FreehandStroke['gesture']` in types.ts) is a deterministic parametric
// point generator: a pure function of (sceneId, elementId, gesture, boundingBox) plus a
// seed derived exactly the way rough-geometry.ts derives its seed (FNV-1a hash of
// sceneId+elementId, salted with the gesture name so different gestures on the same
// element don't reuse identical jitter). Any "natural hand" jitter comes from a seeded
// mulberry32 PRNG — never Math.random() — so repeat calls are byte-identical.
//
// Coordinate convention: matches rough-geometry.ts — the `box` passed in is the
// element's own LOCAL frame (origin at the element's box top-left, unscaled).

import {getStroke} from 'perfect-freehand';
import type {StrokeOptions} from 'perfect-freehand';
import type {FreehandStroke} from './types.js';
import {fnv1aHash} from './rough-geometry.js';

export interface FreehandBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FreehandGesture = FreehandStroke['gesture'];

export interface FreehandGeometry {
  /** Raw input points, in the exact shape DrawPlan's FreehandStroke.points expects. */
  points: Array<[number, number, number?]>;
  /** Smoothed outline `d` string for the stroke polygon perfect-freehand computes from
   * those points. Not part of the DrawPlan schema (FreehandStroke only carries the raw
   * input points), but useful to a renderer/preview and exercised directly by tests. */
  d: string;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) seeded from the FNV-1a hash. Pure function of the
// seed and call count -- never Math.random().
// ---------------------------------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gestureSeed(sceneId: string, elementId: string, gesture: FreehandGesture): number {
  return fnv1aHash(`${sceneId}\u0000${elementId}\u0000${gesture}`);
}

// Always carry a concrete pressure value (never omitted) so this is directly assignable
// both to FreehandStroke.points (which allows an optional third element) and to
// perfect-freehand's getStroke() input type (which needs a plain number[]/tuple, not one
// with an optional last element).
type RawPoint = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Per-gesture raw point generators.
// ---------------------------------------------------------------------------

function underlinePoints(box: FreehandBox, rng: Rng): RawPoint[] {
  const y = box.y + box.h * 0.92;
  const xStart = box.x + box.w * 0.04;
  const xEnd = box.x + box.w * 0.96;
  const steps = 24;
  const points: RawPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const jitter = (rng() - 0.5) * box.h * 0.02;
    const pressure = 0.4 + 0.5 * Math.sin(Math.PI * t);
    points.push([lerp(xStart, xEnd, t), y + jitter, pressure]);
  }
  return points;
}

function circlePoints(box: FreehandBox, rng: Rng): RawPoint[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w * 0.48;
  const ry = box.h * 0.48;
  const steps = 48;
  // Slightly overshoot a full turn (like a hand-drawn circle that doesn't perfectly
  // close) and slightly under/over-shoot the radius for a natural wobble.
  const turns = 1.06;
  const points: RawPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const wobble = 1 + (rng() - 0.5) * 0.05;
    const pressure = 0.45 + 0.25 * Math.sin(t * 3);
    points.push([cx + Math.cos(t) * rx * wobble, cy + Math.sin(t) * ry * wobble, pressure]);
  }
  return points;
}

function segment(from: [number, number], to: [number, number], steps: number, pStart: number, pEnd: number, rng: Rng, jitterScale: number): RawPoint[] {
  const points: RawPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const jitter = (rng() - 0.5) * jitterScale;
    points.push([lerp(from[0], to[0], t) + jitter, lerp(from[1], to[1], t), lerp(pStart, pEnd, t)]);
  }
  return points;
}

function checkmarkPoints(box: FreehandBox, rng: Rng): RawPoint[] {
  const p0: [number, number] = [box.x + box.w * 0.15, box.y + box.h * 0.5];
  const p1: [number, number] = [box.x + box.w * 0.4, box.y + box.h * 0.85];
  const p2: [number, number] = [box.x + box.w * 0.85, box.y + box.h * 0.15];
  const jitter = box.w * 0.01;
  const first = segment(p0, p1, 10, 0.3, 0.65, rng, jitter);
  const second = segment(p1, p2, 16, 0.65, 0.3, rng, jitter);
  // Drop the duplicated joint point.
  return [...first, ...second.slice(1)];
}

function crossSegments(box: FreehandBox, rng: Rng): RawPoint[][] {
  const pad = 0.12;
  const jitter = box.w * 0.01;
  const topLeft: [number, number] = [box.x + box.w * pad, box.y + box.h * pad];
  const bottomRight: [number, number] = [box.x + box.w * (1 - pad), box.y + box.h * (1 - pad)];
  const topRight: [number, number] = [box.x + box.w * (1 - pad), box.y + box.h * pad];
  const bottomLeft: [number, number] = [box.x + box.w * pad, box.y + box.h * (1 - pad)];
  return [
    segment(topLeft, bottomRight, 14, 0.35, 0.55, rng, jitter),
    segment(topRight, bottomLeft, 14, 0.35, 0.55, rng, jitter),
  ];
}

function scribblePoints(box: FreehandBox, rng: Rng): RawPoint[] {
  const steps = 60;
  const cy = box.y + box.h / 2;
  const points: RawPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = box.x + box.w * 0.1 + box.w * 0.8 * t;
    const noise = (rng() - 0.5) * box.h * 0.06;
    const y = cy + Math.sin(t * Math.PI * 6) * box.h * 0.18 + noise;
    const pressure = 0.3 + 0.4 * Math.abs(Math.sin(t * Math.PI * 3));
    points.push([x, y, pressure]);
  }
  return points;
}

function freehandArrowPoints(box: FreehandBox, rng: Rng): RawPoint[] {
  const y = box.y + box.h * 0.5;
  const xStart = box.x + box.w * 0.08;
  const xTip = box.x + box.w * 0.92;
  const jitter = box.h * 0.01;
  const shaft: RawPoint[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arc = -Math.sin(Math.PI * t) * box.h * 0.05;
    const noise = (rng() - 0.5) * jitter;
    shaft.push([lerp(xStart, xTip, t), y + arc + noise, 0.35 + 0.35 * t]);
  }
  const tip: [number, number] = [xTip, y];
  const wing1: [number, number] = [xTip - box.w * 0.14, y - box.h * 0.12];
  const wing2: [number, number] = [xTip - box.w * 0.14, y + box.h * 0.12];
  const toWing1 = segment(tip, wing1, 8, 0.6, 0.3, rng, jitter);
  const backToTip = segment(wing1, tip, 8, 0.3, 0.55, rng, jitter);
  const toWing2 = segment(tip, wing2, 8, 0.6, 0.3, rng, jitter);
  return [...shaft, ...toWing1.slice(1), ...backToTip.slice(1), ...toWing2.slice(1)];
}

function rawPointsFor(gesture: Exclude<FreehandGesture, 'cross'>, box: FreehandBox, rng: Rng): RawPoint[] {
  switch (gesture) {
    case 'underline': return underlinePoints(box, rng);
    case 'circle': return circlePoints(box, rng);
    case 'checkmark': return checkmarkPoints(box, rng);
    case 'scribble': return scribblePoints(box, rng);
    case 'freehand-arrow': return freehandArrowPoints(box, rng);
    default: {
      const exhaustive: never = gesture;
      throw new Error(`Unknown freehand gesture: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// perfect-freehand -> smoothed outline `d` string.
//
// Standard "quadratic through edge midpoints" technique used with perfect-freehand:
// each outline point becomes a Bezier control point, and the midpoint of each edge
// becomes the curve anchor, producing a smooth closed path without extra smoothing
// passes. This is implemented directly (not a shortcut) rather than emitting the raw,
// jagged polygon perfect-freehand returns.
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '0.000';
}

export function strokeOutlineToPath(outline: ReadonlyArray<readonly [number, number]>): string {
  if (outline.length === 0) return '';
  if (outline.length < 3) {
    const [x, y] = outline[0];
    return `M ${fmt(x)} ${fmt(y)} Z`;
  }
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const startMid = mid(outline[0], outline[1]);
  let d = `M ${fmt(startMid[0])} ${fmt(startMid[1])}`;
  for (let i = 1; i < outline.length; i++) {
    const current = outline[i];
    const next = outline[(i + 1) % outline.length];
    const nextMid = mid(current, next);
    d += ` Q ${fmt(current[0])} ${fmt(current[1])} ${fmt(nextMid[0])} ${fmt(nextMid[1])}`;
  }
  d += ' Z';
  return d;
}

const STROKE_OPTIONS: Record<FreehandGesture, StrokeOptions> = {
  underline: {size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.5},
  circle: {size: 5, thinning: 0.4, smoothing: 0.55, streamline: 0.45},
  checkmark: {size: 7, thinning: 0.6, smoothing: 0.5, streamline: 0.4},
  cross: {size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.4},
  scribble: {size: 5, thinning: 0.3, smoothing: 0.4, streamline: 0.3},
  'freehand-arrow': {size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.45},
};

function outlinePath(rawPoints: RawPoint[], gesture: FreehandGesture): string {
  const outline = getStroke(rawPoints, STROKE_OPTIONS[gesture]) as unknown as Array<[number, number]>;
  return strokeOutlineToPath(outline);
}

/**
 * Generate a deterministic freehand annotation gesture: the raw `[x,y,pressure]` input
 * points (stored verbatim as `FreehandStroke.points`) plus a smoothed outline `d` string
 * derived from those exact points via perfect-freehand.
 */
export function generateFreehandGeometry(
  sceneId: string,
  elementId: string,
  gesture: FreehandGesture,
  box: FreehandBox,
): FreehandGeometry {
  const rng = mulberry32(gestureSeed(sceneId, elementId, gesture));
  if (gesture === 'cross') {
    const segments = crossSegments(box, rng);
    const d = segments.map((seg) => outlinePath(seg, gesture)).join(' ');
    return {points: segments.flat(), d};
  }
  const raw = rawPointsFor(gesture, box, rng);
  return {points: raw, d: outlinePath(raw, gesture)};
}

import type { FillShape, PrimitiveVisual, StrokePath } from '../types.js';
import { STYLE } from '../style.js';

/**
 * Semantic Core (Teaching Compiler V1 §4 L2): procedural role/function
 * primitives. These are NOT icons for nouns — they depict roles (filter,
 * gate, bottleneck, loop, ...) composed from strokes, fills and arrows in
 * the house ink style. Fully deterministic: identical (role, side) always
 * yields byte-identical output (no Date.now/Math.random).
 *
 * Lane: 'procedural'. Animation: stroke draws first, fills fade.
 */

/** Roles the core can draw. Requested via Element.semanticRole. */
export const SEMANTIC_ROLES = [
  'boundary', 'gate', 'filter', 'bottleneck', 'pipe', 'bridge', 'link', 'path',
  'branch', 'merge', 'hub', 'source', 'sink', 'queue', 'buffer', 'container',
  'stack', 'layers', 'target', 'threshold', 'balance', 'clock', 'cost', 'risk',
  'shield', 'lock', 'evidence', 'uncertainty', 'loop', 'increase', 'decrease',
  'allow', 'block', 'flow', 'constraint', 'input', 'output', 'transformation',
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/** Topology drawings for R1-diagram / R7-state-topology. */
export const SEMANTIC_TOPOLOGIES = [
  'chain', 'fan_out', 'convergence', 'cycle', 'hub_spoke', 'comparison',
  'before_after', 'threshold', 'bottleneck', 'loop',
] as const;

export type SemanticTopology = (typeof SEMANTIC_TOPOLOGIES)[number];

const F = {
  blue: STYLE.palette.blue,
  yellow: STYLE.palette.yellow,
  green: STYLE.palette.green,
  orange: STYLE.palette.orange,
  purple: STYLE.palette.purple,
  red: STYLE.palette.red,
  grey: STYLE.palette.grey,
};

const seg = (x1: number, y1: number, x2: number, y2: number): StrokePath => ({
  d: `M ${r1(x1)} ${r1(y1)} L ${r1(x2)} ${r1(y2)}`,
  length: Math.hypot(x2 - x1, y2 - y1),
});

const r1 = (n: number): number => Math.round(n * 10) / 10;

const poly = (pts: Array<[number, number]>, close = false): StrokePath => {
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${r1(x)} ${r1(y)}`).join(' ') + (close ? ' Z' : '');
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { d: path, length: Math.round(length * 10) / 10 };
};

const rect = (x: number, y: number, w: number, h: number): StrokePath =>
  poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

const circle = (cx: number, cy: number, r: number): StrokePath => {
  // Two-arc circle (avoids arc-length math; reveal uses the stored estimate).
  const d = `M ${r1(cx - r)} ${r1(cy)} A ${r1(r)} ${r1(r)} 0 1 0 ${r1(cx + r)} ${r1(cy)} A ${r1(r)} ${r1(r)} 0 1 0 ${r1(cx - r)} ${r1(cy)}`;
  return { d, length: Math.round(2 * Math.PI * r * 10) / 10 };
};

/** Arrow shaft + head (headAngle in radians from the shaft direction). */
const arrow = (x1: number, y1: number, x2: number, y2: number, head = 9): StrokePath[] => {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const out: StrokePath[] = [seg(x1, y1, x2, y2)];
  for (const side of [-1, 1]) {
    out.push(seg(x2, y2, x2 - head * Math.cos(ang + side * 0.45), y2 - head * Math.sin(ang + side * 0.45)));
  }
  return out;
};

const fill = (d: string, color: string): FillShape => ({ d, fill: color });

interface Kit {
  paths: StrokePath[];
  fills: FillShape[];
}

const box = (k: Kit, x: number, y: number, w: number, h: number, color?: string): void => {
  const p = rect(x, y, w, h);
  k.paths.push(p);
  if (color) k.fills.push(fill(p.d, color));
};

const dot = (k: Kit, cx: number, cy: number, r: number, color?: string): void => {
  const p = circle(cx, cy, r);
  k.paths.push(p);
  if (color) k.fills.push(fill(p.d, color));
};

type Painter = (k: Kit, s: number) => void;

/** All painters draw in a side×side box with a 10% margin (u = side/100). */
const PAINTERS: Record<SemanticRole, Painter> = {
  // A divided field: two zones split by a wall.
  boundary: (k, s) => {
    const u = s / 100;
    box(k, 12 * u, 20 * u, 30 * u, 60 * u, F.blue);
    box(k, 58 * u, 20 * u, 30 * u, 60 * u, F.yellow);
    k.paths.push(seg(50 * u, 14 * u, 50 * u, 86 * u));
  },
  // A wall with a gate opening + arrow passing through.
  gate: (k, s) => {
    const u = s / 100;
    k.paths.push(seg(20 * u, 14 * u, 20 * u, 86 * u), seg(80 * u, 14 * u, 80 * u, 40 * u), seg(80 * u, 60 * u, 80 * u, 86 * u));
    k.paths.push(...arrow(8 * u, 50 * u, 92 * u, 50 * u));
    dot(k, 80 * u, 50 * u, 4 * u, F.green);
  },
  // Funnel: wide entry, narrow exit, selected dots below.
  filter: (k, s) => {
    const u = s / 100;
    k.paths.push(poly([[20 * u, 16 * u], [80 * u, 16 * u], [58 * u, 52 * u], [58 * u, 78 * u], [42 * u, 78 * u], [42 * u, 52 * u]], true));
    dot(k, 34 * u, 30 * u, 3.5 * u, F.grey);
    dot(k, 50 * u, 38 * u, 3.5 * u, F.grey);
    dot(k, 64 * u, 30 * u, 3.5 * u, F.grey);
    dot(k, 50 * u, 66 * u, 3.5 * u, F.green);
  },
  // Wide bands crushed through a narrow neck.
  bottleneck: (k, s) => {
    const u = s / 100;
    k.paths.push(poly([[12 * u, 24 * u], [40 * u, 24 * u], [46 * u, 44 * u], [46 * u, 56 * u], [40 * u, 76 * u], [12 * u, 76 * u]]));
    k.paths.push(poly([[88 * u, 24 * u], [60 * u, 24 * u], [54 * u, 44 * u], [54 * u, 56 * u], [60 * u, 76 * u], [88 * u, 76 * u]]));
    k.paths.push(...arrow(50 * u, 8 * u, 50 * u, 92 * u));
  },
  // Straight conduit with flow direction.
  pipe: (k, s) => {
    const u = s / 100;
    k.paths.push(seg(10 * u, 38 * u, 90 * u, 38 * u), seg(10 * u, 62 * u, 90 * u, 62 * u));
    k.paths.push(...arrow(16 * u, 50 * u, 84 * u, 50 * u));
  },
  // Two banks joined by a span.
  bridge: (k, s) => {
    const u = s / 100;
    box(k, 8 * u, 60 * u, 22 * u, 22 * u, F.grey);
    box(k, 70 * u, 60 * u, 22 * u, 22 * u, F.grey);
    k.paths.push(poly([[30 * u, 60 * u], [50 * u, 34 * u], [70 * u, 60 * u]]));
    k.paths.push(seg(38 * u, 49 * u, 38 * u, 60 * u), seg(50 * u, 34 * u, 50 * u, 60 * u), seg(62 * u, 49 * u, 62 * u, 60 * u));
  },
  // Two nodes tied by a link.
  link: (k, s) => {
    const u = s / 100;
    dot(k, 26 * u, 50 * u, 11 * u, F.blue);
    dot(k, 74 * u, 50 * u, 11 * u, F.yellow);
    k.paths.push(seg(37 * u, 50 * u, 63 * u, 50 * u));
  },
  // A waypoint path: dotted route through three stops.
  path: (k, s) => {
    const u = s / 100;
    const pts: Array<[number, number]> = [[16 * u, 76 * u], [38 * u, 60 * u], [58 * u, 66 * u], [82 * u, 30 * u]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      for (let t = 0; t < 1; t += 0.2) {
        k.paths.push(seg(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, x1 + (x2 - x1) * Math.min(1, t + 0.1), y1 + (y2 - y1) * Math.min(1, t + 0.1)));
      }
    }
    dot(k, 16 * u, 76 * u, 5 * u, F.green);
    dot(k, 82 * u, 30 * u, 5 * u, F.red);
  },
  // One stream splitting in two.
  branch: (k, s) => {
    const u = s / 100;
    k.paths.push(...arrow(10 * u, 50 * u, 42 * u, 50 * u));
    k.paths.push(...arrow(42 * u, 50 * u, 86 * u, 28 * u));
    k.paths.push(...arrow(42 * u, 50 * u, 86 * u, 72 * u));
    dot(k, 42 * u, 50 * u, 4 * u, F.orange);
  },
  // Two streams joining into one.
  merge: (k, s) => {
    const u = s / 100;
    k.paths.push(...arrow(14 * u, 28 * u, 56 * u, 50 * u));
    k.paths.push(...arrow(14 * u, 72 * u, 56 * u, 50 * u));
    k.paths.push(...arrow(56 * u, 50 * u, 90 * u, 50 * u));
    dot(k, 56 * u, 50 * u, 4 * u, F.orange);
  },
  // Center node radiating to four satellites.
  hub: (k, s) => {
    const u = s / 100;
    dot(k, 50 * u, 50 * u, 10 * u, F.orange);
    for (const [x, y] of [[50, 18], [82, 50], [50, 82], [18, 50]] as Array<[number, number]>) {
      k.paths.push(seg(50 * u, 50 * u, x * u, y * u));
      dot(k, x * u, y * u, 6 * u, F.blue);
    }
  },
  // Emitter: concentric arcs leaving a point.
  source: (k, s) => {
    const u = s / 100;
    dot(k, 30 * u, 50 * u, 7 * u, F.green);
    for (const r of [16, 28, 40]) {
      k.paths.push({ d: `M ${r1(30 * u + r * u * 0.7)} ${r1(50 * u - r * u * 0.7)} A ${r1(r * u)} ${r1(r * u)} 0 0 1 ${r1(30 * u + r * u * 0.7)} ${r1(50 * u + r * u * 0.7)}`, length: Math.round(Math.PI * r * u) });
    }
  },
  // Drain: arcs entering a point.
  sink: (k, s) => {
    const u = s / 100;
    for (const r of [16, 28, 40]) {
      k.paths.push({ d: `M ${r1(70 * u - r * u * 0.7)} ${r1(50 * u - r * u * 0.7)} A ${r1(r * u)} ${r1(r * u)} 0 0 0 ${r1(70 * u - r * u * 0.7)} ${r1(50 * u + r * u * 0.7)}`, length: Math.round(Math.PI * r * u) });
    }
    dot(k, 70 * u, 50 * u, 7 * u, F.red);
  },
  // Three waiting slots in a row.
  queue: (k, s) => {
    const u = s / 100;
    for (let i = 0; i < 3; i++) box(k, (16 + i * 24) * u, 36 * u, 18 * u, 28 * u, i === 0 ? F.green : F.grey);
    k.paths.push(...arrow(10 * u, 78 * u, 90 * u, 78 * u));
  },
  // A vessel holding content (shaded fill level).
  buffer: (k, s) => {
    const u = s / 100;
    const p = poly([[24 * u, 20 * u], [76 * u, 20 * u], [70 * u, 80 * u], [30 * u, 80 * u]], true);
    k.paths.push(p);
    k.fills.push(fill(`M ${r1(31 * u)} ${r1(52 * u)} L ${r1(69 * u)} ${r1(52 * u)} L ${r1(65 * u)} ${r1(76 * u)} L ${r1(35 * u)} ${r1(76 * u)} Z`, F.blue));
  },
  // Dashed grouping boundary (organizational, not physical).
  container: (k, s) => {
    const u = s / 100;
    for (let x = 14; x < 86; x += 8) {
      k.paths.push(seg(x * u, 22 * u, Math.min(86, x + 5) * u, 22 * u));
      k.paths.push(seg(x * u, 78 * u, Math.min(86, x + 5) * u, 78 * u));
    }
    for (let y = 22; y < 78; y += 8) {
      k.paths.push(seg(14 * u, y * u, 14 * u, Math.min(78, y + 5) * u));
      k.paths.push(seg(86 * u, y * u, 86 * u, Math.min(78, y + 5) * u));
    }
    dot(k, 38 * u, 50 * u, 6 * u, F.blue);
    dot(k, 62 * u, 50 * u, 6 * u, F.yellow);
  },
  // Three stacked plates, offset.
  stack: (k, s) => {
    const u = s / 100;
    for (let i = 0; i < 3; i++) box(k, (30 - i * 6) * u, (26 + i * 14) * u, 46 * u, 12 * u, [F.blue, F.yellow, F.green][i]);
  },
  // Three horizontal strata.
  layers: (k, s) => {
    const u = s / 100;
    const colors = [F.blue, F.yellow, F.green];
    for (let i = 0; i < 3; i++) {
      const p = rect(18 * u, (24 + i * 18) * u, 64 * u, 14 * u);
      k.paths.push(p);
      k.fills.push(fill(p.d, colors[i]));
    }
  },
  // Concentric target with centered arrow hit.
  target: (k, s) => {
    const u = s / 100;
    for (const r of [30, 20, 10]) dot(k, 50 * u, 50 * u, r * u, r === 10 ? F.red : undefined);
    k.paths.push(...arrow(50 * u, 6 * u, 50 * u, 40 * u));
  },
  // A bar with a marker gate at a position.
  threshold: (k, s) => {
    const u = s / 100;
    const p = rect(14 * u, 40 * u, 72 * u, 20 * u);
    k.paths.push(p);
    k.fills.push(fill(`M ${r1(14 * u)} ${r1(40 * u)} L ${r1(56 * u)} ${r1(40 * u)} L ${r1(56 * u)} ${r1(60 * u)} L ${r1(14 * u)} ${r1(60 * u)} Z`, F.green));
    k.paths.push(seg(56 * u, 32 * u, 56 * u, 68 * u));
    dot(k, 56 * u, 50 * u, 4 * u, F.red);
  },
  // A beam scale balancing two pans.
  balance: (k, s) => {
    const u = s / 100;
    k.paths.push(seg(50 * u, 20 * u, 50 * u, 78 * u), seg(24 * u, 30 * u, 76 * u, 30 * u));
    k.paths.push(poly([[24 * u, 30 * u], [18 * u, 52 * u], [30 * u, 52 * u]], true));
    k.paths.push(poly([[76 * u, 30 * u], [70 * u, 52 * u], [82 * u, 52 * u]], true));
    k.paths.push(seg(38 * u, 78 * u, 62 * u, 78 * u));
  },
  // A clock face with hands.
  clock: (k, s) => {
    const u = s / 100;
    dot(k, 50 * u, 50 * u, 28 * u);
    k.paths.push(seg(50 * u, 50 * u, 50 * u, 30 * u), seg(50 * u, 50 * u, 64 * u, 56 * u));
    dot(k, 50 * u, 50 * u, 2.5 * u);
  },
  // A coin/tag with a price tick (cost marker).
  cost: (k, s) => {
    const u = s / 100;
    dot(k, 42 * u, 50 * u, 22 * u, F.yellow);
    k.paths.push(seg(58 * u, 28 * u, 84 * u, 28 * u), seg(84 * u, 28 * u, 84 * u, 44 * u));
    k.paths.push(seg(70 * u, 62 * u, 70 * u, 76 * u));
    k.paths.push(...arrow(70 * u, 76 * u, 70 * u, 88 * u, 6));
  },
  // Warning triangle with open center (risk, not error).
  risk: (k, s) => {
    const u = s / 100;
    const p = poly([[50 * u, 16 * u], [86 * u, 80 * u], [14 * u, 80 * u]], true);
    k.paths.push(p);
    k.fills.push(fill(p.d, F.yellow));
    k.paths.push(seg(50 * u, 40 * u, 50 * u, 58 * u));
    dot(k, 50 * u, 68 * u, 2.5 * u);
  },
  // A heater-shield outline guarding a dot.
  shield: (k, s) => {
    const u = s / 100;
    const p = poly([[50 * u, 12 * u], [78 * u, 24 * u], [78 * u, 52 * u], [50 * u, 86 * u], [22 * u, 52 * u], [22 * u, 24 * u]], true);
    k.paths.push(p);
    k.fills.push(fill(p.d, F.blue));
    dot(k, 50 * u, 50 * u, 6 * u, F.green);
  },
  // A padlock body + shackle.
  lock: (k, s) => {
    const u = s / 100;
    k.paths.push(poly([[38 * u, 46 * u], [38 * u, 34 * u], [62 * u, 34 * u], [62 * u, 46 * u]]));
    box(k, 30 * u, 46 * u, 40 * u, 32 * u, F.grey);
    dot(k, 50 * u, 60 * u, 3.5 * u);
    k.paths.push(seg(50 * u, 63 * u, 50 * u, 70 * u));
  },
  // A cited claim: document with a check + source line.
  evidence: (k, s) => {
    const u = s / 100;
    const p = poly([[32 * u, 14 * u], [68 * u, 14 * u], [68 * u, 86 * u], [32 * u, 86 * u]], true);
    k.paths.push(p);
    k.paths.push(poly([[42 * u, 48 * u], [48 * u, 56 * u], [60 * u, 38 * u]]));
    k.paths.push(seg(40 * u, 66 * u, 60 * u, 66 * u), seg(40 * u, 74 * u, 56 * u, 74 * u));
  },
  // A dotted-outline unknown: dashed circle + query dot pair.
  uncertainty: (k, s) => {
    const u = s / 100;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      k.paths.push(seg(
        (50 + 26 * Math.cos(a)) * u, (50 + 26 * Math.sin(a)) * u,
        (50 + 26 * Math.cos(a + Math.PI / 12)) * u, (50 + 26 * Math.sin(a + Math.PI / 12)) * u,
      ));
    }
    dot(k, 50 * u, 44 * u, 3 * u);
    k.paths.push(seg(50 * u, 58 * u, 50 * u, 66 * u));
    dot(k, 50 * u, 72 * u, 2.5 * u);
  },
  // A closed feedback loop: rounded triangle of arrows.
  loop: (k, s) => {
    const u = s / 100;
    k.paths.push(...arrow(50 * u, 16 * u, 80 * u, 68 * u));
    k.paths.push(...arrow(80 * u, 68 * u, 20 * u, 68 * u));
    k.paths.push(...arrow(20 * u, 68 * u, 50 * u, 16 * u));
  },
  // Rising chevrons (quantity increase, no numbers).
  increase: (k, s) => {
    const u = s / 100;
    for (const y of [68, 50, 32]) k.paths.push(poly([[30 * u, y * u], [50 * u, (y - 12) * u], [70 * u, y * u]]));
  },
  // Falling chevrons.
  decrease: (k, s) => {
    const u = s / 100;
    for (const y of [32, 50, 68]) k.paths.push(poly([[30 * u, y * u], [50 * u, (y + 12) * u], [70 * u, y * u]]));
  },
  // A check inside a circle (allowed / holds).
  allow: (k, s) => {
    const u = s / 100;
    dot(k, 50 * u, 50 * u, 28 * u, F.green);
    k.paths.push(poly([[36 * u, 51 * u], [46 * u, 62 * u], [66 * u, 38 * u]]));
  },
  // A cross inside a circle (blocked / fails).
  block: (k, s) => {
    const u = s / 100;
    dot(k, 50 * u, 50 * u, 28 * u, F.red);
    k.paths.push(seg(38 * u, 38 * u, 62 * u, 62 * u), seg(62 * u, 38 * u, 38 * u, 62 * u));
  },
  // Three rightward chevrons (flow direction emphasis).
  flow: (k, s) => {
    const u = s / 100;
    for (const x of [24, 44, 64]) k.paths.push(...arrow(x * u, 50 * u, (x + 12) * u, 50 * u, 7));
  },
  // A bar blocked by a stop wall (constraint).
  constraint: (k, s) => {
    const u = s / 100;
    k.paths.push(...arrow(10 * u, 50 * u, 58 * u, 50 * u));
    k.paths.push(seg(64 * u, 26 * u, 64 * u, 74 * u));
    k.paths.push(seg(64 * u, 26 * u, 72 * u, 26 * u), seg(64 * u, 74 * u, 72 * u, 74 * u));
  },
  // Entry port: arrow into a socket.
  input: (k, s) => {
    const u = s / 100;
    box(k, 56 * u, 36 * u, 28 * u, 28 * u, F.blue);
    k.paths.push(...arrow(12 * u, 50 * u, 56 * u, 50 * u));
  },
  // Exit port: arrow out of a socket.
  output: (k, s) => {
    const u = s / 100;
    box(k, 16 * u, 36 * u, 28 * u, 28 * u, F.yellow);
    k.paths.push(...arrow(44 * u, 50 * u, 88 * u, 50 * u));
  },
  // A shape morphing: square in, circle out, arrow between.
  transformation: (k, s) => {
    const u = s / 100;
    box(k, 12 * u, 36 * u, 26 * u, 28 * u, F.blue);
    dot(k, 74 * u, 50 * u, 14 * u, F.green);
    k.paths.push(...arrow(42 * u, 50 * u, 56 * u, 50 * u, 6));
  },
};

export function isSemanticRole(value: string): value is SemanticRole {
  return (SEMANTIC_ROLES as readonly string[]).includes(value.trim().toLowerCase().replace(/[_-]+/g, '-').replace(/\s+/g, '-'));
}

export function normalizeRole(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, '-').replace(/\s+/g, '-');
}

/** Draw a semantic role centered in a side×side box. Unknown roles return undefined (caller falls through). */
export function renderSemanticRole(role: string, side: number): PrimitiveVisual | undefined {
  const key = normalizeRole(role) as SemanticRole;
  const paint = PAINTERS[key];
  if (!paint) return undefined;
  const k: Kit = { paths: [], fills: [] };
  paint(k, Math.max(1, side));
  return { paths: k.paths, fills: k.fills, texts: [] };
}

interface TopoKit extends Kit {
  w: number;
  h: number;
}

const tNode = (k: TopoKit, cx: number, cy: number, color?: string): void => {
  const w = Math.min(k.w, k.h) * 0.22;
  const h = w * 0.62;
  box(k, cx - w / 2, cy - h / 2, w, h, color);
};

const tArrow = (k: TopoKit, x1: number, y1: number, x2: number, y2: number): void => {
  k.paths.push(...arrow(x1, y1, x2, y2, 10));
};

const TOPO_PAINTERS: Record<SemanticTopology, (k: TopoKit) => void> = {
  chain: (k) => {
    const ys = k.h / 2;
    const xs = [k.w * 0.2, k.w * 0.5, k.w * 0.8];
    xs.forEach((x, i) => tNode(k, x, ys, [F.blue, F.yellow, F.green][i]));
    tArrow(k, xs[0] + k.w * 0.11, ys, xs[1] - k.w * 0.11, ys);
    tArrow(k, xs[1] + k.w * 0.11, ys, xs[2] - k.w * 0.11, ys);
  },
  fan_out: (k) => {
    tNode(k, k.w * 0.2, k.h / 2, F.blue);
    for (const [i, y] of [0.2, 0.5, 0.8].entries()) {
      tNode(k, k.w * 0.76, k.h * y, [F.yellow, F.green, F.purple][i]);
      tArrow(k, k.w * 0.3, k.h / 2, k.w * 0.64, k.h * y);
    }
  },
  convergence: (k) => {
    for (const [i, y] of [0.2, 0.5, 0.8].entries()) {
      tNode(k, k.w * 0.24, k.h * y, [F.blue, F.yellow, F.green][i]);
      tArrow(k, k.w * 0.36, k.h * y, k.w * 0.62, k.h / 2);
    }
    tNode(k, k.w * 0.78, k.h / 2, F.orange);
  },
  cycle: (k) => {
    const c: Array<[number, number]> = [[0.5, 0.2], [0.78, 0.72], [0.22, 0.72]];
    c.forEach(([x, y], i) => tNode(k, k.w * x, k.h * y, [F.blue, F.yellow, F.green][i]));
    tArrow(k, k.w * 0.6, k.h * 0.28, k.w * 0.72, k.h * 0.6);
    tArrow(k, k.w * 0.66, k.h * 0.72, k.w * 0.34, k.h * 0.72);
    tArrow(k, k.w * 0.24, k.h * 0.6, k.w * 0.4, k.h * 0.28);
  },
  hub_spoke: (k) => {
    const m = Math.min(k.w, k.h);
    dot(k, k.w / 2, k.h / 2, m * 0.09, F.orange);
    for (const [x, y] of [[0.5, 0.16], [0.84, 0.5], [0.5, 0.84], [0.16, 0.5]] as Array<[number, number]>) {
      k.paths.push(seg(k.w / 2, k.h / 2, k.w * x, k.h * y));
      tNode(k, k.w * x, k.h * y, F.blue);
    }
  },
  comparison: (k) => {
    tNode(k, k.w * 0.28, k.h / 2, F.blue);
    tNode(k, k.w * 0.72, k.h / 2, F.yellow);
    k.paths.push(seg(k.w / 2, k.h * 0.2, k.w / 2, k.h * 0.8));
  },
  before_after: (k) => {
    tNode(k, k.w * 0.26, k.h / 2, F.grey);
    tNode(k, k.w * 0.74, k.h / 2, F.green);
    tArrow(k, k.w * 0.4, k.h / 2, k.w * 0.6, k.h / 2);
  },
  threshold: (k) => {
    const p = rect(k.w * 0.14, k.h * 0.4, k.w * 0.72, k.h * 0.2);
    k.paths.push(p);
    k.fills.push(fill(`M ${r1(k.w * 0.14)} ${r1(k.h * 0.4)} L ${r1(k.w * 0.56)} ${r1(k.h * 0.4)} L ${r1(k.w * 0.56)} ${r1(k.h * 0.6)} L ${r1(k.w * 0.14)} ${r1(k.h * 0.6)} Z`, F.green));
    k.paths.push(seg(k.w * 0.56, k.h * 0.3, k.w * 0.56, k.h * 0.7));
  },
  bottleneck: (k) => {
    k.paths.push(poly([[k.w * 0.1, k.h * 0.24], [k.w * 0.42, k.h * 0.24], [k.w * 0.47, k.h * 0.44], [k.w * 0.47, k.h * 0.56], [k.w * 0.42, k.h * 0.76], [k.w * 0.1, k.h * 0.76]]));
    k.paths.push(poly([[k.w * 0.9, k.h * 0.24], [k.w * 0.58, k.h * 0.24], [k.w * 0.53, k.h * 0.44], [k.w * 0.53, k.h * 0.56], [k.w * 0.58, k.h * 0.76], [k.w * 0.9, k.h * 0.76]]));
    tArrow(k, k.w / 2, k.h * 0.08, k.w / 2, k.h * 0.92);
  },
  loop: (k) => {
    const cx = k.w / 2;
    const cy = k.h / 2;
    const r = Math.min(k.w, k.h) * 0.3;
    k.paths.push({ d: `M ${r1(cx - r)} ${r1(cy)} A ${r1(r)} ${r1(r)} 0 1 1 ${r1(cx + r * 0.9)} ${r1(cy - r * 0.4)}`, length: Math.round(1.5 * Math.PI * r) });
    k.paths.push(...arrow(cx + r * 0.9, cy - r * 0.4, cx + r * 0.55, cy - r * 0.75, 9));
  },
};

export function isSemanticTopology(value: string): value is SemanticTopology {
  return (SEMANTIC_TOPOLOGIES as readonly string[]).includes(value.trim().toLowerCase().replace(/[_-]+/g, '_'));
}

/** Draw a topology across a w×h box. Unknown topologies return undefined (caller falls through). */
export function renderTopology(topology: string, w: number, h: number): PrimitiveVisual | undefined {
  const key = topology.trim().toLowerCase().replace(/[_-]+/g, '_') as SemanticTopology;
  const paint = TOPO_PAINTERS[key];
  if (!paint) return undefined;
  const k: TopoKit = { paths: [], fills: [], w: Math.max(1, w), h: Math.max(1, h) };
  paint(k);
  return { paths: k.paths, fills: k.fills, texts: [] };
}

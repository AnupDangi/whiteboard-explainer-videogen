import type { BBox, LaidOutElement, LaidOutScene, ResolvedScene } from '../types.js';
import { STYLE } from '../style.js';
import { TEMPLATES, applyAxisOverlapFix, type TemplateFn } from '../templates/definitions.js';
import type { SlotAssignment } from '../templates/assign.js';
import { unionBBox, scaleAround, type Rect } from './geometry.js';
import { routeEdges } from './edges.js';

const TITLE_BAND_H = 150;

function workingRect(template: ResolvedScene['template']): Rect {
  const safe = STYLE.canvas.safe;
  const base: Rect = { x: safe, y: safe, w: STYLE.canvas.w - 2 * safe, h: STYLE.canvas.h - 2 * safe };
  if (template === 'title_card') return base;
  return { ...base, y: base.y + TITLE_BAND_H, h: base.h - TITLE_BAND_H };
}

function containerPad(): number {
  return 32;
}

/**
 * Element growth before placement: reference frames show icons ~120-200px
 * with content covering ~50-70% of the frame, whereas union-bbox scaling
 * alone only spreads small elements apart. Try uniform size factors from
 * largest to smallest and keep the first placement that stays inside the
 * working rect with no leaf overlaps. Factors below 1.0 shrink a scene whose
 * measured content does not fit (e.g. a long formula beside a plot) rather
 * than letting it run off the canvas; the readability gate (G6) still
 * catches anything shrunk below the minimum text size.
 */
const GROWTH_FACTORS = [1.6, 1.45, 1.3, 1.15, 1.0, 0.85, 0.72, 0.6];

/** A dense fan-out cannot place every target in one vertical column at readable
 * size. Keep its source in the template's source slot and try target grids in
 * the target region. Nothing is scaled to fit a cell: a candidate either fits
 * at its current growth factor or the next candidate is tried. */
function fanOutTargetGrid(template: TemplateFn, rect: Rect, grown: SlotAssignment[], columns: number): Map<string, BBox> | undefined {
  const targets = grown.filter((item) => item.slot === 'target');
  if (targets.length < 3 || columns > targets.length) return undefined;
  const rows = Math.ceil(targets.length / columns);
  const gap = STYLE.element.gap;
  const targetRegion: Rect = { x: rect.x + rect.w * 0.42, y: rect.y, w: rect.w * 0.58, h: rect.h };
  const cellW = (targetRegion.w - gap * (columns - 1)) / columns;
  const cellH = (targetRegion.h - gap * (rows - 1)) / rows;
  if (cellW <= 0 || cellH <= 0 || targets.some(({ intrinsic }) => intrinsic.w > cellW || intrinsic.h > cellH)) return undefined;

  const boxes = new Map(template(rect, grown).boxes);
  targets.forEach((target, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    boxes.set(target.elementId, {
      x: targetRegion.x + col * (cellW + gap) + (cellW - target.intrinsic.w) / 2,
      y: targetRegion.y + row * (cellH + gap) + (cellH - target.intrinsic.h) / 2,
      w: target.intrinsic.w,
      h: target.intrinsic.h,
    });
  });
  return boxes;
}

function placementFits(boxes: Map<string, BBox>, rect: Rect, containerIds: Set<string>): boolean {
  const leaves = [...boxes.entries()].filter(([id]) => !containerIds.has(id)).map(([, b]) => b);
  const inside = leaves.every((b) => b.x >= rect.x - 0.5 && b.y >= rect.y - 0.5 && b.x + b.w <= rect.x + rect.w + 0.5 && b.y + b.h <= rect.y + rect.h + 0.5);
  const overlapping = leaves.some((a, i) => leaves.some((b, j) => j > i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
  return inside && !overlapping;
}

function placeWithGrowth(templateId: ResolvedScene['template'], template: TemplateFn, rect: Rect, assignments: SlotAssignment[], containerIds: Set<string>): Map<string, BBox> {
  let fallback: Map<string, BBox> | undefined;
  for (const g of GROWTH_FACTORS) {
    const grown = assignments.map((a) => ({ ...a, intrinsic: { w: a.intrinsic.w * g, h: a.intrinsic.h * g } }));
    const { boxes: raw, axis } = template(rect, grown);
    const boxes = applyAxisOverlapFix(raw, axis, STYLE.element.gap);
    fallback = boxes;
    if (placementFits(boxes, rect, containerIds)) return boxes;
    if (templateId === 'fan_out') {
      for (let columns = 2; columns <= Math.min(4, grown.filter((a) => a.slot === 'target').length); columns++) {
        const grid = fanOutTargetGrid(template, rect, grown, columns);
        if (grid && placementFits(grid, rect, containerIds)) return grid;
      }
    }
  }
  // Nothing fit: shrink the smallest-factor placement uniformly into the working rect so it can never
  // leave the safe area (overlaps/readability are still reported by the gates, not hidden).
  const all = [...fallback!.values()];
  const u = { x: Math.min(...all.map((b) => b.x)), y: Math.min(...all.map((b) => b.y)), r: Math.max(...all.map((b) => b.x + b.w)), b: Math.max(...all.map((b) => b.y + b.h)) };
  const k = Math.min(1, rect.w / (u.r - u.x), rect.h / (u.b - u.y));
  const ox = rect.x + (rect.w - (u.r - u.x) * k) / 2;
  const oy = rect.y + (rect.h - (u.b - u.y) * k) / 2;
  return new Map([...fallback!.entries()].map(([id, b]) => [id, { x: ox + (b.x - u.x) * k, y: oy + (b.y - u.y) * k, w: b.w * k, h: b.h * k }]));
}

export interface LayoutOptions {
  /** Previous scene's laid-out elements, keyed by id, for carry-over continuity. */
  previous?: Map<string, BBox>;
}

/**
 * S8 — deterministic template layout (claude_pipeline.md §14). Procedure:
 * template slot boxes -> measured sizes already baked into ResolvedElement
 * -> axis overlap push -> container hugging -> carry-over pin -> occupancy
 * scaling (skipped when carry-over is present, to keep continuity exact
 * rather than silently drifting pinned elements — see docs/HANDOFF.md) ->
 * edge routing. Fails loud (returns an occupancy/overflow signal in the
 * caller's gate, never silently clips) if content cannot fit safe area.
 */
export function layoutScene(scene: ResolvedScene, options: LayoutOptions = {}): LaidOutScene {
  const rect = workingRect(scene.template);
  const containerIds = new Set(scene.elements.filter((e) => e.element.prim === 'container').map((e) => e.element.id));

  const assignments: SlotAssignment[] = scene.elements.map((e) => ({
    elementId: e.element.id,
    intrinsic: e.intrinsicSize,
    slot: e.element.slot,
  }));

  const template = TEMPLATES[scene.template];
  let boxes = placeWithGrowth(scene.template, template, rect, assignments, containerIds);

  // Container hugging: a container's own box is the union of its children's
  // final boxes (padded), never an independently placed slot box.
  for (const e of scene.elements) {
    if (e.element.prim !== 'container') continue;
    const childBoxes = e.element.children.map((id) => boxes.get(id)).filter((b): b is BBox => Boolean(b));
    if (childBoxes.length > 0) {
      const pad = containerPad();
      const u = unionBBox(childBoxes);
      boxes.set(e.element.id, { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 });
    }
  }

  // Carry-over: pin to the previous scene's exact position for continuity.
  const carriedIds = new Set(scene.carryOver);
  if (options.previous) {
    for (const id of carriedIds) {
      const prevBox = options.previous.get(id);
      if (prevBox && boxes.has(id)) boxes.set(id, prevBox);
    }
  }

  // Occupancy scaling: skipped when carry-over is active so pinned elements
  // never drift between scenes (continuity takes precedence — documented
  // trade-off, occupancy is a Warn-level gate per hypothesis/v1_claude/03).
  const hasCarry = options.previous && carriedIds.size > 0;
  const canvasArea = STYLE.canvas.w * STYLE.canvas.h;
  if (!hasCarry && boxes.size > 0) {
    const content = unionBBox([...boxes.values()]);
    const occupancy = (content.w * content.h) / canvasArea;
    const { min, max } = STYLE.occupancy;
    if (occupancy > 0 && (occupancy < min || occupancy > max)) {
      const targetArea = occupancy < min ? min * canvasArea : max * canvasArea;
      let scale = Math.sqrt(targetArea / (content.w * content.h));
      const pivot = { x: content.x + content.w / 2, y: content.y + content.h / 2 };
      // Clamp by actual available room from the PIVOT to each of the four
      // rect edges (not just a total-size ratio): content is rarely centered
      // in `rect`, so scaling around its own center can push whichever side
      // is already closest to a rect edge straight through it even when
      // `rect.h / content.h` alone looks safe.
      const halfW = content.w / 2;
      const halfH = content.h / 2;
      const roomLeft = pivot.x - rect.x;
      const roomRight = rect.x + rect.w - pivot.x;
      const roomUp = pivot.y - rect.y;
      const roomDown = rect.y + rect.h - pivot.y;
      const maxScale = Math.min(roomLeft / halfW, roomRight / halfW, roomUp / halfH, roomDown / halfH);
      scale = Math.min(scale, maxScale);
      const ids = [...boxes.keys()];
      const scaled = scaleAround(ids.map((id) => boxes.get(id)!), pivot, scale);
      boxes = new Map(ids.map((id, i) => [id, scaled[i]]));
    }
  }

  const content = boxes.size > 0 ? unionBBox([...boxes.values()]) : { x: 0, y: 0, w: 0, h: 0 };
  const occupancy = (content.w * content.h) / canvasArea;

  const elements: LaidOutElement[] = scene.elements.map((e) => ({
    id: e.element.id,
    element: e.element,
    resolution: e.resolution,
    visual: e.visual,
    intrinsicSize: e.intrinsicSize,
    strokeLength: e.strokeLength,
    bbox: boxes.get(e.element.id) ?? { x: rect.x, y: rect.y, w: e.intrinsicSize.w, h: e.intrinsicSize.h },
  }));

  const edges = routeEdges(scene.edges, boxes, containerIds);

  return { sceneId: scene.sceneId, title: scene.title, template: scene.template, elements, edges, occupancy, carryOver: scene.carryOver, focus: scene.focus, ...(scene.boardIntent ? { boardIntent: scene.boardIntent } : {}) };
}

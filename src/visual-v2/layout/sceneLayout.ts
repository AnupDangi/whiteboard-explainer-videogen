import { svgPathProperties } from 'svg-path-properties';
import { STYLE } from '../../render/style.js';
import { measureTextInkBounds, measureTextWidth } from '../../layout/measure.js';
import { typesetTex } from '../../render/math.js';
import type { ElementSpec, KitName, RegionId } from '../board-ops/types.js';
import type { BoardElement, BoardState } from '../board-state/types.js';
import { KIT_REGISTRY, parseKitParams } from '../kits/registry.js';
import type { KitGeometry } from '../kits/types.js';
import { borderPoint, center, contains, overlaps, segmentCrossesRect, textRun, type Rect } from '../kits/geometry.js';
import { fitText, lineBaselines, textOverflow, textSlot } from './textFit.js';

/**
 * Scene geometry (V2 plan Phase 9, first layer). The writer names semantic regions and slots; this solver turns them into
 * rectangles. It lays out the UNION of everything the scene ever shows, so each element is placed once at its final size
 * and position: objects appear where they will stay, and nothing is rearranged when a later element arrives.
 */
const SAFE = STYLE.canvas.safe;
export const CONTENT_RECT: Rect = { x: SAFE, y: SAFE + STYLE.layout.titleBandPx, w: STYLE.canvas.w - 2 * SAFE, h: STYLE.canvas.h - 2 * SAFE - STYLE.layout.titleBandPx };
const GAP = 28;
const MAX_UPSCALE = 1.3;

export interface PlacedRect { id: string; rect: Rect }
export interface Point { x: number; y: number }
/** Exact, deterministic geometry consumed by validation, SVG rendering, and the scene capture. */
export interface EdgeRoute {
  id: string;
  points: [Point, Point];
  /** Quadratic control point used only when a clear straight shaft is impossible. */
  controlPoint?: Point;
  arrowhead: [Point, Point, Point];
  arrowheadBounds: Rect;
  label?: { x: number; y: number; text: string; size: number; bounds: Rect };
}

export interface SceneGeometry {
  contentRect: Rect;
  regionRects: Partial<Record<RegionId, Rect>>;
  /** The rect an element occupies in a given state, following its placement there. */
  rectFor(state: BoardState, id: string): Rect | undefined;
  kitGeometry(id: string): KitGeometry | undefined;
  /** The rectangle a kit's cached drawing and slots were laid out in; a kit shown elsewhere is the same drawing mapped from here. */
  kitRect(id: string): Rect | undefined;
  allRects(): PlacedRect[];
  edgeRouteFor(state: BoardState, edgeId: string): EdgeRoute | undefined;
  /** Retained elements whose rectangle had to change from the previous scene because keeping it left no valid layout. */
  moved: string[];
}

/** The previous scene's final board and geometry, so objects that stay keep their position and size across the cut. */
export interface PriorLayout { geometry: SceneGeometry; state: BoardState }

export type GeometryDiagnosticCode = 'safe_area' | 'top_level_overlap' | 'missing_rect' | 'element_too_small' | 'text_overflow' | 'child_outside_container' | 'edge_crossing' | 'edge_label_collision' | 'edge_text_collision' | 'text_collision' | 'sibling_overlap' | 'movement_path_collision' | 'edge_clearance' | 'edge_overlap' | 'kit_ink_collision';
export interface GeometryDiagnostic {
  code: GeometryDiagnosticCode;
  message: string;
  stateIndex?: number;
  elementIds: string[];
  edgeId?: string;
  /** Stable JSON-pointer-like input fields for targeted repairs. */
  fields: string[];
}

interface Known { id: string; spec: ElementSpec; seq: number; regions: Set<RegionId>; topLevel: boolean }

function preferredSize(spec: ElementSpec, capacity: number): { w: number; h: number } {
  switch (spec.type) {
    case 'kit': {
      const parsed = parseKitParams(spec.kit, spec.paramsJson);
      return parsed.ok ? KIT_REGISTRY[spec.kit as KitName].preferredSize(parsed.value, capacity) : { w: 420, h: 420 };
    }
    case 'entity': return { w: Math.max(240, measureTextWidth(spec.label, STYLE.font.sizes.body) + 60), h: 210 };
    case 'token': return { w: Math.max(130, measureTextWidth(spec.text, STYLE.font.sizes.body) + 50), h: 100 };
    case 'value': return { w: Math.max(300, measureTextWidth(`${spec.label} ${String(spec.value)}${spec.unit ?? ''}`, STYLE.font.sizes.body) + 60), h: 130 };
    case 'text': { const size = spec.role === 'title' ? STYLE.font.sizes.title : spec.role === 'label' ? STYLE.font.sizes.label : 30; return { w: measureTextWidth(spec.text, size) + 40, h: size * 1.5 }; }
    case 'equation': { const typeset = typesetTex(spec.latex); const rows = Math.max(1, capacity); const caption = rows > 1 ? 380 : 0; return typeset ? { w: Math.min(1300, 150 * typeset.aspect + 60 + caption), h: Math.min(760, 170 * rows) } : { w: 520 + caption, h: 160 * rows }; }
  }
}

const COLUMNS: Record<'middle' | 'top' | 'bottom', RegionId[]> = { middle: ['left', 'center', 'right'], top: ['top-left', 'top', 'top-right'], bottom: ['bottom-left', 'bottom', 'bottom-right'] };

function solveRegionRects(used: Set<RegionId>, weight: (region: RegionId) => number): Partial<Record<RegionId, Rect>> {
  const out: Partial<Record<RegionId, Rect>> = {};
  if (used.has('full')) out.full = CONTENT_RECT;
  const bandsUsed = (['top', 'middle', 'bottom'] as const).filter((band) => COLUMNS[band].some((region) => used.has(region)));
  if (bandsUsed.length === 0) return out;
  const topBand = bandsUsed.includes('top');
  const bottomBand = bandsUsed.includes('bottom');
  const middleBand = bandsUsed.includes('middle');
  const share = (band: 'top' | 'middle' | 'bottom'): number => {
    if (bandsUsed.length === 1) return 1;
    if (!middleBand) return 0.5;
    return band === 'middle' ? 1 - (topBand ? 0.34 : 0) - (bottomBand ? 0.34 : 0) : 0.34;
  };
  let y = CONTENT_RECT.y;
  for (const band of ['top', 'middle', 'bottom'] as const) {
    if (!bandsUsed.includes(band)) continue;
    const h = (CONTENT_RECT.h - GAP * (bandsUsed.length - 1)) * share(band);
    const cols = COLUMNS[band].filter((region) => used.has(region));
    const weights = cols.map((region) => Math.max(0.24, weight(region)));
    const total = weights.reduce((a, b) => a + b, 0);
    const avail = CONTENT_RECT.w - GAP * (cols.length - 1);
    let x = CONTENT_RECT.x;
    cols.forEach((region, i) => { const w = (avail * weights[i]!) / total; out[region] = { x, y, w, h }; x += w + GAP; });
    y += h + GAP;
  }
  return out;
}

function flow(items: Array<{ id: string; size: { w: number; h: number } }>, region: Rect): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  if (!items.length) return rects;
  const horizontal = region.w >= region.h * 1.2 || items.length === 1 ? region.w >= region.h : false;
  const mainOf = (s: { w: number; h: number }) => (horizontal ? s.w : s.h);
  const crossOf = (s: { w: number; h: number }) => (horizontal ? s.h : s.w);
  const mainAvail = (horizontal ? region.w : region.h) - GAP * (items.length - 1);
  const crossAvail = horizontal ? region.h : region.w;
  const scale = Math.min(MAX_UPSCALE, mainAvail / items.reduce((sum, item) => sum + mainOf(item.size), 0), crossAvail / Math.max(...items.map((item) => crossOf(item.size))));
  const usedMain = items.reduce((sum, item) => sum + mainOf(item.size) * scale, 0) + GAP * (items.length - 1);
  let cursor = (horizontal ? region.x : region.y) + ((horizontal ? region.w : region.h) - usedMain) / 2;
  for (const item of items) {
    const w = item.size.w * scale;
    const h = item.size.h * scale;
    rects.set(item.id, horizontal ? { x: cursor, y: region.y + (region.h - h) / 2, w, h } : { x: region.x + (region.w - w) / 2, y: cursor, w, h });
    cursor += (horizontal ? w : h) + GAP;
  }
  return rects;
}

const live = (el: BoardElement | undefined): el is BoardElement => el !== undefined && el.lifecycle.removedAtBeat === undefined;

function layoutCore(states: readonly BoardState[], pins: ReadonlyMap<string, Rect> = new Map()): SceneGeometry {
  // 1. Everything the scene ever shows, once.
  const known = new Map<string, Known>();
  const containerPeak = new Map<string, number>();
  const zonePeak = new Map<string, Map<string, number>>();
  const stepsPeak = new Map<string, number>();
  for (const state of states) {
    for (const el of Object.values(state.elements)) {
      if (!live(el)) continue;
      const entry = known.get(el.id) ?? { id: el.id, spec: el.spec, seq: el.seq, regions: new Set<RegionId>(), topLevel: false };
      if (!el.placement.container) { entry.topLevel = true; entry.regions.add(el.placement.region); }
      known.set(el.id, entry);
      if (el.steps) stepsPeak.set(el.id, Math.max(stepsPeak.get(el.id) ?? 0, el.steps.length));
    }
    for (const [containerId, list] of Object.entries(state.containers)) {
      const children = list.filter((id) => live(state.elements[id]));
      containerPeak.set(containerId, Math.max(containerPeak.get(containerId) ?? 0, children.length));
      const zones = zonePeak.get(containerId) ?? new Map<string, number>();
      const counts = new Map<string, number>();
      for (const id of children) { const zone = state.elements[id]!.placement.zone ?? ''; counts.set(zone, (counts.get(zone) ?? 0) + 1); }
      for (const [zone, count] of counts) zones.set(zone, Math.max(zones.get(zone) ?? 0, count));
      zonePeak.set(containerId, zones);
    }
  }
  const capacityOf = (id: string): number => containerPeak.get(id) ?? stepsPeak.get(id) ?? 0;
  const zoneCapacityOf = (id: string): Record<string, number> => Object.fromEntries(zonePeak.get(id) ?? []);
  const graphOf = (id: string) => {
    const nodes = new Map<string, { id: string; seq: number; preferred: { w: number; h: number } }>();
    const edges = new Map<string, { id: string; from: string; to: string }>();
    const directChild = (state: BoardState, endpoint: string): string | undefined => {
      let child = endpoint;
      const visited = new Set<string>();
      for (let parent = state.elements[child]?.placement.container; parent; parent = state.elements[child]?.placement.container) {
        if (visited.has(child)) return undefined;
        visited.add(child);
        if (parent === id) return child;
        child = parent;
      }
      return undefined;
    };
    for (const state of states) {
      for (const el of Object.values(state.elements)) if (live(el) && el.placement.container === id) nodes.set(el.id, { id: el.id, seq: el.seq, preferred: preferredSize(el.spec, capacityOf(el.id)) });
      for (const edge of Object.values(state.edges)) {
        if (edge.lifecycle.removedAtBeat !== undefined) continue;
        const from = directChild(state, edge.from); const to = directChild(state, edge.to);
        if (from && to && from !== to) edges.set(edge.id, { id: edge.id, from, to });
      }
    }
    const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    return { nodes: [...nodes.values()].sort((a, b) => a.seq - b.seq || compareId(a.id, b.id)), edges: [...edges.values()].sort((a, b) => compareId(a.id, b.id)) };
  };

  // 2. Top-level items per region, in creation order, and the rectangle each region gets.
  const byRegion = new Map<RegionId, Known[]>();
  for (const entry of [...known.values()].filter((k) => k.topLevel).sort((a, b) => a.seq - b.seq)) for (const region of entry.regions) byRegion.set(region, [...(byRegion.get(region) ?? []), entry]);
  const used = new Set<RegionId>(byRegion.keys());
  const regionWeight = (region: RegionId): number => (byRegion.get(region) ?? []).reduce((sum, k) => sum + preferredSize(k.spec, capacityOf(k.id)).w, 0) / 900;
  const regionRects = solveRegionRects(used, regionWeight);
  const topRects = new Map<string, Map<RegionId, Rect>>();
  for (const [region, entries] of byRegion) {
    const rect = regionRects[region];
    if (!rect) continue;
    const kept = entries.filter((k) => pins.has(k.id));
    const fresh = entries.filter((k) => !pins.has(k.id));
    for (const k of kept) topRects.set(k.id, new Map([...(topRects.get(k.id) ?? []), [region, pins.get(k.id)!]]));
    const placed = flow(fresh.map((k) => ({ id: k.id, size: preferredSize(k.spec, capacityOf(k.id)) })), kept.length ? freeRect(rect, kept.map((k) => pins.get(k.id)!)) : rect);
    for (const [id, r] of placed) topRects.set(id, new Map([...(topRects.get(id) ?? []), [region, r]]));
  }

  // 3. Kit geometry: top-level kits from their region rect, nested kits from their parent's slot.
  const kitGeometries = new Map<string, KitGeometry>();
  const kitRects = new Map<string, Rect>();
  const indexIn = (state: BoardState, container: string, el: BoardElement): number => {
    if (typeof el.placement.slot === 'number') return el.placement.slot;
    return (state.containers[container] ?? []).filter((cid) => (state.elements[cid]?.placement.zone ?? '') === (el.placement.zone ?? '')).indexOf(el.id);
  };
  const buildKit = (id: string, rect: Rect): void => {
    const entry = known.get(id);
    if (!entry || entry.spec.type !== 'kit' || kitGeometries.has(id)) return;
    const parsed = parseKitParams(entry.spec.kit, entry.spec.paramsJson);
    if (!parsed.ok) return;
    const def = KIT_REGISTRY[entry.spec.kit as KitName];
    kitRects.set(id, rect);
    kitGeometries.set(id, def.layout({ id, params: parsed.value, ...(entry.spec.label ? { label: entry.spec.label } : {}), rect, capacity: capacityOf(id), zoneCapacity: zoneCapacityOf(id), ...(entry.spec.kit === 'graph' ? { graph: graphOf(id) } : {}) }));
  };
  for (const [id, byRegionRect] of topRects) { const first = [...byRegionRect.values()][0]; if (first) buildKit(id, first); }
  // Resolve nested kits by dependency depth, independent of object insertion order in inherited states.
  for (let pass = 0; pass < known.size; pass++) {
    const before = kitGeometries.size;
    for (const state of states) for (const el of Object.values(state.elements)) {
      if (!live(el) || !el.placement.container || el.spec.type !== 'kit') continue;
      const parent = kitGeometries.get(el.placement.container);
      if (parent) buildKit(el.id, parent.slotRectForChild?.(el.id) ?? parent.slotRect(el.placement.zone, Math.max(0, indexIn(state, el.placement.container, el))));
    }
    if (kitGeometries.size === before) break;
  }

  const rectFor = (state: BoardState, id: string): Rect | undefined => {
    const el = state.elements[id];
    if (!el) return undefined;
    if (!el.placement.container) return topRects.get(id)?.get(el.placement.region);
    const parent = kitGeometries.get(el.placement.container);
    if (!parent) return undefined;
    if (el.spec.type === 'kit') return kitRects.get(id);
    return parent.slotRectForChild?.(el.id) ?? parent.slotRect(el.placement.zone, Math.max(0, indexIn(state, el.placement.container, el)));
  };

  const allRects = (): PlacedRect[] => {
    const out: PlacedRect[] = [];
    for (const [id, map] of topRects) for (const rect of map.values()) out.push({ id, rect });
    for (const [id, rect] of kitRects) if (!topRects.has(id)) out.push({ id, rect });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  const edgeRouteFor = (state: BoardState, edgeId: string): EdgeRoute | undefined => {
    const edge = state.edges[edgeId];
    if (!edge || edge.lifecycle.removedAtBeat !== undefined) return undefined;
    const from0 = renderedRectFor({ kitRect: (id) => kitRects.get(id), rectFor }, state, edge.from); const to0 = renderedRectFor({ kitRect: (id) => kitRects.get(id), rectFor }, state, edge.to);
    if (!from0 || !to0) return undefined;
    const related = new Set<string>([edge.from, edge.to]);
    for (const id of Object.keys(state.elements)) {
      for (let up: string | undefined = state.elements[id]?.placement.container; up; up = state.elements[up]?.placement.container) {
        if (up === edge.from || up === edge.to) related.add(id);
        if (up === id) break;
      }
      for (const end of [edge.from, edge.to]) for (let up: string | undefined = state.elements[end]?.placement.container; up; up = state.elements[up]?.placement.container) if (up === id) related.add(id);
    }
    const obstacles = Object.values(state.elements).filter(live).filter((element) => !related.has(element.id))
      .flatMap((element) => { const rect = renderedRectFor({ kitRect: (id) => kitRects.get(id), rectFor }, state, element.id); return rect ? [rect] : []; });
    return routeEdge(edgeId, from0, to0, edge.label, obstacles);
  };
  return { contentRect: CONTENT_RECT, regionRects, rectFor, kitGeometry: (id) => kitGeometries.get(id), kitRect: (id) => kitRects.get(id), allRects, edgeRouteFor, moved: [] };
}

const MIN_FREE = 120;
/** The largest strip of `region` beside the pinned rectangles; the whole region when no strip is big enough. */
function freeRect(region: Rect, pinned: readonly Rect[]): Rect {
  const x0 = Math.min(...pinned.map((r) => r.x)); const y0 = Math.min(...pinned.map((r) => r.y));
  const x1 = Math.max(...pinned.map((r) => r.x + r.w)); const y1 = Math.max(...pinned.map((r) => r.y + r.h));
  const strips: Rect[] = [
    { x: x1 + GAP, y: region.y, w: region.x + region.w - x1 - GAP, h: region.h },
    { x: region.x, y: region.y, w: x0 - GAP - region.x, h: region.h },
    { x: region.x, y: y1 + GAP, w: region.w, h: region.y + region.h - y1 - GAP },
    { x: region.x, y: region.y, w: region.w, h: y0 - GAP - region.y },
  ].filter((r) => r.w >= MIN_FREE && r.h >= MIN_FREE);
  return strips.sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? region;
}

/** Top-level elements that stay between two scenes with the same identity and region keep the rectangle they had. */
function retainedPins(first: BoardState, prior: PriorLayout): Map<string, Rect> {
  const pins = new Map<string, Rect>();
  for (const el of Object.values(first.elements)) {
    if (!live(el) || el.placement.container) continue;
    const before = prior.state.elements[el.id];
    if (!live(before) || before.placement.container || before.placement.region !== el.placement.region) continue;
    const rect = prior.geometry.rectFor(prior.state, el.id);
    if (rect) pins.set(el.id, rect);
  }
  return pins;
}

const sameRect = (a: Rect | undefined, b: Rect | undefined): boolean => a !== undefined && b !== undefined && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k as keyof Rect] - b[k as keyof Rect]) < 0.5);

/**
 * Lay out a scene. With a prior scene, retained objects keep their position and size when a valid layout exists with them
 * pinned; otherwise the fresh layout is used and the ids that had to move are reported in `moved`.
 */
export function layoutScene(states: readonly BoardState[], prior?: PriorLayout): SceneGeometry {
  const fresh = layoutCore(states);
  const pins = prior && states[0] ? retainedPins(states[0], prior) : new Map<string, Rect>();
  if (pins.size === 0) return fresh;
  const pinned = layoutCore(states, pins);
  if (validateSceneGeometry(pinned, states).length <= validateSceneGeometry(fresh, states).length) return pinned;
  return { ...fresh, moved: [...pins].filter(([id, rect]) => !sameRect(fresh.rectFor(states[0]!, id), rect)).map(([id]) => id).sort() };
}

const pointer = (kind: 'elements' | 'edges', id: string, field: string): string => `/${kind}/${id.replaceAll('~', '~0').replaceAll('/', '~1')}/${field}`;
const scaled = (rect: Rect, scale: unknown): Rect => {
  const k = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  return k === 1 ? rect : { x: rect.x + rect.w * (1 - k) / 2, y: rect.y + rect.h * (1 - k) / 2, w: rect.w * k, h: rect.h * k };
};

/** Match the renderer's nested-kit mapping and per-element scale for validation and exact routes. */
function renderedRectFor(geometry: Pick<SceneGeometry, 'rectFor' | 'kitRect'>, state: BoardState, id: string, seen = new Set<string>()): Rect | undefined {
  if (seen.has(id)) return undefined;
  const el = state.elements[id];
  let rect = geometry.rectFor(state, id);
  if (!el || !rect) return undefined;
  seen.add(id);
  if (el.placement.container) {
    const parent = renderedRectFor(geometry, state, el.placement.container, seen);
    const home = geometry.kitRect(el.placement.container);
    if (parent && home) rect = mapRect(rect, home, parent);
  }
  return scaled(rect, el.props.scale);
}

function mapRect(rect: Rect, home: Rect, now: Rect): Rect {
  const k = Math.min(now.w / Math.max(1, home.w), now.h / Math.max(1, home.h));
  const hc = center(home); const nc = center(now);
  return { x: nc.x + (rect.x - hc.x) * k, y: nc.y + (rect.y - hc.y) * k, w: rect.w * k, h: rect.h * k };
}

function mapTextRun(run: { x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end' }, home: Rect, now: Rect) {
  const k = Math.min(now.w / Math.max(1, home.w), now.h / Math.max(1, home.h));
  const hc = center(home); const nc = center(now);
  return { ...run, x: nc.x + (run.x - hc.x) * k, y: nc.y + (run.y - hc.y) * k, size: run.size * k };
}

interface InkLabel { owner: string; rect: Rect; field: string }
function inkRect(run: { x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end' }): Rect {
  const ink = measureTextInkBounds(run.text, run.size);
  const x0 = run.x + ink.x - (run.anchor === 'middle' ? ink.width / 2 : run.anchor === 'end' ? ink.width : 0);
  return { x: x0, y: run.y + ink.y, w: ink.width, h: ink.height };
}

function elementInkLabels(state: BoardState, geometry: SceneGeometry, ids: readonly string[]): InkLabel[] {
  const out: InkLabel[] = [];
  for (const id of ids) {
    const el = state.elements[id]!;
    const rect = renderedRectFor(geometry, state, id);
    if (!rect) continue;
    const slot = textSlot(el, rect);
    if (slot) {
      const fit = fitText(slot.text, slot.width, slot.height, slot.base);
      const baselines = lineBaselines(rect.y + rect.h / 2, fit);
      const field = el.spec.type === 'token' ? 'spec.text' : el.spec.type === 'entity' ? 'spec.label' : el.spec.type === 'value' ? 'value' : el.spec.type === 'text' ? 'spec.text' : el.spec.type === 'equation' ? 'value' : 'spec';
      fit.lines.forEach((text, i) => out.push({ owner: id, rect: inkRect({ x: rect.x + rect.w / 2, y: baselines[i]!, text, size: fit.size, anchor: 'middle' }), field }));
    }
    const kit = geometry.kitGeometry(id);
    const home = geometry.kitRect(id);
    for (const [i, run] of (kit?.frame.texts ?? []).entries()) out.push({ owner: id, rect: inkRect(home ? mapTextRun(run, home, rect) : run), field: `kit.frame.texts.${i}` });
  }
  return out;
}

function edgeHead(a: Point, b: Point, head = 22): [Point, Point, Point] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const p1 = { x: b.x - head * Math.cos(angle + 0.5), y: b.y - head * Math.sin(angle + 0.5) };
  const p2 = { x: b.x - head * Math.cos(angle - 0.5), y: b.y - head * Math.sin(angle - 0.5) };
  return [p1, b, p2];
}
function boundsOfPoints(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  return { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...ys) - Math.min(...ys) + 8 };
}

function orientation(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a: Point, b: Point, p: Point): boolean { return p.x >= Math.min(a.x, b.x) - 1 && p.x <= Math.max(a.x, b.x) + 1 && p.y >= Math.min(a.y, b.y) - 1 && p.y <= Math.max(a.y, b.y) + 1; }
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d); const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (Math.abs(o1) < 1 && onSegment(a, b, c)) || (Math.abs(o2) < 1 && onSegment(a, b, d)) || (Math.abs(o3) < 1 && onSegment(c, d, a)) || (Math.abs(o4) < 1 && onSegment(c, d, b));
}
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x; const dy = b.y - a.y; const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Smallest distance between two segments (0 when they touch or cross). */
function segmentDistance(a0: Point, a1: Point, b0: Point, b1: Point): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;
  return Math.min(pointSegmentDistance(a0, b0, b1), pointSegmentDistance(a1, b0, b1), pointSegmentDistance(b0, a0, a1), pointSegmentDistance(b1, a0, a1));
}
/** Two arrows closer than this (shaft to shaft) read as one line even though they never touch. An arrowhead is ~21px wide, so anything tighter than this crowds it. */
const EDGE_CLEARANCE_PX = 24;
/** Arrows leaving one element within this angle of each other are drawn on top of each other. */
const EDGE_MIN_ANGLE_RAD = 12 * Math.PI / 180;
function angleBetween(a: Point, b: Point): number {
  const la = Math.hypot(a.x, a.y); const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb))));
}
/** Straight pieces of a kit's non-text drawing (box borders, boundaries, dashes), mapped from its home rect to where it renders. */
function kitInkSegments(paths: ReadonlyArray<{ d: string }>, home: Rect | undefined, now: Rect): Array<[Point, Point]> {
  const k = home ? Math.min(now.w / Math.max(1, home.w), now.h / Math.max(1, home.h)) : 1;
  const hc = home ? center(home) : center(now); const nc = center(now);
  const map = (p: Point): Point => home ? { x: nc.x + (p.x - hc.x) * k, y: nc.y + (p.y - hc.y) * k } : p;
  const out: Array<[Point, Point]> = [];
  for (const path of paths) {
    let measure: InstanceType<typeof svgPathProperties>;
    try { measure = new svgPathProperties(path.d); } catch { continue; }
    const length = measure.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) continue;
    const steps = Math.max(1, Math.ceil(length / 24));
    let previous = map(measure.getPointAtLength(0));
    for (let i = 1; i <= steps; i++) { const next = map(measure.getPointAtLength(length * i / steps)); out.push([previous, next]); previous = next; }
  }
  return out;
}
function routeSamples(route: EdgeRoute, steps = 24): Point[] {
  const [a, b] = route.points;
  if (!route.controlPoint) return [a, b];
  const c = route.controlPoint;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps; const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}
function routeShaftSegments(route: EdgeRoute): Array<[Point, Point]> {
  const points = routeSamples(route);
  return points.slice(1).map((point, i) => [points[i]!, point]);
}
function routeSegments(route: EdgeRoute): Array<[Point, Point]> {
  return [...routeShaftSegments(route), [route.arrowhead[0], route.arrowhead[1]], [route.arrowhead[1], route.arrowhead[2]]];
}
function quadraticLength(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
}
/** Build a repeatable quadratic detour when the direct shaft would cross an unrelated element. */
export function routeEdge(id: string, from: Rect, to: Rect, label?: string, obstacles: readonly Rect[] = [], content: Rect = CONTENT_RECT): EdgeRoute {
  const a = borderPoint(from, center(to), 8); const b = borderPoint(to, center(from), 8);
  const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const direct: EdgeRoute = { id, points: [a, b], arrowhead: edgeHead(a, b), arrowheadBounds: boundsOfPoints(edgeHead(a, b)) };
  const blocked = obstacles.some((rect) => segmentCrossesRect(a, b, rect));
  let route = direct;
  if (blocked) {
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const offsets = [72, 112, 160, 216, 280];
    for (const offset of offsets) {
      const candidates = [1, -1].map((side) => ({ x: middle.x + normal.x * offset * side, y: middle.y + normal.y * offset * side }));
      const clear = candidates.find((controlPoint) => {
        const candidate: EdgeRoute = { ...direct, controlPoint };
        const samples = routeSamples(candidate);
        return samples.every((point) => point.x >= content.x && point.x <= content.x + content.w && point.y >= content.y && point.y <= content.y + content.h) &&
          !routeShaftSegments(candidate).some(([p, q]) => obstacles.some((rect) => segmentCrossesRect(p, q, rect)));
      });
      if (clear) { route = { ...direct, controlPoint: clear }; break; }
    }
  }
  const points = routeSamples(route);
  const tangent = route.controlPoint ? { x: b.x - route.controlPoint.x, y: b.y - route.controlPoint.y } : { x: dx, y: dy };
  const arrowhead = edgeHead({ x: b.x - tangent.x, y: b.y - tangent.y }, b);
  route = { ...route, arrowhead, arrowheadBounds: boundsOfPoints(arrowhead) };
  const mid = route.controlPoint ? points[Math.floor(points.length / 2)]! : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const x = mid.x + (route.controlPoint ? normal.x * 20 : 0); const y = mid.y + (route.controlPoint ? normal.y * 20 : -16);
  const displayed = label ? textRun(x, y, label, STYLE.font.sizes.note).text : undefined;
  return { ...route,
    ...(displayed ? { label: { x, y, text: displayed, size: STYLE.font.sizes.note, bounds: inkRect({ x, y, text: displayed, size: STYLE.font.sizes.note, anchor: 'middle' }) } } : {}) };
}

/** Structured geometry failures for planner repairs. IDs and fields remain stable even if diagnostic wording changes. */
export function diagnoseSceneGeometry(geometry: SceneGeometry, states: readonly BoardState[]): GeometryDiagnostic[] {
  const out: GeometryDiagnostic[] = [];
  const add = (d: GeometryDiagnostic) => out.push(d);
  for (const { id, rect } of geometry.allRects()) if (!contains(geometry.contentRect, rect, 1)) add({ code: 'safe_area', message: `${id} is outside the safe area`, elementIds: [id], fields: [pointer('elements', id, 'placement')] });
  states.forEach((state, index) => {
    const liveIds = Object.values(state.elements).filter(live).map((el) => el.id).sort();
    const tops = liveIds.filter((id) => !state.elements[id]!.placement.container);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const a = renderedRectFor(geometry, state, tops[i]!);
      const b = renderedRectFor(geometry, state, tops[j]!);
      if (a && b && overlaps(a, b, 2)) add({ code: 'top_level_overlap', stateIndex: index, message: `state ${index + 1}: ${tops[i]} overlaps ${tops[j]}`, elementIds: [tops[i]!, tops[j]!], fields: [pointer('elements', tops[i]!, 'placement'), pointer('elements', tops[j]!, 'placement')] });
    }
    for (const id of liveIds) {
      const el = state.elements[id]!; const rect = renderedRectFor(geometry, state, id);
      if (!rect) { add({ code: 'missing_rect', stateIndex: index, message: `state ${index + 1}: ${id} has no rectangle`, elementIds: [id], fields: [pointer('elements', id, 'placement')] }); continue; }
      if (!contains(geometry.contentRect, rect, 1)) add({ code: 'safe_area', stateIndex: index, message: `state ${index + 1}: ${id} is outside the safe area after transform`, elementIds: [id], fields: [pointer('elements', id, 'props.scale')] });
      if (rect.w < 24 || rect.h < 24) add({ code: 'element_too_small', stateIndex: index, message: `state ${index + 1}: ${id} is too small to read (${Math.round(rect.w)}x${Math.round(rect.h)})`, elementIds: [id], fields: [pointer('elements', id, 'placement')] });
      if (el.spec.type === 'kit') {
        const home = geometry.kitRect(id); const k = home ? Math.min(rect.w / Math.max(1, home.w), rect.h / Math.max(1, home.h)) : 1;
        if (k < 1 - 1e-6 && geometry.kitGeometry(id)?.frame.texts.some((run) => run.size * k < 32 - 1e-6)) add({ code: 'element_too_small', stateIndex: index, message: `state ${index + 1}: ${id} scales kit text below the 32px readability floor; remove the scale or revise the kit content`, elementIds: [id], fields: [pointer('elements', id, 'props.scale')] });
      }
      const overflow = textOverflow(el, rect);
      if (overflow) add({ code: 'text_overflow', stateIndex: index, message: `state ${index + 1}: ${id} text "${overflow}" does not fit its ${Math.round(rect.w)}px slot at a readable size; shorten the text`, elementIds: [id], fields: [pointer('elements', id, 'spec')] });
      if (el.placement.container) {
        const parent = renderedRectFor(geometry, state, el.placement.container);
        if (parent && !contains(parent, rect, 1)) add({ code: 'child_outside_container', stateIndex: index, message: `state ${index + 1}: ${id} is outside ${el.placement.container}`, elementIds: [id, el.placement.container], fields: [pointer('elements', id, 'placement')] });
      }
    }
    const labels = elementInkLabels(state, geometry, liveIds);
    // Text ink must clear unrelated shapes and other labels. A label is allowed inside its own element/container.
    for (const label of labels) {
      for (const id of liveIds) {
        if (id === label.owner) continue;
        let ancestor = state.elements[label.owner]?.placement.container;
        let related = false;
        while (ancestor) { if (ancestor === id) { related = true; break; } ancestor = state.elements[ancestor]?.placement.container; }
        if (related) continue;
        const box = renderedRectFor(geometry, state, id);
        if (box && overlaps(label.rect, box, 1)) add({ code: 'text_collision', stateIndex: index, message: `state ${index + 1}: text on ${label.owner} collides with ${id}`, elementIds: [label.owner, id], fields: [pointer('elements', label.owner, label.field), pointer('elements', id, 'placement')] });
      }
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!; const b = labels[j]!;
      if (a.owner !== b.owner && overlaps(a.rect, b.rect, 1)) add({ code: 'text_collision', stateIndex: index, message: `state ${index + 1}: text on ${a.owner} collides with text on ${b.owner}`, elementIds: [a.owner, b.owner], fields: [pointer('elements', a.owner, a.field), pointer('elements', b.owner, b.field)] });
    }
    // Non-text ink of a kit (box borders, zone boundaries, dashes) must not run through any label that sits on or inside that kit.
    for (const kitId of liveIds.filter((id) => state.elements[id]!.spec.type === 'kit')) {
      const rect = renderedRectFor(geometry, state, kitId); const frame = geometry.kitGeometry(kitId)?.frame;
      if (!rect || !frame) continue;
      const segments = kitInkSegments(frame.paths, geometry.kitRect(kitId), rect);
      const inside = (owner: string): boolean => { for (let up: string | undefined = owner; up; up = state.elements[up]?.placement.container) if (up === kitId) return true; return false; };
      const reported = new Set<string>();
      for (const label of labels) {
        if (!inside(label.owner) || reported.has(`${label.owner}|${label.field}`)) continue;
        if (segments.some(([p, q]) => segmentCrossesRect(p, q, label.rect, 0))) {
          reported.add(`${label.owner}|${label.field}`);
          add({ code: 'kit_ink_collision', stateIndex: index, message: `state ${index + 1}: a line of kit ${kitId} runs through text on ${label.owner}; shorten the text or give it more room`, elementIds: label.owner === kitId ? [kitId] : [label.owner, kitId], fields: [pointer('elements', label.owner, label.field)] });
        }
      }
    }
    for (const edge of Object.values(state.edges).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (edge.lifecycle.removedAtBeat !== undefined) continue;
      const route = geometry.edgeRouteFor(state, edge.id);
      if (!route) continue;
      const related = new Set<string>([edge.from, edge.to]);
      for (const id of liveIds) { for (let up: string | undefined = state.elements[id]!.placement.container; up; up = state.elements[up]?.placement.container) if (up === edge.from || up === edge.to) related.add(id); }
      for (const end of [edge.from, edge.to]) for (let up: string | undefined = state.elements[end]?.placement.container; up; up = state.elements[up]?.placement.container) related.add(up);
      for (const id of liveIds) {
        if (related.has(id)) continue;
        const rect = renderedRectFor(geometry, state, id);
        if (rect && routeShaftSegments(route).some(([p, q]) => segmentCrossesRect(p, q, rect))) add({ code: 'edge_crossing', stateIndex: index, message: `state ${index + 1}: arrow ${edge.id} (${edge.from} to ${edge.to}) crosses ${id}; place them so the arrow has a clear path`, elementIds: [id], edgeId: edge.id, fields: [pointer('edges', edge.id, 'from'), pointer('edges', edge.id, 'to'), pointer('elements', id, 'placement')] });
      }
      const head = route.arrowheadBounds;
      const edgeLabels: InkLabel[] = route.label ? [{ owner: edge.id, rect: route.label.bounds, field: 'label' }] : [];
      for (const label of edgeLabels) {
        if (overlaps(label.rect, head, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with its arrowhead`, elementIds: [], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label')] });
        for (const other of labels) if (overlaps(label.rect, other.rect, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label'), pointer('elements', other.owner, other.field)] });
        for (const id of liveIds) if (!related.has(id)) { const rawBox = geometry.rectFor(state, id); const box = rawBox ? scaled(rawBox, state.elements[id]?.props.scale) : undefined; if (box && overlaps(label.rect, box, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with ${id}`, elementIds: [id], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label'), pointer('elements', id, 'placement')] }); }
      }
      for (const other of labels) if (overlaps(head, other.rect, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: arrowhead on ${edge.id} collides with text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'to'), pointer('elements', other.owner, other.field)] });
      for (const other of labels) if (!related.has(other.owner) && routeShaftSegments(route).some(([p, q]) => segmentCrossesRect(p, q, other.rect, 1))) add({ code: 'edge_text_collision', stateIndex: index, message: `state ${index + 1}: arrow ${edge.id} crosses text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'from'), pointer('edges', edge.id, 'to'), pointer('elements', other.owner, other.field)] });
    }
    const activeEdges = Object.values(state.edges).filter((edge) => edge.lifecycle.removedAtBeat === undefined).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (let i = 0; i < activeEdges.length; i++) for (let j = i + 1; j < activeEdges.length; j++) {
      const first = activeEdges[i]!; const second = activeEdges[j]!;
      const a = geometry.edgeRouteFor(state, first.id); const b = geometry.edgeRouteFor(state, second.id);
      if (!a || !b) continue;
      const sharedIds = [first.from, first.to].filter((id) => id === second.from || id === second.to);
      if (sharedIds.length) {
        // Arrows that meet at an element are allowed to touch there, but must fan out instead of running on one line.
        const edgeFields = [pointer('edges', first.id, 'from'), pointer('edges', second.id, 'from')];
        const away = (edge: typeof first, route: EdgeRoute, shared: string): Point => {
          const start = edge.from === shared ? 0 : 1; const samples = routeSamples(route);
          const near = samples[start === 0 ? 1 : samples.length - 2]!; const origin = samples[start === 0 ? 0 : samples.length - 1]!;
          return { x: near.x - origin.x, y: near.y - origin.y };
        };
        const lengthOf = (route: EdgeRoute) => quadraticLength(routeSamples(route));
        const sameLine = sharedIds.length === 2 && routeShaftSegments(a).some(([a0, a1]) => routeShaftSegments(b).some(([b0, b1]) => segmentDistance(a0, a1, b0, b1) < EDGE_CLEARANCE_PX));
        const stacked = sharedIds.length === 1 && lengthOf(a) > 40 && lengthOf(b) > 40 && angleBetween(away(first, a, sharedIds[0]!), away(second, b, sharedIds[0]!)) < EDGE_MIN_ANGLE_RAD;
        if (sameLine || stacked) add({ code: 'edge_overlap', stateIndex: index, message: `state ${index + 1}: arrows ${first.id} and ${second.id} run on top of each other${sharedIds.length === 1 ? ` out of ${sharedIds[0]}` : ''}; place their ends so they fan out`, elementIds: [], edgeId: first.id, fields: edgeFields });
        continue;
      }
      const aSegments = routeSegments(a); const bSegments = routeSegments(b);
      if (aSegments.some(([a0, a1]) => bSegments.some(([b0, b1]) => segmentsIntersect(a0, a1, b0, b1)))) add({ code: 'edge_crossing', stateIndex: index, message: `state ${index + 1}: arrows ${first.id} and ${second.id} cross; reroute or reposition their endpoints`, elementIds: [], edgeId: first.id, fields: [pointer('edges', first.id, 'from'), pointer('edges', first.id, 'to'), pointer('edges', second.id, 'from'), pointer('edges', second.id, 'to')] });
      else if (routeShaftSegments(a).some(([a0, a1]) => routeShaftSegments(b).some(([b0, b1]) => segmentDistance(a0, a1, b0, b1) < EDGE_CLEARANCE_PX))) add({ code: 'edge_clearance', stateIndex: index, message: `state ${index + 1}: arrows ${first.id} and ${second.id} run less than ${EDGE_CLEARANCE_PX}px apart and read as one line; move their ends apart`, elementIds: [], edgeId: first.id, fields: [pointer('edges', first.id, 'from'), pointer('edges', second.id, 'from')] });
      const shaftOrHeadCrosses = (route: EdgeRoute, box: Rect): boolean => routeShaftSegments(route).some(([p, q]) => segmentCrossesRect(p, q, box, 1)) || route.arrowhead.some((point, k) => k > 0 && segmentCrossesRect(route.arrowhead[k - 1]!, point, box, 1));
      if (a.label && shaftOrHeadCrosses(b, a.label.bounds)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: arrow ${second.id} or its arrowhead crosses the label on ${first.id}`, elementIds: [], edgeId: first.id, fields: [pointer('edges', first.id, 'label'), pointer('edges', second.id, 'from'), pointer('edges', second.id, 'to')] });
      if (b.label && shaftOrHeadCrosses(a, b.label.bounds)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: arrow ${first.id} or its arrowhead crosses the label on ${second.id}`, elementIds: [], edgeId: second.id, fields: [pointer('edges', second.id, 'label'), pointer('edges', first.id, 'from'), pointer('edges', first.id, 'to')] });
      if (a.label && b.label && overlaps(a.label.bounds, b.label.bounds, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: labels on arrows ${first.id} and ${second.id} overlap`, elementIds: [], edgeId: first.id, fields: [pointer('edges', first.id, 'label'), pointer('edges', second.id, 'label')] });
    }
    const siblings = new Map<string, string[]>();
    for (const id of liveIds) { const c = state.elements[id]!.placement.container; if (c) siblings.set(c, [...(siblings.get(c) ?? []), id]); }
    for (const [container, ids] of siblings) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = renderedRectFor(geometry, state, ids[i]!);
      const b = renderedRectFor(geometry, state, ids[j]!);
      if (a && b && overlaps(a, b, 1)) add({ code: 'sibling_overlap', stateIndex: index, message: `state ${index + 1}: ${ids[i]} overlaps ${ids[j]} inside ${container}`, elementIds: [ids[i]!, ids[j]!], fields: [pointer('elements', ids[i]!, 'placement'), pointer('elements', ids[j]!, 'placement')] });
    }
  });
  // The renderer interpolates moves linearly. Test relative center trajectories against the Minkowski sum
  // of the two rendered rectangles so a collision between valid endpoints cannot pass unnoticed.
  for (let index = 1; index < states.length; index++) {
    const before = states[index - 1]!; const after = states[index]!;
    const ids = Object.keys(before.elements).filter((id) => live(before.elements[id]) && live(after.elements[id])).sort();
    const ancestor = (state: BoardState, child: string, parent: string): boolean => {
      for (let up = state.elements[child]?.placement.container; up; up = state.elements[up]?.placement.container) if (up === parent) return true;
      return false;
    };
    const placementChanged = (id: string): boolean => {
      const chain = (state: BoardState): string => {
        const parts: string[] = []; const seen = new Set<string>();
        for (let current: string | undefined = id; current && !seen.has(current); current = state.elements[current]?.placement.container) {
          seen.add(current); const el = state.elements[current]; if (!el) break;
          parts.push(`${current}:${JSON.stringify(el.placement)}`);
        }
        return parts.join('|');
      };
      return chain(before) !== chain(after);
    };
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const aId = ids[i]!; const bId = ids[j]!;
      if (ancestor(before, aId, bId) || ancestor(after, aId, bId) || ancestor(before, bId, aId) || ancestor(after, bId, aId)) continue;
      const a0 = renderedRectFor(geometry, before, aId); const a1 = renderedRectFor(geometry, after, aId);
      const b0 = renderedRectFor(geometry, before, bId); const b1 = renderedRectFor(geometry, after, bId);
      if (!a0 || !a1 || !b0 || !b1 || (sameRect(a0, a1) && sameRect(b0, b1))) continue;
      if (!placementChanged(aId) && !placementChanged(bId)) continue;
      const ac0 = center(a0); const ac1 = center(a1); const bc0 = center(b0); const bc1 = center(b1);
      const relative0 = { x: ac0.x - bc0.x, y: ac0.y - bc0.y }; const relative1 = { x: ac1.x - bc1.x, y: ac1.y - bc1.y };
      const halfW = Math.max(a0.w, a1.w) / 2 + Math.max(b0.w, b1.w) / 2; const halfH = Math.max(a0.h, a1.h) / 2 + Math.max(b0.h, b1.h) / 2;
      if (segmentCrossesRect(relative0, relative1, { x: -halfW, y: -halfH, w: halfW * 2, h: halfH * 2 }, 0)) add({ code: 'movement_path_collision', stateIndex: index, message: `transition ${index}: ${aId} and ${bId} collide along a movement path; change placement or simplify the move`, elementIds: [aId, bId], fields: [pointer('elements', aId, 'placement'), pointer('elements', bId, 'placement')] });
    }
  }
  return out;
}

/** Compatibility message API retained for callers; planner repairs should use diagnoseSceneGeometry. */
export function validateSceneGeometry(geometry: SceneGeometry, states: readonly BoardState[]): string[] {
  return diagnoseSceneGeometry(geometry, states).map((diagnostic) => diagnostic.message);
}

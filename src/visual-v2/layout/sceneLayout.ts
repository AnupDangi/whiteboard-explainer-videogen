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

export type GeometryDiagnosticCode = 'safe_area' | 'top_level_overlap' | 'missing_rect' | 'element_too_small' | 'text_overflow' | 'child_outside_container' | 'edge_crossing' | 'edge_label_collision' | 'edge_text_collision' | 'text_collision' | 'sibling_overlap';
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
    const from0 = rectFor(state, edge.from); const to0 = rectFor(state, edge.to);
    if (!from0 || !to0) return undefined;
    return routeEdge(edgeId, scaled(from0, state.elements[edge.from]?.props.scale), scaled(to0, state.elements[edge.to]?.props.scale), edge.label);
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
    const raw = geometry.rectFor(state, id);
    if (!raw) continue;
    const rect = scaled(raw, el.props.scale);
    const slot = textSlot(el, rect);
    if (slot) {
      const fit = fitText(slot.text, slot.width, slot.height, slot.base);
      const baselines = lineBaselines(rect.y + rect.h / 2, fit);
      const field = el.spec.type === 'token' ? 'spec.text' : el.spec.type === 'entity' ? 'spec.label' : el.spec.type === 'value' ? 'value' : el.spec.type === 'text' ? 'spec.text' : el.spec.type === 'equation' ? 'value' : 'spec';
      fit.lines.forEach((text, i) => out.push({ owner: id, rect: inkRect({ x: rect.x + rect.w / 2, y: baselines[i]!, text, size: fit.size, anchor: 'middle' }), field }));
    }
    const kit = geometry.kitGeometry(id);
    for (const [i, run] of (kit?.frame.texts ?? []).entries()) out.push({ owner: id, rect: inkRect(run), field: `kit.frame.texts.${i}` });
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

export function routeEdge(id: string, from: Rect, to: Rect, label?: string): EdgeRoute {
  const a = borderPoint(from, center(to), 8); const b = borderPoint(to, center(from), 8);
  const arrowhead = edgeHead(a, b);
  const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2 - 16;
  const displayed = label ? textRun(x, y, label, STYLE.font.sizes.note).text : undefined;
  return { id, points: [a, b], arrowhead, arrowheadBounds: boundsOfPoints(arrowhead),
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
      const a0 = geometry.rectFor(state, tops[i]!); const b0 = geometry.rectFor(state, tops[j]!);
      const a = a0 ? scaled(a0, state.elements[tops[i]!]!.props.scale) : undefined;
      const b = b0 ? scaled(b0, state.elements[tops[j]!]!.props.scale) : undefined;
      if (a && b && overlaps(a, b, 2)) add({ code: 'top_level_overlap', stateIndex: index, message: `state ${index + 1}: ${tops[i]} overlaps ${tops[j]}`, elementIds: [tops[i]!, tops[j]!], fields: [pointer('elements', tops[i]!, 'placement'), pointer('elements', tops[j]!, 'placement')] });
    }
    for (const id of liveIds) {
      const el = state.elements[id]!; const raw = geometry.rectFor(state, id);
      if (!raw) { add({ code: 'missing_rect', stateIndex: index, message: `state ${index + 1}: ${id} has no rectangle`, elementIds: [id], fields: [pointer('elements', id, 'placement')] }); continue; }
      const rect = scaled(raw, el.props.scale);
      if (!contains(geometry.contentRect, rect, 1)) add({ code: 'safe_area', stateIndex: index, message: `state ${index + 1}: ${id} is outside the safe area after transform`, elementIds: [id], fields: [pointer('elements', id, 'props.scale')] });
      if (rect.w < 24 || rect.h < 24) add({ code: 'element_too_small', stateIndex: index, message: `state ${index + 1}: ${id} is too small to read (${Math.round(rect.w)}x${Math.round(rect.h)})`, elementIds: [id], fields: [pointer('elements', id, 'placement')] });
      const overflow = textOverflow(el, rect);
      if (overflow) add({ code: 'text_overflow', stateIndex: index, message: `state ${index + 1}: ${id} text "${overflow}" does not fit its ${Math.round(rect.w)}px slot at a readable size; shorten the text`, elementIds: [id], fields: [pointer('elements', id, 'spec')] });
      if (el.placement.container) {
        const rawParent = geometry.rectFor(state, el.placement.container);
        const parent = rawParent ? scaled(rawParent, state.elements[el.placement.container]?.props.scale) : undefined;
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
        const rawBox = geometry.rectFor(state, id);
        const box = rawBox ? scaled(rawBox, state.elements[id]?.props.scale) : undefined;
        if (box && overlaps(label.rect, box, 1)) add({ code: 'text_collision', stateIndex: index, message: `state ${index + 1}: text on ${label.owner} collides with ${id}`, elementIds: [label.owner, id], fields: [pointer('elements', label.owner, label.field), pointer('elements', id, 'placement')] });
      }
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!; const b = labels[j]!;
      if (a.owner !== b.owner && overlaps(a.rect, b.rect, 1)) add({ code: 'text_collision', stateIndex: index, message: `state ${index + 1}: text on ${a.owner} collides with text on ${b.owner}`, elementIds: [a.owner, b.owner], fields: [pointer('elements', a.owner, a.field), pointer('elements', b.owner, b.field)] });
    }
    for (const edge of Object.values(state.edges).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (edge.lifecycle.removedAtBeat !== undefined) continue;
      const route = geometry.edgeRouteFor(state, edge.id);
      if (!route) continue;
      const [a, b] = route.points;
      const related = new Set<string>([edge.from, edge.to]);
      for (const id of liveIds) { for (let up: string | undefined = state.elements[id]!.placement.container; up; up = state.elements[up]?.placement.container) if (up === edge.from || up === edge.to) related.add(id); }
      for (const end of [edge.from, edge.to]) for (let up: string | undefined = state.elements[end]?.placement.container; up; up = state.elements[up]?.placement.container) related.add(up);
      for (const id of liveIds) {
        if (related.has(id)) continue;
        const rawRect = geometry.rectFor(state, id);
        const rect = rawRect ? scaled(rawRect, state.elements[id]?.props.scale) : undefined;
        if (rect && segmentCrossesRect(a, b, rect)) add({ code: 'edge_crossing', stateIndex: index, message: `state ${index + 1}: arrow ${edge.id} (${edge.from} to ${edge.to}) crosses ${id}; place them so the arrow has a clear path`, elementIds: [id], edgeId: edge.id, fields: [pointer('edges', edge.id, 'from'), pointer('edges', edge.id, 'to'), pointer('elements', id, 'placement')] });
      }
      const head = route.arrowheadBounds;
      const edgeLabels: InkLabel[] = route.label ? [{ owner: edge.id, rect: route.label.bounds, field: 'label' }] : [];
      for (const label of edgeLabels) {
        if (overlaps(label.rect, head, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with its arrowhead`, elementIds: [], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label')] });
        for (const other of labels) if (overlaps(label.rect, other.rect, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label'), pointer('elements', other.owner, other.field)] });
        for (const id of liveIds) if (!related.has(id)) { const rawBox = geometry.rectFor(state, id); const box = rawBox ? scaled(rawBox, state.elements[id]?.props.scale) : undefined; if (box && overlaps(label.rect, box, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: label on arrow ${edge.id} collides with ${id}`, elementIds: [id], edgeId: edge.id, fields: [pointer('edges', edge.id, 'label'), pointer('elements', id, 'placement')] }); }
      }
      for (const other of labels) if (overlaps(head, other.rect, 1)) add({ code: 'edge_label_collision', stateIndex: index, message: `state ${index + 1}: arrowhead on ${edge.id} collides with text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'to'), pointer('elements', other.owner, other.field)] });
      for (const other of labels) if (!related.has(other.owner) && segmentCrossesRect(a, b, other.rect, 1)) add({ code: 'edge_text_collision', stateIndex: index, message: `state ${index + 1}: arrow ${edge.id} crosses text on ${other.owner}`, elementIds: [other.owner], edgeId: edge.id, fields: [pointer('edges', edge.id, 'from'), pointer('edges', edge.id, 'to'), pointer('elements', other.owner, other.field)] });
    }
    const siblings = new Map<string, string[]>();
    for (const id of liveIds) { const c = state.elements[id]!.placement.container; if (c) siblings.set(c, [...(siblings.get(c) ?? []), id]); }
    for (const [container, ids] of siblings) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a0 = geometry.rectFor(state, ids[i]!); const b0 = geometry.rectFor(state, ids[j]!);
      const a = a0 ? scaled(a0, state.elements[ids[i]!]!.props.scale) : undefined;
      const b = b0 ? scaled(b0, state.elements[ids[j]!]!.props.scale) : undefined;
      if (a && b && overlaps(a, b, 1)) add({ code: 'sibling_overlap', stateIndex: index, message: `state ${index + 1}: ${ids[i]} overlaps ${ids[j]} inside ${container}`, elementIds: [ids[i]!, ids[j]!], fields: [pointer('elements', ids[i]!, 'placement'), pointer('elements', ids[j]!, 'placement')] });
    }
  });
  return out;
}

/** Compatibility message API retained for callers; planner repairs should use diagnoseSceneGeometry. */
export function validateSceneGeometry(geometry: SceneGeometry, states: readonly BoardState[]): string[] {
  return diagnoseSceneGeometry(geometry, states).map((diagnostic) => diagnostic.message);
}

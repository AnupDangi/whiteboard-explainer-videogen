import { STYLE } from '../../render/style.js';
import { measureTextWidth } from '../../layout/measure.js';
import { typesetTex } from '../../render/math.js';
import type { ElementSpec, KitName, RegionId } from '../board-ops/types.js';
import type { BoardElement, BoardState } from '../board-state/types.js';
import { KIT_REGISTRY, parseKitParams } from '../kits/registry.js';
import type { KitGeometry } from '../kits/types.js';
import { borderPoint, center, contains, overlaps, segmentCrossesRect, type Rect } from '../kits/geometry.js';
import { textOverflow } from './textFit.js';

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

export interface SceneGeometry {
  contentRect: Rect;
  regionRects: Partial<Record<RegionId, Rect>>;
  /** The rect an element occupies in a given state, following its placement there. */
  rectFor(state: BoardState, id: string): Rect | undefined;
  kitGeometry(id: string): KitGeometry | undefined;
  /** The rectangle a kit's cached drawing and slots were laid out in; a kit shown elsewhere is the same drawing mapped from here. */
  kitRect(id: string): Rect | undefined;
  allRects(): PlacedRect[];
  /** Retained elements whose rectangle had to change from the previous scene because keeping it left no valid layout. */
  moved: string[];
}

/** The previous scene's final board and geometry, so objects that stay keep their position and size across the cut. */
export interface PriorLayout { geometry: SceneGeometry; state: BoardState }

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
    kitGeometries.set(id, def.layout({ id, params: parsed.value, ...(entry.spec.label ? { label: entry.spec.label } : {}), rect, capacity: capacityOf(id), zoneCapacity: zoneCapacityOf(id) }));
  };
  for (const [id, byRegionRect] of topRects) { const first = [...byRegionRect.values()][0]; if (first) buildKit(id, first); }
  for (const state of states) for (const el of Object.values(state.elements)) {
    if (!live(el) || !el.placement.container || el.spec.type !== 'kit') continue;
    const parent = kitGeometries.get(el.placement.container);
    if (parent) buildKit(el.id, parent.slotRect(el.placement.zone, Math.max(0, indexIn(state, el.placement.container, el))));
  }

  const rectFor = (state: BoardState, id: string): Rect | undefined => {
    const el = state.elements[id];
    if (!el) return undefined;
    if (!el.placement.container) return topRects.get(id)?.get(el.placement.region);
    const parent = kitGeometries.get(el.placement.container);
    if (!parent) return undefined;
    if (el.spec.type === 'kit') return kitRects.get(id);
    return parent.slotRect(el.placement.zone, Math.max(0, indexIn(state, el.placement.container, el)));
  };

  const allRects = (): PlacedRect[] => {
    const out: PlacedRect[] = [];
    for (const [id, map] of topRects) for (const rect of map.values()) out.push({ id, rect });
    for (const [id, rect] of kitRects) if (!topRects.has(id)) out.push({ id, rect });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  return { contentRect: CONTENT_RECT, regionRects, rectFor, kitGeometry: (id) => kitGeometries.get(id), kitRect: (id) => kitRects.get(id), allRects, moved: [] };
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

/** Geometry problems that would change meaning on screen: overflow, overlap between siblings, children outside their kit, slots too small. */
export function validateSceneGeometry(geometry: SceneGeometry, states: readonly BoardState[]): string[] {
  const problems: string[] = [];
  for (const { id, rect } of geometry.allRects()) if (!contains(geometry.contentRect, rect, 1)) problems.push(`${id} is outside the safe area`);
  states.forEach((state, index) => {
    const liveIds = Object.values(state.elements).filter(live).map((el) => el.id);
    const tops = liveIds.filter((id) => !state.elements[id]!.placement.container);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const a = geometry.rectFor(state, tops[i]!);
      const b = geometry.rectFor(state, tops[j]!);
      if (a && b && overlaps(a, b, 2)) problems.push(`state ${index + 1}: ${tops[i]} overlaps ${tops[j]}`);
    }
    for (const id of liveIds) {
      const el = state.elements[id]!;
      const rect = geometry.rectFor(state, id);
      if (!rect) { problems.push(`state ${index + 1}: ${id} has no rectangle`); continue; }
      if (rect.w < 24 || rect.h < 24) problems.push(`state ${index + 1}: ${id} is too small to read (${Math.round(rect.w)}x${Math.round(rect.h)})`);
      const overflow = textOverflow(el, rect);
      if (overflow) problems.push(`state ${index + 1}: ${id} text "${overflow}" does not fit its ${Math.round(rect.w)}px slot at a readable size; shorten the text`);
      if (el.placement.container) {
        const parent = geometry.rectFor(state, el.placement.container);
        if (parent && !contains(parent, rect, 1)) problems.push(`state ${index + 1}: ${id} is outside ${el.placement.container}`);
      }
    }
    for (const edge of Object.values(state.edges)) {
      if (edge.lifecycle.removedAtBeat !== undefined) continue;
      const from = geometry.rectFor(state, edge.from); const to = geometry.rectFor(state, edge.to);
      if (!from || !to) continue;
      const a = borderPoint(from, center(to), 8); const b = borderPoint(to, center(from), 8);
      const related = new Set<string>([edge.from, edge.to]);
      for (const id of liveIds) { for (let up: string | undefined = state.elements[id]!.placement.container; up; up = state.elements[up]?.placement.container) if (up === edge.from || up === edge.to) related.add(id); }
      for (const end of [edge.from, edge.to]) for (let up: string | undefined = state.elements[end]?.placement.container; up; up = state.elements[up]?.placement.container) related.add(up);
      for (const id of liveIds) {
        if (related.has(id)) continue;
        const rect = geometry.rectFor(state, id);
        if (rect && segmentCrossesRect(a, b, rect)) problems.push(`state ${index + 1}: arrow ${edge.id} (${edge.from} to ${edge.to}) crosses ${id}; place them so the arrow has a clear path`);
      }
    }
    const siblings = new Map<string, string[]>();
    for (const id of liveIds) { const c = state.elements[id]!.placement.container; if (c) siblings.set(c, [...(siblings.get(c) ?? []), id]); }
    for (const [container, ids] of siblings) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = geometry.rectFor(state, ids[i]!);
      const b = geometry.rectFor(state, ids[j]!);
      if (a && b && overlaps(a, b, 1)) problems.push(`state ${index + 1}: ${ids[i]} overlaps ${ids[j]} inside ${container}`);
    }
  });
  return problems;
}

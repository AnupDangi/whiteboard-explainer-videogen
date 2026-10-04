import type { PrimitiveVisual, StrokePath } from '../../shared/types.js';
import { STYLE } from '../../render/style.js';
import { measureTextWidth } from '../../layout/measure.js';
import { roughenPath } from '../../render/roughAdapter.js';
import { embedSvg, fillSvg, sequentialStrokes, textSvg, wipe } from '../../render/renderScene.js';
import { escapeXml, progress, svgDocument } from '../../shared/svg.js';
import { canonicalHash } from '../../harness/replayDeterminism.js';
import type { BoardEdge, BoardElement, BoardState } from '../board-state/types.js';
import { layoutScene, type PriorLayout, type SceneGeometry } from '../layout/sceneLayout.js';
import type { SceneTimeline } from '../timeline/compile.js';
import type { Rect } from '../kits/geometry.js';
import { edgeVisual, elementVisual, ringVisual, strikeVisual, type ConceptIndex } from './visuals.js';
import type { EntityResolver } from '../resolver/typeGate.js';

export interface CompiledScene {
  sceneId: string;
  title: string;
  timeline: SceneTimeline;
  geometry: SceneGeometry;
  /** Rough.js seeds derive from this and the element id, so a frame is a pure function of (scene, time). */
  seedBase: string;
  /** Concept kinds, so entities are depicted by type (V2 plan Phase 7). */
  concepts?: ConceptIndex;
}

export function compileScene(sceneId: string, title: string, timeline: SceneTimeline, lessonId = 'lesson', concepts?: ConceptIndex, prior?: PriorLayout): CompiledScene {
  return { sceneId, title, timeline, geometry: layoutScene(timeline.states, prior), seedBase: `${lessonId}|${sceneId}|visual-v2`, ...(concepts ? { concepts } : {}) };
}

const TITLE_WIPE_MS = 700;
const ease = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const lerpRect = (a: Rect, b: Rect, p: number): Rect => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });

const roughCache = new Map<string, StrokePath[]>();
function rough(paths: StrokePath[], seedBase: string, key: string): StrokePath[] {
  return paths.flatMap((path, i) => {
    const seed = Number.parseInt(canonicalHash(`${seedBase}|${key}|${i}`).slice(0, 8), 16) || 1;
    const cacheKey = `${seed}|${path.d}|${path.width ?? ''}|${path.color ?? ''}`;
    let hit = roughCache.get(cacheKey);
    if (!hit) { hit = roughenPath(path, seed); roughCache.set(cacheKey, hit); }
    return hit;
  });
}

interface Reveal { stroke: number; fill: number; text: number }
const FULL: Reveal = { stroke: 1, fill: 1, text: 1 };
/** Ink first, then colour, then words (V2 plan Phase 12 draw-on order). */
const revealAt = (p: number): Reveal => ({ stroke: Math.min(1, p / 0.55), fill: Math.max(0, Math.min(1, (p - 0.5) / 0.3)), text: Math.max(0, Math.min(1, (p - 0.75) / 0.25)) });

function drawVisual(visual: PrimitiveVisual, rect: Rect, reveal: Reveal, seedBase: string, key: string, opacity = 1, transform?: string): string {
  const parts: string[] = [];
  if (reveal.fill > 0) for (const f of visual.fills) parts.push(fillSvg(f, reveal.fill));
  parts.push(...sequentialStrokes(rough(visual.paths, seedBase, key), reveal.stroke));
  const textual = [...visual.texts.map(textSvg), ...(visual.embeds ?? []).map(embedSvg)].join('');
  parts.push(wipe(`w_${escapeXml(key)}`, rect.w, rect.h, reveal.text, textual).replace(/<clipPath id="([^"]+)"><rect x="-40" y="-60"/, (_m, id: string) => `<clipPath id="${id}"><rect x="${rect.x - 40}" y="${rect.y - 60}"`));
  const body = parts.join('');
  const faded = opacity < 1 ? `<g opacity="${+opacity.toFixed(3)}">${body}</g>` : body;
  return transform ? `<g transform="${transform}">${faded}</g>` : faded;
}

function titleSvg(title: string, tMs: number): string {
  const p = progress(tMs, 0, TITLE_WIPE_MS);
  if (p <= 0 || !title) return '';
  const width = STYLE.canvas.w - 2 * STYLE.canvas.safe;
  const natural = Math.max(1, measureTextWidth(title, STYLE.font.sceneTitle));
  const size = Math.min(STYLE.font.sceneTitle, (width / natural) * STYLE.font.sceneTitle);
  const text = textSvg({ x: STYLE.canvas.w / 2, y: 150, text: title.toUpperCase(), size, anchor: 'middle' });
  if (p >= 1) return text;
  const w = Math.min(width, measureTextWidth(title, size));
  return `<clipPath id="title_clip"><rect x="${STYLE.canvas.w / 2 - w / 2 - 20}" y="0" width="${(w + 40) * p}" height="190"/></clipPath><g clip-path="url(#title_clip)">${text}</g>`;
}

interface Override { rect?: Rect; opacity?: number; ring?: number; strike?: number; scale?: number; fade?: { from: BoardElement; to: BoardElement; p: number } }

const scaleRect = (r: Rect, k: number): Rect => (k === 1 ? r : { x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });
/** Uniform scale that fits `home` into `now`, so a drawing is never distorted when its container moves or resizes. */
const fitScale = (home: Rect, now: Rect): number => Math.min(now.w / Math.max(1, home.w), now.h / Math.max(1, home.h));
const centerOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function mapRect(r: Rect, home: Rect, now: Rect): Rect {
  const k = fitScale(home, now); const h = centerOf(home); const n = centerOf(now);
  return { x: n.x + (r.x - h.x) * k, y: n.y + (r.y - h.y) * k, w: r.w * k, h: r.h * k };
}
function mapTransform(home: Rect, now: Rect): string | undefined {
  const k = fitScale(home, now); const h = centerOf(home); const n = centerOf(now);
  const dx = n.x - k * h.x; const dy = n.y - k * h.y;
  return Math.abs(k - 1) < 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 ? undefined : `translate(${+dx.toFixed(3)} ${+dy.toFixed(3)}) scale(${+k.toFixed(5)})`;
}
const scaleOf = (el: BoardElement): number => { const k = Number(el.props.scale); return Number.isFinite(k) && k > 0 ? k : 1; };

/** Inner markup of the frame at `tMs` (scene-relative): the board after finished ops plus the ops in flight. A resolver draws approved pictures; without one every entity is a labelled box. */
export function renderSceneBody(scene: CompiledScene, tMs: number, resolver?: EntityResolver): string {
  const { timeline, geometry } = scene;
  const k = timeline.ops.filter((s) => s.t1 <= tMs).length;
  const base = timeline.states[k]!;
  const flight = timeline.ops.slice(k).filter((s) => s.t0 < tMs);
  const overrides = new Map<string, Override>();
  const extraAdds: Array<{ el: BoardElement; state: BoardState; p: number }> = [];
  const extraEdges: Array<{ edge: BoardEdge; state: BoardState; p: number }> = [];

  /**
   * Where an element is drawn now. Children of a kit follow the kit's current rectangle (it may be moving, resizing or scaled);
   * `settled` ignores in-flight overrides, giving the endpoints a move interpolates between.
   */
  const rectNow = (state: BoardState, el: BoardElement, settled = false): Rect | undefined => {
    const ov = settled ? undefined : overrides.get(el.id);
    let rect = ov?.rect ?? geometry.rectFor(state, el.id);
    if (!rect) return undefined;
    const containerId = el.placement.container;
    if (containerId && !ov?.rect) {
      const parent = state.elements[containerId];
      const home = geometry.kitRect(containerId);
      const now = parent && rectNow(state, parent, settled);
      if (now && home) rect = mapRect(rect, home, now);
    }
    return scaleRect(rect, ov?.scale ?? scaleOf(el));
  };
  const change = (id: string, patch: Override): void => { overrides.set(id, { ...overrides.get(id), ...patch }); };

  for (const s of flight) {
    const p = Math.min(1, (tMs - s.t0) / Math.max(1, s.t1 - s.t0));
    const after = timeline.states[s.index + 1]!;
    for (const effect of s.effects) {
      switch (effect.kind) {
        case 'add': { const el = after.elements[effect.targetId]; if (el) extraAdds.push({ el, state: after, p }); break; }
        case 'remove': change(effect.targetId, { opacity: 1 - ease(p) }); break;
        case 'move': {
          const was = base.elements[effect.targetId]; const will = after.elements[effect.targetId];
          const from = was && rectNow(base, was, true); const to = will && rectNow(after, will, true);
          if (from && to) change(effect.targetId, { rect: lerpRect(from, to, ease(p)) });
          break;
        }
        case 'emphasize': change(effect.targetId, effect.emphasis === 'struck' ? { strike: p } : effect.emphasis === 'highlight' ? { ring: p } : { opacity: lerp(1, 0.35, p) }); break;
        case 'valueChange': case 'equationStep': { const from = base.elements[effect.targetId]; const to = after.elements[effect.targetId]; if (from && to) change(effect.targetId, { fade: { from, to, p } }); break; }
        case 'transform': {
          const from = base.elements[effect.targetId]; const to = after.elements[effect.targetId];
          if (from && to) change(effect.targetId, { scale: lerp(scaleOf(from), scaleOf(to), ease(p)), ...(from.props.color !== to.props.color ? { fade: { from, to, p } } : {}) });
          break;
        }
        case 'connect': { const edge = after.edges[effect.targetId]; if (edge) extraEdges.push({ edge, state: after, p }); break; }
        default: break;
      }
    }
  }

  const out: string[] = [titleSvg(scene.title, tMs)];
  const live = (el: BoardElement) => el.lifecycle.removedAtBeat === undefined;
  const elements = Object.values(base.elements).filter(live).sort((a, b) => a.seq - b.seq);
  const drawElement = (el: BoardElement, state: BoardState, rect: Rect, reveal: Reveal, ov: Override | undefined): string => {
    const opacity = (ov?.opacity ?? (el.emphasis === 'dim' ? 0.35 : 1)) * (ov?.fade ? 1 - ease(ov.fade.p) : 1);
    // A kit's cached drawing sits in the rectangle it was laid out in; map it onto where the kit is now.
    const home = el.spec.type === 'kit' ? geometry.kitRect(el.id) : undefined;
    const place = (visual: PrimitiveVisual, key: string, vis: Reveal, alpha: number): string => home
      ? drawVisual(visual, home, vis, scene.seedBase, key, alpha, mapTransform(home, rect))
      : drawVisual(visual, rect, vis, scene.seedBase, key, alpha);
    let svg = place(elementVisual(el, rect, geometry, scene.concepts, resolver), el.id, reveal, opacity);
    if (ov?.fade) svg += place(elementVisual(ov.fade.to, rect, geometry, scene.concepts, resolver), `${el.id}.next`, FULL, ease(ov.fade.p));
    if (el.emphasis === 'highlight' || (ov?.ring ?? 0) > 0) svg += drawVisual(ringVisual(rect), rect, { stroke: ov?.ring !== undefined ? ease(ov.ring) : 1, fill: 1, text: 1 }, scene.seedBase, `${el.id}.ring`);
    if (el.emphasis === 'struck' || (ov?.strike ?? 0) > 0) svg += drawVisual(strikeVisual(rect), rect, { stroke: ov?.strike !== undefined ? ease(ov.strike) : 1, fill: 1, text: 1 }, scene.seedBase, `${el.id}.strike`);
    return svg;
  };
  const edgeRects = (state: BoardState, edge: BoardEdge): [Rect, Rect] | undefined => {
    const a = state.elements[edge.from]; const b = state.elements[edge.to];
    const ra = a && rectNow(state, a); const rb = b && rectNow(state, b);
    return ra && rb ? [ra, rb] : undefined;
  };
  // Kits sit behind everything they hold; links sit under the things they join.
  for (const el of elements.filter((e) => e.spec.type === 'kit')) { const rect = rectNow(base, el); if (rect) out.push(drawElement(el, base, rect, FULL, overrides.get(el.id))); }
  for (const edge of Object.values(base.edges).filter((e) => e.lifecycle.removedAtBeat === undefined)) {
    const ends = edgeRects(base, edge);
    if (ends) out.push(drawVisual(edgeVisual(edge, ends[0], ends[1], flight.length ? undefined : geometry.edgeRouteFor(base, edge.id)), ends[0], FULL, scene.seedBase, edge.id, edge.emphasis === 'dim' || edge.emphasis === 'struck' ? 0.4 : 1));
  }
  for (const { edge, state, p } of extraEdges) {
    const ends = edgeRects(state, edge);
    if (ends) out.push(drawVisual(edgeVisual(edge, ends[0], ends[1], geometry.edgeRouteFor(state, edge.id)), ends[0], { stroke: ease(p), fill: 1, text: p > 0.8 ? 1 : 0 }, scene.seedBase, edge.id));
  }
  for (const el of elements.filter((e) => e.spec.type !== 'kit')) { const rect = rectNow(base, el); if (rect) out.push(drawElement(el, base, rect, FULL, overrides.get(el.id))); }
  for (const { el, state, p } of extraAdds) {
    const rect = rectNow(state, el);
    if (rect) out.push(drawElement(el, state, rect, revealAt(ease(p)), undefined));
  }
  return out.join('');
}

/**
 * A stable key for a frame that cannot differ from the previous one (nothing is animating and the title has settled), so the
 * encoder can reuse the rasterized image instead of rendering an identical frame again (V2 plan Phase 12: holds render once).
 */
export function holdKey(scene: CompiledScene, tMs: number): string | undefined {
  if (tMs < TITLE_WIPE_MS) return undefined;
  const ops = scene.timeline.ops;
  const done = ops.filter((s) => s.t1 <= tMs).length;
  if (ops.slice(done).some((s) => s.t0 < tMs)) return undefined;
  return `${scene.sceneId}|${done}`;
}

export const renderSceneSvg = (scene: CompiledScene, tMs: number, resolver?: EntityResolver): string => svgDocument(renderSceneBody(scene, tMs, resolver));

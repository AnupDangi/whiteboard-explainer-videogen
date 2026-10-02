import type { EmbeddedSvg, FillShape, LaidOutElement, LaidOutScene, RevealPhases, RoutedEdge, StrokePath, TextRun, Timeline, TimelineEvent } from '../shared/types.js';
import { STYLE } from './style.js';
import { escapeXml, progress as sharedProgress, svgDocument } from '../shared/svg.js';
import { partGroupId } from './mathIds.js';
import { measureTextWidth } from '../layout/measure.js';
import { edgeLabelAnchor } from '../layout/edges.js';

const strokeAttrs = (width: number = STYLE.stroke.width, color: string = STYLE.stroke.color) =>
  `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="${STYLE.stroke.cap}" stroke-linejoin="${STYLE.stroke.join}"`;

const strokeSvg = (path: StrokePath, dashProgress: number): string => {
  const len = Math.max(1e-6, path.length);
  const width = path.width ?? STYLE.stroke.width;
  const tf = path.transform ? ` transform="${path.transform}"` : '';
  if (dashProgress >= 1) return `<path d="${path.d}" ${strokeAttrs(width, path.color)}${tf}/>`;
  return `<path d="${path.d}" ${strokeAttrs(width, path.color)}${tf} stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - dashProgress)}"/>`;
};

const fillSvg = (f: FillShape, opacity = 1): string =>
  `<path d="${f.d}" fill="${f.fill}"${f.fillRule ? ` fill-rule="${f.fillRule}"` : ''}${f.transform ? ` transform="${f.transform}"` : ''}${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`;

const textSvg = (t: TextRun): string =>
  `<text${t.preserveSpace ? ' xml:space="preserve"' : ''} x="${t.x}" y="${t.y}" text-anchor="${t.anchor}" font-family="${STYLE.font.family}" font-weight="${STYLE.font.weight}" font-size="${t.size}" fill="${STYLE.stroke.color}">${escapeXml(t.text)}</text>`;

const embedSvg = (e: EmbeddedSvg): string =>
  `<svg x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" viewBox="${e.viewBox}" overflow="visible">${e.body}</svg>`;

/**
 * Pen-order stroke reveal: paths are drawn ONE AFTER ANOTHER by cumulative
 * length (hypothesis/v1_claude/01 §7 "paths sequenced"), the way a hand
 * draws an icon — never every path growing at once.
 */
function sequentialStrokes(paths: StrokePath[], p: number): string[] {
  const px = (x: StrokePath) => x.length * (x.pxScale ?? 1);
  const total = paths.reduce((s, x) => s + px(x), 0);
  if (total <= 0) return p > 0 ? paths.map((x) => strokeSvg(x, 1)) : [];
  let drawn = total * Math.max(0, Math.min(1, p));
  const out: string[] = [];
  for (const path of paths) {
    if (drawn <= 0) break;
    const local = Math.min(1, drawn / Math.max(1e-6, px(path)));
    out.push(strokeSvg(path, local));
    drawn -= px(path);
  }
  return out;
}

/** Left-to-right handwriting wipe over `inner`, in the element's local frame. */
function wipe(clipId: string, w: number, h: number, p: number, inner: string): string {
  if (p <= 0 || !inner) return '';
  if (p >= 1) return inner;
  return `<clipPath id="${clipId}"><rect x="-40" y="-60" width="${(w + 80) * p}" height="${h + 140}"/></clipPath><g clip-path="url(#${clipId})">${inner}</g>`;
}

const phaseProgress = (timeMs: number, t0: number, phases: RevealPhases) => {
  const s0 = t0;
  const f0 = s0 + phases.strokeMs;
  const x0 = f0 + phases.fillMs;
  return {
    stroke: phases.strokeMs > 0 ? sharedProgress(timeMs, s0, f0) : timeMs >= s0 ? 1 : 0,
    fill: phases.fillMs > 0 ? sharedProgress(timeMs, f0, x0) : timeMs >= f0 ? 1 : 0,
    text: phases.textMs > 0 ? sharedProgress(timeMs, x0, x0 + phases.textMs) : timeMs >= x0 ? 1 : 0,
  };
};

function renderElement(el: LaidOutElement, primary: TimelineEvent, events: TimelineEvent[], timeMs: number): string {
  const { w, h } = el.intrinsicSize;
  const hold = primary.track === 'hold';
  const phases = primary.phases ?? { strokeMs: primary.t1 - primary.t0, fillMs: 0, textMs: 0 };
  const pp = hold ? { stroke: 1, fill: 1, text: 1 } : phaseProgress(timeMs, primary.t0, phases);
  const inner: string[] = [];
  // Anchored sub-reveals (formula terms, plot tangent/steps/rise-run) stay hidden until their own `term` event.
  const termEvent = (group: string) => events.find((e) => e.track === 'term' && e.group === group);
  const termP = (group: string): number | undefined => {
    const ev = termEvent(group);
    return hold ? (ev ? 1 : undefined) : ev ? sharedProgress(timeMs, ev.t0, ev.t1) : undefined;
  };
  const embeds = (el.visual.embeds ?? []).map((e) => {
    if (el.element.prim !== 'formula' || !el.element.parts) return embedSvg(e);
    let body = e.body;
    el.element.parts.forEach((_, i) => {
      const o = termP(`p${i}`);
      if (o !== undefined && o < 1) body = body.replace(`id="${partGroupId(el.id, i)}"`, `id="${partGroupId(el.id, i)}" opacity="${+o.toFixed(3)}"`);
    });
    return embedSvg({ ...e, body });
  });
  // Paths/fills/texts in a scheduled group are drawn by that group's event, not by the element's own phases.
  const own = <T extends { group?: string }>(x: T) => !x.group || !termEvent(x.group);
  const visual = { paths: el.visual.paths.filter(own), fills: el.visual.fills.filter(own), texts: el.visual.texts.filter(own) };
  const textAndEmbeds = [...visual.texts.map(textSvg), ...embeds].join('');

  if (primary.track === 'grow') {
    const clipH = h * pp.fill;
    const full = [...visual.fills.map((f) => fillSvg(f)), ...visual.paths.map((p) => strokeSvg(p, 1)), textAndEmbeds].join('');
    inner.push(`<clipPath id="clip_${el.id}"><rect x="-20" y="${h - clipH}" width="${w + 40}" height="${clipH + 20}"/></clipPath><g clip-path="url(#clip_${el.id})">${full}</g>`);
  } else {
    // Fills sit under the ink; they fade in only after the outline is complete.
    if (pp.fill > 0) for (const f of visual.fills) inner.push(fillSvg(f, pp.fill));
    inner.push(...sequentialStrokes(visual.paths, pp.stroke));
    inner.push(wipe(`wipe_${el.id}`, w, h, pp.text, textAndEmbeds));
    // Scheduled groups: strokes drawn in pen order over the first 75% of the group event, then fills and labels.
    for (const ev of events) {
      if (ev.track !== 'term' || !ev.group || el.element.prim === 'formula') continue;
      const gp = hold ? 1 : sharedProgress(timeMs, ev.t0, ev.t1);
      if (gp <= 0) continue;
      const g = ev.group;
      inner.push(...sequentialStrokes(el.visual.paths.filter((p) => p.group === g), Math.min(1, gp / 0.75)));
      const tail = gp <= 0.75 ? 0 : (gp - 0.75) / 0.25;
      if (tail > 0) {
        for (const f of el.visual.fills.filter((x) => x.group === g)) inner.push(fillSvg(f, tail));
        for (const t of el.visual.texts.filter((x) => x.group === g)) inner.push(`<g opacity="${+tail.toFixed(3)}">${textSvg(t)}</g>`);
      }
    }
  }

  const emphasis = events.find((e) => e.track === 'emphasis');
  if (emphasis) {
    const ep = sharedProgress(timeMs, emphasis.t0, emphasis.t1);
    if (ep > 0 && ep < 1) {
      // Marker ring drawn on around the element, then fading (never a static box).
      const rx = w / 2 + 22;
      const ry = h / 2 + 22;
      const len = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
      const drawP = Math.min(1, ep / 0.6);
      const opacity = ep <= 0.6 ? 1 : 1 - (ep - 0.6) / 0.4;
      inner.push(
        `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${rx}" ry="${ry}" fill="none" stroke="${STYLE.palette.orange}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - drawP)}" opacity="${opacity}"/>`,
      );
    }
  }

  const sx = el.bbox.w / Math.max(1e-6, w);
  const sy = el.bbox.h / Math.max(1e-6, h);
  return `<g id="${escapeXml(el.id)}" transform="translate(${el.bbox.x},${el.bbox.y}) scale(${sx},${sy})">${inner.join('')}</g>`;
}

const ARROW_HEAD = 24;

/** Arrow draw-on: shaft over the first 80% of the edge event, arrowhead strokes over the last 20%. */
function renderEdge(edge: RoutedEdge, ev: TimelineEvent, timeMs: number, index: number): string {
  const p = sharedProgress(timeMs, ev.t0, ev.t1);
  if (p <= 0 || edge.points.length < 2) return '';
  const d = edge.roughPath?.d ?? edge.points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
  let length = edge.roughPath?.length ?? 0;
  if (!edge.roughPath) for (let i = 1; i < edge.points.length; i++) length += Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].y - edge.points[i - 1].y);
  const shaftP = Math.min(1, p / 0.8);
  const dash = edge.style === 'dashed' ? ' stroke-dasharray="12 10"' : '';
  const parts: string[] = [];
  if (edge.style === 'dashed') {
    // Dashed edges cannot also use dasharray for draw-on; reveal them with a growing clip instead.
    const xs = edge.points.map((q) => q.x), ys = edge.points.map((q) => q.y);
    const minX = Math.min(...xs) - 20, minY = Math.min(...ys) - 20, maxX = Math.max(...xs) + 20, maxY = Math.max(...ys) + 20;
    const start = edge.points[0], end = edge.points[edge.points.length - 1];
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const rect = horizontal
      ? end.x >= start.x ? { x: minX, y: minY, w: (maxX - minX) * shaftP, h: maxY - minY } : { x: maxX - (maxX - minX) * shaftP, y: minY, w: (maxX - minX) * shaftP, h: maxY - minY }
      : end.y >= start.y ? { x: minX, y: minY, w: maxX - minX, h: (maxY - minY) * shaftP } : { x: minX, y: maxY - (maxY - minY) * shaftP, w: maxX - minX, h: (maxY - minY) * shaftP };
    parts.push(`<clipPath id="edgeclip_${index}"><rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"/></clipPath><path d="${d}" ${strokeAttrs()}${dash} clip-path="url(#edgeclip_${index})"/>`);
  } else {
    parts.push(strokeSvg({ d, length }, shaftP));
  }
  const headP = p <= 0.8 ? 0 : (p - 0.8) / 0.2;
  // Symmetric relations (compares/opposes) carry head: 'none': the shaft
  // reads as a comparison, never a one-way arrow. The label still draws.
  if (headP > 0) {
    if (edge.head !== 'none') {
      const a = edge.points[edge.points.length - 2];
      const b = edge.points[edge.points.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      for (const side of [-1, 1]) {
        const hx = b.x - ARROW_HEAD * Math.cos(ang + side * 0.5);
        const hy = b.y - ARROW_HEAD * Math.sin(ang + side * 0.5);
        parts.push(strokeSvg({ d: `M ${b.x} ${b.y} L ${hx} ${hy}`, length: ARROW_HEAD }, headP));
      }
    }
    if (edge.label) {
      // Layout fits the anchor inside the safe area (labelBox); fall back to
      // the default anchor only for edges routed outside layout (defensive).
      const anchor = edge.labelBox
        ? { x: edge.labelBox.x + edge.labelBox.w / 2, y: edge.labelBox.y + edge.labelBox.h / 2 }
        : edgeLabelAnchor(edge.points);
      const lx = anchor.x;
      const ly = anchor.y;
      parts.push(`<g opacity="${headP}">${textSvg({ x: lx, y: ly, text: edge.label.toUpperCase(), size: STYLE.font.sizes.note, anchor: 'middle' })}</g>`);
    }
  }
  return parts.join('');
}

/** Hand-lettered scene title, wiped in over the first `TITLE_WIPE_MS` of the scene. */
export const TITLE_WIPE_MS = 700;
export const TITLE_Y = 150;

function renderTitle(scene: LaidOutScene, timeline: Timeline, timeMs: number): string {
  if (scene.template === 'title_card') return '';
  const p = sharedProgress(timeMs, timeline.sceneStartMs, timeline.sceneStartMs + TITLE_WIPE_MS);
  if (p <= 0) return '';
  // Fit to the actual renderer's measured title ink, not a constant width per
  // character. The same fit is used for the reveal clip so it ends at the text.
  const titleWidth = STYLE.canvas.w - 2 * STYLE.canvas.safe;
  const naturalWidth = Math.max(1, measureTextWidth(scene.title, STYLE.font.sceneTitle));
  const size = Math.min(STYLE.font.sceneTitle, (titleWidth / naturalWidth) * STYLE.font.sceneTitle);
  const text = textSvg({ x: STYLE.canvas.w / 2, y: TITLE_Y, text: scene.title.toUpperCase(), size, anchor: 'middle' });
  const estW = Math.min(titleWidth, measureTextWidth(scene.title, size));
  const x0 = STYLE.canvas.w / 2 - estW / 2 - 20;
  if (p >= 1) return text;
  return `<clipPath id="title_clip"><rect x="${x0}" y="0" width="${(estW + 40) * p}" height="${TITLE_Y + 40}"/></clipPath><g clip-path="url(#title_clip)">${text}</g>`;
}

/** Inner markup of one frame (no <svg> wrapper), so the encoder can composite transitions. */
export function renderSceneBody(scene: LaidOutScene, timeline: Timeline, timeMs: number): string {
  const body: string[] = [renderTitle(scene, timeline, timeMs)];

  // Containers render behind their children (z-order), independent of SceneSpec element order.
  const ordered = [...scene.elements].sort((a, b) => Number(b.element.prim === 'container') - Number(a.element.prim === 'container'));
  const byElement = new Map<string, TimelineEvent[]>();
  for (const ev of timeline.events) {
    if (ev.track === 'edge') continue;
    byElement.set(ev.elementId, [...(byElement.get(ev.elementId) ?? []), ev]);
  }

  // Edges sit under elements so arrowheads never cover a node's outline.
  for (const ev of timeline.events) {
    if (ev.track !== 'edge' || ev.edgeIndex === undefined) continue;
    const edge = scene.edges[ev.edgeIndex];
    if (edge) body.push(renderEdge(edge, ev, timeMs, ev.edgeIndex));
  }

  for (const el of ordered) {
    const evs = byElement.get(el.id) ?? [];
    const primary = evs.find((e) => e.track !== 'fill' && e.track !== 'emphasis' && e.track !== 'term');
    if (!primary) continue; // every element is guaranteed one primary event by the timeline compiler; defensive only.
    if (primary.track !== 'hold' && timeMs < primary.t0) continue;
    if (primary.track !== 'hold' && primary.t1 > primary.t0 && sharedProgress(timeMs, primary.t0, primary.t1) <= 0) continue;
    body.push(renderElement(el, primary, evs, timeMs));
  }

  return body.join('');
}

/**
 * S10 — the renderer (claude_pipeline.md §16). `renderSVG` is a PURE
 * function of `(scene, timeline, timeMs)`: no wall-clock, no randomness, no
 * mutable module state, so the export pipeline and the live browser player
 * produce byte-identical frames for the same timestamp (AGENTS.md #4).
 */
export function renderSVG(scene: LaidOutScene, timeline: Timeline, timeMs: number): string {
  return svgDocument(renderSceneBody(scene, timeline, timeMs));
}

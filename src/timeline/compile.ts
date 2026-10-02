import type { LaidOutScene, ResolvedMention, RevealPhases, Timeline, TimelineEvent } from '../shared/types.js';
import { STYLE } from '../render/style.js';
import { formulaSource } from '../render/math.js';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type LaidOutElement = LaidOutScene['elements'][number];

const textWipeMs = (chars: number, cap: number) => clamp(chars * STYLE.motion.textWipeCharMs, 200, cap);

/**
 * Primary reveal for one element, as sub-phases in draw order (hypothesis/v1_claude/01 §7):
 *  - stroke: outline paths drawn one after another (length / strokeSpeed, 300-1500 ms)
 *  - fill:   flat fill fades in after its outline completes (250 ms)
 *  - text:   label/text wipes left to right after the shape exists (35 ms/char, <= 900 ms)
 * Meters grow; pure text/formula elements wipe.
 */
export function revealPhases(el: LaidOutElement): { track: TimelineEvent['track']; phases: RevealPhases } {
  if (el.element.prim === 'meter') return { track: 'grow', phases: { strokeMs: 0, fillMs: STYLE.motion.fillFadeMs * 2, textMs: 0 } };
  const chars = el.element.prim === 'formula' ? formulaSource(el.element).length : Math.max(0, ...el.visual.texts.map((t) => t.text.length));
  if (el.visual.paths.length > 0) {
    // Plots and number lines are drawn at teaching pace (curve, tangent, steps), so they get a longer cap.
    const cap = el.element.prim === 'plot' || el.element.prim === 'numberLine' ? 4000 : 1500;
    const strokeMs = clamp((el.strokeLength / STYLE.motion.strokeSpeedPxPerSec) * 1000, 300, cap);
    const fillMs = el.visual.fills.length > 0 ? STYLE.motion.fillFadeMs : 0;
    const textMs = el.visual.texts.length > 0 ? textWipeMs(chars, 900) : 0;
    return { track: 'stroke', phases: { strokeMs, fillMs, textMs } };
  }
  const cap = el.element.prim === 'formula' ? 1500 : 900;
  return { track: 'wipe', phases: { strokeMs: 0, fillMs: 0, textMs: textWipeMs(chars, cap) } };
}

const phaseTotal = (p: RevealPhases) => p.strokeMs + p.fillMs + p.textMs;

/** An element's reveal time at nominal drawing speed, before any fit to the scene audio. */
export const nominalRevealMs = (el: LaidOutElement): number => phaseTotal(revealPhases(el).phases);

/**
 * S9 — mention-anchored timeline compiler (claude_pipeline.md §15).
 *
 *  - `revealStart = anchorTime - lead`, anchors are `sceneStart`,
 *    `mention:<id>` (resolved word timestamp), or `after:<id>` (the
 *    referenced element's own actual — post-scheduling — end time; the
 *    after-graph is guaranteed acyclic by schema.ts's structural validator).
 *  - At most `MAX_CONCURRENT_REVEALS` elements reveal at once: a 2-server
 *    greedy scheduler delays an element's actual start past its desired
 *    anchor time only when both servers are busy. An element holds its
 *    server for its WHOLE reveal (stroke + fill + text), so a fill tail can
 *    never become an uncounted third concurrent reveal.
 *  - Carry-over elements never re-reveal (`hold` track spans the full
 *    scene) and never occupy a concurrency server.
 *  - Edges get their own `edge` events (see `scheduleEdges`).
 *  - Nothing is scheduled past `sceneEndMs`: a reveal that would overrun is
 *    compressed to fit (the audio clock wins over nominal draw speed).
 */
/** Latest allowed end per element id and per `from->to` edge key (claim windows from S4/S5). */
export interface TimelineDeadlines {
  elementEndBy?: ReadonlyMap<string, number>;
  edgeEndBy?: ReadonlyMap<string, number>;
}

/** A reveal may be sped up to meet a deadline, but never below this share of its nominal drawing time. */
export const MIN_DEADLINE_SPEEDUP = 0.4;

export function compileTimeline(scene: LaidOutScene, mentions: ResolvedMention[], sceneStartMs: number, sceneEndMs: number, deadlines: TimelineDeadlines = {}): Timeline {
  const mentionById = new Map(mentions.map((m) => [m.mentionId, m]));
  const carried = new Set(scene.carryOver);
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const lead = STYLE.motion.leadMs;

  const events: TimelineEvent[] = [];
  const scheduled = new Map<string, { t0: number; t1: number }>();
  const remaining = new Set<string>();

  for (const el of scene.elements) {
    if (carried.has(el.id)) {
      events.push({ elementId: el.id, track: 'hold', t0: sceneStartMs, t1: sceneEndMs });
      scheduled.set(el.id, { t0: sceneStartMs, t1: sceneStartMs });
      continue;
    }
    remaining.add(el.id);
  }

  const anchorTime = (anchor: string): number | null => {
    if (anchor === 'sceneStart') return sceneStartMs;
    if (anchor.startsWith('mention:')) {
      const mention = mentionById.get(anchor.slice('mention:'.length));
      if (!mention) return null;
      return clamp(mention.startMs - lead, sceneStartMs, sceneEndMs);
    }
    const refState = scheduled.get(anchor.slice('after:'.length));
    return refState ? refState.t1 : null; // null = dependency not yet scheduled
  };

  // Missing semantic anchors must fail at S9. Treating them as sceneStart
  // silently front-loads a visual whose spoken referent was never resolved.
  const anchorOwners = [
    ...scene.elements.filter((el) => !carried.has(el.id)).map((el) => [`element ${el.id}`, el.element.anchor] as const),
    ...scene.edges.flatMap((edge, index) => edge.anchor ? [[`edge ${index}`, edge.anchor] as const] : []),
    ...scene.elements.filter((el) => !carried.has(el.id)).flatMap((el) => subRevealAnchors(el).map(({ group, anchor }) => [`${el.id}/${group}`, anchor] as const)),
  ];
  for (const [owner, anchor] of anchorOwners) {
    if (anchor.startsWith('mention:') && !mentionById.has(anchor.slice('mention:'.length))) {
      throw new Error(`timeline anchor unresolved for ${owner}: ${anchor}`);
    }
  }

  // A dense board in a short scene draws faster per element (never below 45% of nominal stroke time), so the
  // two reveal lanes can keep up with narration instead of falling behind the spoken claims.
  const revealCount = scene.elements.filter((el) => !carried.has(el.id)).length;
  const roomRatio = revealCount > 0 ? (sceneEndMs - sceneStartMs) / (revealCount * 1900) : 1;
  const densityScale = roomRatio < 0.85 ? clamp(roomRatio, 0.45, 1) : 1;
  const serverFree = [sceneStartMs, sceneStartMs];
  const serverLast: Array<TimelineEvent | undefined> = [undefined, undefined];
  const nominal = new Map<string, number>();

  while (remaining.size > 0) {
    let bestId: string | null = null;
    let bestT0 = Infinity;
    for (const id of remaining) {
      const t0 = anchorTime(byId.get(id)!.element.anchor);
      if (t0 === null) continue;
      if (t0 < bestT0 || (t0 === bestT0 && (bestId === null || id < bestId))) {
        bestT0 = t0;
        bestId = id;
      }
    }
    if (bestId === null) throw new Error(`timeline contains unresolved after-dependency anchors: ${[...remaining].sort().join(', ')}`);
    const el = byId.get(bestId)!;
    const { track, phases: nominalPhases } = revealPhases(el);
    const phases = densityScale < 1 ? { ...nominalPhases, strokeMs: nominalPhases.strokeMs * densityScale } : nominalPhases;
    const serverIdx = serverFree[0] <= serverFree[1] ? 0 : 1;
    const endBy = deadlines.elementEndBy?.get(bestId);
    // The latest start that can still finish by the deadline when the reveal is drawn at its fastest allowed speed.
    const startBy = endBy === undefined ? undefined : endBy - phaseTotal(phases) * MIN_DEADLINE_SPEEDUP;
    // Deadline pressure: if the freest server would start this element after its claim window, speed up the
    // reveal that still occupies it (never below MIN_DEADLINE_SPEEDUP of its nominal time) so this one can start in time.
    if (startBy !== undefined && Math.max(bestT0, serverFree[serverIdx]) > startBy) {
      const blocker = serverLast[serverIdx];
      if (blocker && blocker.phases) {
        const wanted = Math.max(blocker.t0 + 1, Math.max(bestT0, startBy));
        const floor = blocker.t0 + (nominal.get(blocker.elementId) ?? 0) * MIN_DEADLINE_SPEEDUP;
        const newEnd = Math.min(blocker.t1, Math.max(wanted, floor));
        const scale = (newEnd - blocker.t0) / Math.max(1e-6, blocker.t1 - blocker.t0);
        if (newEnd < blocker.t1) {
          blocker.phases = { strokeMs: blocker.phases.strokeMs * scale, fillMs: blocker.phases.fillMs * scale, textMs: blocker.phases.textMs * scale };
          blocker.t1 = newEnd;
          scheduled.set(blocker.elementId, { t0: blocker.t0, t1: newEnd });
          serverFree[serverIdx] = newEnd;
        }
      }
    }
    // Clamp to sceneEndMs - 1 (not sceneEndMs): frame export renders at
    // most at endMs - 1, so a reveal starting exactly at sceneEndMs would
    // have zero duration and never appear in any exported frame.
    const actualT0 = Math.min(Math.max(bestT0, serverFree[serverIdx]), Math.max(sceneStartMs, sceneEndMs - 1));
    const total = phaseTotal(phases);
    const room = sceneEndMs - actualT0;
    // Draw faster (never below MIN_DEADLINE_SPEEDUP of nominal) when the reveal would otherwise end after its claim window.
    const toDeadline = endBy !== undefined && actualT0 + total > endBy ? Math.max(MIN_DEADLINE_SPEEDUP, (endBy - actualT0) / Math.max(1e-6, total)) : 1;
    const k = Math.min(total > room ? room / Math.max(1e-6, total) : 1, toDeadline);
    const fitted: RevealPhases = { strokeMs: phases.strokeMs * k, fillMs: phases.fillMs * k, textMs: phases.textMs * k };
    const actualT1 = Math.max(actualT0 + 1, actualT0 + phaseTotal(fitted));
    serverFree[serverIdx] = actualT1;
    scheduled.set(bestId, { t0: actualT0, t1: actualT1 });
    const event: TimelineEvent = { elementId: bestId, track, t0: actualT0, t1: actualT1, phases: fitted };
    events.push(event);
    serverLast[serverIdx] = event;
    nominal.set(bestId, total);
    remaining.delete(bestId);
  }

  events.push(...scheduleEdges(scene, scheduled, anchorTime, sceneEndMs, deadlines.edgeEndBy));
  events.push(...scheduleTerms(scene, scheduled, anchorTime, sceneEndMs));
  return { sceneId: scene.sceneId, events, sceneStartMs, sceneEndMs };
}

/**
 * Edge (arrow) reveals. Lamina reference frames show an arrow drawn from its
 * source toward where the target is about to appear, finishing as the target
 * starts drawing (harness/reference/lamina/OBSERVATIONS.md). So an edge starts
 * at the latest of: its source's reveal end, its own explicit `anchor` (if
 * any), and `arrowMs` before its target starts. Arrows are short (arrowMs) and
 * are not counted against the element concurrency servers — an arrow leading
 * into a node is part of that node's arrival, not a competing reveal.
 */
function scheduleEdges(
  scene: LaidOutScene,
  scheduled: Map<string, { t0: number; t1: number }>,
  anchorTime: (anchor: string) => number | null,
  sceneEndMs: number,
  edgeEndBy?: ReadonlyMap<string, number>,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  scene.edges.forEach((edge, edgeIndex) => {
    const src = scheduled.get(edge.from);
    const dst = scheduled.get(edge.to);
    if (!src || !dst || edge.points.length < 2) return;
    const explicit = edge.anchor ? anchorTime(edge.anchor) : null;
    if (edge.anchor && explicit === null) throw new Error(`timeline edge anchor unresolved for ${edge.from}->${edge.to}: ${edge.anchor}`);
    const desired = Math.max(src.t1, dst.t0 - STYLE.motion.arrowMs, explicit ?? -Infinity);
    // Preserve causal order when the requested lead window is compressed. An
    // edge may shorten, but it cannot begin before its source has appeared.
    const latestStart = sceneEndMs - 1;
    const t0 = Math.max(src.t1, Math.min(desired, latestStart));
    if (t0 >= sceneEndMs) throw new Error(`timeline edge ${edge.from}->${edge.to} cannot fit after its source reveal`);
    const dueBy = edgeEndBy?.get(`${edge.from}->${edge.to}`);
    // An arrow may be drawn faster (>=150 ms) so the relation completes inside its claim window.
    const arrowMs = dueBy !== undefined && t0 + STYLE.motion.arrowMs > dueBy ? Math.max(150, dueBy - t0) : STYLE.motion.arrowMs;
    const t1 = Math.min(t0 + arrowMs, sceneEndMs);
    out.push({ elementId: `${edge.from}->${edge.to}`, track: 'edge', t0, t1, edgeIndex });
  });
  // Several arrows into (or out of) one node must not fire together: a fan-in of simultaneous lines reads as
  // noise, while staggered arrows let the learner follow each relation (Simi: the arrow leads the eye).
  for (const key of ['to', 'from'] as const) {
    const groups = new Map<string, TimelineEvent[]>();
    for (const event of out) {
      const edge = scene.edges[event.edgeIndex!]!;
      groups.set(edge[key], [...(groups.get(edge[key]) ?? []), event]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.t0 - b.t0 || a.edgeIndex! - b.edgeIndex!);
      for (let i = 1; i < group.length; i++) {
        const earliest = group[i - 1]!.t0 + EDGE_STAGGER_MS;
        if (group[i]!.t0 >= earliest) continue;
        const duration = group[i]!.t1 - group[i]!.t0;
        const t0 = Math.min(earliest, sceneEndMs - 1);
        group[i]!.t0 = t0;
        group[i]!.t1 = Math.min(t0 + duration, sceneEndMs);
      }
    }
  }
  return out;
}

/** Minimum gap between arrows that share an endpoint. */
export const EDGE_STAGGER_MS = 250;

/** A formula term fades in over this long once its anchor fires. */
export const TERM_REVEAL_MS = 450;

/** Anchored sub-reveals of an element: formula parts (`p<i>`) and plot groups (`tangent`, `steps`, `riseRun`). */
export function subRevealAnchors(el: LaidOutElement): Array<{ group: string; anchor: string }> {
  const e = el.element;
  if (e.prim === 'formula') return (e.parts ?? []).flatMap((p, i) => (p.anchor ? [{ group: `p${i}`, anchor: p.anchor }] : []));
  if (e.prim === 'plot') {
    const out: Array<{ group: string; anchor: string }> = [];
    if (e.riseRunAnchor && e.riseRun) out.push({ group: 'riseRun', anchor: e.riseRunAnchor });
    if (e.tangentAnchor && e.tangentAt !== undefined) out.push({ group: 'tangent', anchor: e.tangentAnchor });
    if (e.stepsAnchor && e.trajectory) out.push({ group: 'steps', anchor: e.stepsAnchor });
    return out;
  }
  return [];
}

/**
 * Sub-reveals (reveal-by-meaning): each anchored group appears when its
 * phrase is spoken, never before its element has started drawing. A formula
 * term fades in; a plot group (tangent line, descent steps, rise/run legs)
 * is drawn on at stroke speed. Groups without an anchor draw with the element.
 */
function scheduleTerms(
  scene: LaidOutScene,
  scheduled: Map<string, { t0: number; t1: number }>,
  anchorTime: (anchor: string) => number | null,
  sceneEndMs: number,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const el of scene.elements) {
    const own = scheduled.get(el.id);
    if (!own) continue;
    for (const { group, anchor } of subRevealAnchors(el)) {
      const t0 = Math.min(Math.max(anchorTime(anchor) ?? own.t0, own.t0), sceneEndMs);
      let ms = TERM_REVEAL_MS;
      if (el.element.prim === 'plot') {
        const px = el.visual.paths.filter((p) => p.group === group).reduce((s, p) => s + p.length * (p.pxScale ?? 1), 0);
        ms = clamp((px / STYLE.motion.strokeSpeedPxPerSec) * 1000, 400, 3000) + STYLE.motion.fillFadeMs;
      }
      out.push({ elementId: el.id, track: 'term', t0, t1: Math.min(t0 + ms, sceneEndMs), group });
    }
  }
  return out;
}

/** Largest element (px, either side) that gets an idle-emphasis ring. */
export const EMPHASIS_MAX_PX = 480;

/** Wraps `compileTimeline` to also add closing emphasis on `focus` elements and on idle gaps. */
export function compileTimelineFull(scene: LaidOutScene, mentions: ResolvedMention[], sceneStartMs: number, sceneEndMs: number, deadlines: TimelineDeadlines = {}): Timeline {
  const base = compileTimeline(scene, mentions, sceneStartMs, sceneEndMs, deadlines);
  const events = [...base.events];

  for (const id of new Set(scene.focus ?? [])) {
    if (!scene.elements.some((e) => e.id === id)) continue;
    events.push({ elementId: id, track: 'emphasis', t0: Math.max(sceneStartMs, sceneEndMs - 400), t1: sceneEndMs });
  }

  const reveals = events.filter((e) => e.track !== 'hold' && e.track !== 'emphasis' && e.track !== 'edge' && e.track !== 'term').sort((a, b) => a.t0 - b.t0);
  let cursor = sceneStartMs;
  let lastElement: string | null = null;
  for (const ev of reveals) {
    // Idle emphasis rings only suit node-sized elements; a ring around a whole plot or derivation reads as noise.
    const last = lastElement ? scene.elements.find((e) => e.id === lastElement) : undefined;
    const ringable = last && last.bbox.w <= EMPHASIS_MAX_PX && last.bbox.h <= EMPHASIS_MAX_PX;
    if (ev.t0 - cursor > STYLE.motion.maxIdleMs && lastElement && ringable) {
      const t0 = cursor + STYLE.motion.maxIdleMs / 2;
      events.push({ elementId: lastElement, track: 'emphasis', t0, t1: Math.min(t0 + 400, sceneEndMs) });
    }
    cursor = Math.max(cursor, ev.t1);
    lastElement = ev.elementId;
  }

  // Fill long gaps before already-scheduled activity (especially the closing
  // focus emphasis) and after the final reveal. The reveal-only pass above
  // cannot see those trailing intervals because there is no later reveal.
  const isPrimaryReveal = (ev: TimelineEvent) => ev.track !== 'hold' && ev.track !== 'emphasis' && ev.track !== 'edge' && ev.track !== 'term';
  const activity = events.filter((e) => e.track !== 'hold').sort((a, b) => a.t0 - b.t0);
  let activityCursor = sceneStartMs;
  let recentNode: string | null = null;
  const addIdleEmphasisUntil = (nextMs: number): void => {
    while (nextMs - activityCursor > STYLE.motion.maxIdleMs && recentNode) {
      const element = scene.elements.find((e) => e.id === recentNode);
      if (!element || element.bbox.w > EMPHASIS_MAX_PX || element.bbox.h > EMPHASIS_MAX_PX) break;
      const t0 = activityCursor + STYLE.motion.maxIdleMs;
      const t1 = Math.min(t0 + 400, nextMs);
      if (t1 <= t0) break;
      events.push({ elementId: recentNode, track: 'emphasis', t0, t1 });
      activityCursor = t1;
    }
  };
  for (const ev of activity) {
    addIdleEmphasisUntil(ev.t0);
    activityCursor = Math.max(activityCursor, ev.t1);
    if (isPrimaryReveal(ev)) recentNode = ev.elementId;
  }
  addIdleEmphasisUntil(sceneEndMs);

  return { sceneId: base.sceneId, events, sceneStartMs, sceneEndMs };
}

/**
 * Longest window inside the scene, including the stretch after the last
 * event, in which nothing new is drawn (gate G9). Emphasis rings count only
 * when `countEmphasis` is set: they are filler, not new content.
 */
export function maxIdleWindowMs(timeline: Timeline, options: { countEmphasis?: boolean } = {}): number {
  const active = timeline.events.filter((e) => e.track !== 'hold' && (options.countEmphasis || e.track !== 'emphasis')).sort((a, b) => a.t0 - b.t0);
  let cursor = timeline.sceneStartMs;
  let worst = 0;
  for (const ev of active) {
    worst = Math.max(worst, ev.t0 - cursor);
    cursor = Math.max(cursor, ev.t1);
  }
  return Math.max(worst, timeline.sceneEndMs - cursor);
}

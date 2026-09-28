import type { LaidOutScene, Timeline } from '../types.js';
import { MIN_READABLE_FONT_PX, STYLE } from '../style.js';

/**
 * Numeric board metrics (Task 11, structural only).
 *
 * Deterministic collector over laid-out scenes + timelines. It reports node
 * counts, reveal counts, occupancy, rendered text sizes, edge counts, and
 * fallback/dedup/floor signals. It never branches on lesson wording and never
 * claims how reference videos were built; the frozen reference band lives in
 * `harness/reference/lamina/metrics.v1.json` and only carries observed
 * timing/coverage values from `index.json` + `OBSERVATIONS.md`.
 */

export interface BoardSceneMetrics {
  sceneId: string;
  elementCount: number;
  objectCount: number;
  edgeCount: number;
  factualEdgeCount: number;
  revealCount: number;
  edgeRevealCount: number;
  durationSec: number;
  occupancy: number;
  minRenderedTextPx: number | null;
  meanRenderedTextPx: number | null;
  textFallbackCount: number;
  textFallbackShare: number;
  unresolvedObjectCount: number;
  carryOverCount: number;
  repeatedAssetCount: number;
  belowOccupancyMin: boolean;
  belowSparse: boolean;
  boardTooSparse: boolean;
  minReadableTextViolation: boolean;
  tinyElementCount: number;
  outlineThenFill: boolean;
}

const isPrimaryReveal = (track: string): boolean =>
  track !== 'hold' && track !== 'emphasis' && track !== 'edge' && track !== 'term';


export function measureBoardScene(scene: LaidOutScene, timeline: Timeline): BoardSceneMetrics {
  const elementCount = scene.elements.length;
  const objectCount = scene.elements.filter((e) => e.element.prim === 'object').length;
  const edgeCount = scene.edges.length;
  const factualEdgeCount = scene.edges.filter((e) => Boolean(e.factualRelation)).length;
  const events = timeline.events ?? [];
  const revealCount = events.filter((e) => isPrimaryReveal(e.track)).length;
  const edgeRevealCount = events.filter((e) => e.track === 'edge').length;
  const durationSec = Math.max(0, (timeline.sceneEndMs - timeline.sceneStartMs) / 1000);

  const renderedSizes: number[] = [];
  for (const e of scene.elements) {
    const sy = e.bbox.h / Math.max(1e-6, e.intrinsicSize.h);
    for (const t of e.visual.texts) renderedSizes.push(t.size * sy);
  }
  const minRenderedTextPx = renderedSizes.length ? Math.min(...renderedSizes) : null;
  const meanRenderedTextPx = renderedSizes.length
    ? renderedSizes.reduce((s, v) => s + v, 0) / renderedSizes.length
    : null;

  const objectEls = scene.elements.filter((e) => e.element.prim === 'object');
  const textFallbackCount = objectEls.filter((e) => e.resolution?.rung === 4).length;
  const textFallbackShare = objectEls.length ? textFallbackCount / objectEls.length : 0;
  const unresolvedObjectCount = objectEls.filter((e) => !e.resolution).length;

  const seen = new Map<string, number>();
  let repeatedAssetCount = 0;
  for (const e of objectEls) {
    const assetId = e.resolution?.assetId;
    if (!assetId) continue;
    const count = (seen.get(assetId) ?? 0) + 1;
    seen.set(assetId, count);
    if (count > 1) repeatedAssetCount += 1;
  }

  const carryOverCount = scene.carryOver?.length ?? 0;
  const belowOccupancyMin = scene.occupancy < STYLE.occupancy.min;
  const belowSparse = scene.occupancy < STYLE.occupancy.sparse;

  const boardTooSparse =
    scene.occupancy < STYLE.occupancy.sparse && elementCount > 0;

  const minReadableTextViolation =
    minRenderedTextPx !== null && minRenderedTextPx < MIN_READABLE_FONT_PX - 1e-9;

  let tinyElementCount = 0;
  for (const e of scene.elements) {
    if (e.element.prim === 'container') continue;
    const scale = Math.min(
      e.bbox.w / Math.max(1e-6, e.intrinsicSize.w),
      e.bbox.h / Math.max(1e-6, e.intrinsicSize.h),
    );
    if (scale < 0.6 - 1e-9) tinyElementCount += 1;
  }

  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  let outlineThenFill = true;
  let sawPrimaryReveal = false;
  for (const ev of events) {
    if (!isPrimaryReveal(ev.track)) continue;
    sawPrimaryReveal = true;
    const laid = byId.get(ev.elementId);
    if (!laid) continue;
    if (laid.visual.paths.length > 0 && ev.track === 'stroke') {
      if (!((ev.phases?.strokeMs ?? 0) > 0)) {
        outlineThenFill = false;
        break;
      }
    }
  }
  if (!sawPrimaryReveal) outlineThenFill = false;

  return {
    sceneId: scene.sceneId,
    elementCount,
    objectCount,
    edgeCount,
    factualEdgeCount,
    revealCount,
    edgeRevealCount,
    durationSec,
    occupancy: scene.occupancy,
    minRenderedTextPx,
    meanRenderedTextPx,
    textFallbackCount,
    textFallbackShare,
    unresolvedObjectCount,
    carryOverCount,
    repeatedAssetCount,
    belowOccupancyMin,
    belowSparse,
    boardTooSparse,
    minReadableTextViolation,
    tinyElementCount,
    outlineThenFill,
  };
}

export interface BoardMetricsSummary {
  scenes: number;
  meanElements: number;
  medianElements: number;
  meanReveals: number;
  medianReveals: number;
  meanOccupancy: number;
  medianOccupancy: number;
  p25Occupancy: number;
  p75Occupancy: number;
  meanEdges: number;
  medianEdges: number;
  meanDurationSec: number;
  medianDurationSec: number;
  shareBelowMin: number;
  shareTooSparse: number;
  shareTextViolation: number;
  meanTextFallbackShare: number;
  outlineThenFillRate: number;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base]! + rest * ((sorted[Math.min(base + 1, sorted.length - 1)]! - sorted[base]!));
};

export function summarizeBoardMetrics(rows: BoardSceneMetrics[]): BoardMetricsSummary {
  const count = rows.length;
  const elements = rows.map((r) => r.elementCount).sort((a, b) => a - b);
  const reveals = rows.map((r) => r.revealCount).sort((a, b) => a - b);
  const occupancies = rows.map((r) => r.occupancy).sort((a, b) => a - b);
  const edges = rows.map((r) => r.edgeCount).sort((a, b) => a - b);
  const durations = rows.map((r) => r.durationSec).sort((a, b) => a - b);
  return {
    scenes: count,
    meanElements: mean(rows.map((r) => r.elementCount)),
    medianElements: quantile(elements, 0.5),
    meanReveals: mean(rows.map((r) => r.revealCount)),
    medianReveals: quantile(reveals, 0.5),
    meanOccupancy: mean(rows.map((r) => r.occupancy)),
    medianOccupancy: quantile(occupancies, 0.5),
    p25Occupancy: quantile(occupancies, 0.25),
    p75Occupancy: quantile(occupancies, 0.75),
    meanEdges: mean(rows.map((r) => r.edgeCount)),
    medianEdges: quantile(edges, 0.5),
    meanDurationSec: mean(rows.map((r) => r.durationSec)),
    medianDurationSec: quantile(durations, 0.5),
    shareBelowMin: count ? rows.filter((r) => r.belowOccupancyMin).length / count : 0,
    shareTooSparse: count ? rows.filter((r) => r.boardTooSparse).length / count : 0,
    shareTextViolation: count ? rows.filter((r) => r.minReadableTextViolation).length / count : 0,
    meanTextFallbackShare: mean(rows.map((r) => r.textFallbackShare)),
    outlineThenFillRate: count ? rows.filter((r) => r.outlineThenFill).length / count : 0,
  };
}

export interface SimiReferenceV1 {
  schemaVersion: 'lamina-board-metrics/v1';
  sceneCount: number;
  sceneDurationSec: { median: number; p25: number; p75: number; min: number; max: number };
  boardCoverageBand: { min: number; max: number };
  revealTargetBand: { min: number; max: number };
  revealOrder: 'outline-then-fill';
  [key: string]: unknown;
}

export interface BoardMetricsDeltas {
  occupancyMedianGapToBand: number;
  occupancyMedianInsideBand: boolean;
  revealsMedianGapToBand: number;
  revealsMedianInsideBand: boolean;
  durationMedianDeltaVsRef: number;
  durationMedianWithinRange: boolean;
}

const gapToBand = (value: number, band: { min: number; max: number }): number => {
  if (value < band.min) return value - band.min;
  if (value > band.max) return value - band.max;
  return 0;
};

export function compareBoardMetrics(ours: BoardMetricsSummary, ref: SimiReferenceV1): BoardMetricsDeltas {
  const occupancyMedianGapToBand = gapToBand(ours.medianOccupancy, ref.boardCoverageBand);
  const revealsMedianGapToBand = gapToBand(ours.medianReveals, ref.revealTargetBand);
  return {
    occupancyMedianGapToBand,
    occupancyMedianInsideBand: occupancyMedianGapToBand === 0,
    revealsMedianGapToBand,
    revealsMedianInsideBand: revealsMedianGapToBand === 0,
    durationMedianDeltaVsRef: ours.medianDurationSec - ref.sceneDurationSec.median,
    durationMedianWithinRange:
      ours.medianDurationSec >= ref.sceneDurationSec.min && ours.medianDurationSec <= ref.sceneDurationSec.max,
  };
}

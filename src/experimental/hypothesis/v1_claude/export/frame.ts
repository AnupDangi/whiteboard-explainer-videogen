import type { LaidOutScene, Timeline } from '../types.js';
import { renderSceneBody } from '../render/renderScene.js';
import { svgDocument } from '../../shared/svg.js';
import { STYLE } from '../style.js';

export interface VideoScene {
  laidOut: LaidOutScene;
  timeline: Timeline;
  /** Absolute [startMs,endMs) on the master clock. */
  startMs: number;
  endMs: number;
}

export const ERASE_MS = 300;

const blankSvg = (): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${STYLE.canvas.w}" height="${STYLE.canvas.h}" viewBox="0 0 ${STYLE.canvas.w} ${STYLE.canvas.h}"><rect width="${STYLE.canvas.w}" height="${STYLE.canvas.h}" fill="${STYLE.canvas.bg}"/></svg>`;

/** Pure master-clock frame selection and transition composition shared by MP4 and browser playback. */
export function frameSvgAt(sorted: VideoScene[], t: number): string {
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].startMs <= t) idx = i;
    else break;
  }
  if (idx === -1) idx = 0;
  const active = sorted[idx];
  if (!active) return blankSvg();
  const clampedT = Math.min(Math.max(t, active.startMs), active.endMs - 1);
  const body = renderSceneBody(active.laidOut, active.timeline, clampedT);
  const next = sorted[idx + 1];
  if (next && next.laidOut.carryOver.length === 0 && t >= next.startMs - ERASE_MS) {
    const p = Math.min(1, (t - (next.startMs - ERASE_MS)) / ERASE_MS);
    return svgDocument(`${body}<rect x="0" y="0" width="${STYLE.canvas.w * p}" height="${STYLE.canvas.h}" fill="${STYLE.canvas.bg}"/>`);
  }
  return svgDocument(body);
}

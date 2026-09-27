import { EXPERIMENT } from '../shared/contracts.js';
import type { PaletteToken } from './types.js';

/**
 * One global style file (claude_pipeline.md §13 / hypothesis/v1_claude/01 §5).
 * Default roughness is zero everywhere in scored runs; any roughness > 0 is a
 * fixture-only experiment gated behind explicit opt-in (see render/primitives.ts).
 */
export const STYLE = {
  canvas: { w: EXPERIMENT.width, h: EXPERIMENT.height, bg: '#FDFDFB', safe: EXPERIMENT.safeArea },
  stroke: { color: '#1A1A1A', width: 4, cap: 'round', join: 'round' },
  palette: {
    blue: '#9CCDF0',
    yellow: '#FFE77A',
    green: '#A8E08A',
    orange: '#FFB35C',
    purple: '#C9A8F0',
    red: '#FF7A6B',
    grey: '#D9D9D9',
    none: 'none',
  } satisfies Record<PaletteToken, string>,
  font: {
    family: 'Kalam, sans-serif',
    weight: 700,
    uppercaseLabels: true,
    sizes: { title: 64, body: 40, label: 32, note: 32 },
    /** Scene heading: reference frames letter it at ~50% of frame width for a short title. */
    sceneTitle: 96,
  },
  element: { objectSize: [150, 220] as [number, number], boxMinW: 180, boxMinH: 120, gap: 64 },
  // Occupancy bands (Task 9 measurement, 2026-09-27, growth factors to 2.0):
  // dense templates reach 0.41-0.54 (hub 0.41, convergence 0.49, fan_out
  // 0.48-0.50, stack 0.53-0.54, cycle 0.54, plot_focus 0.51); width-bound
  // single-row boards cap lower (chain 3-node 0.31, 4-node 0.23, list 0.21,
  // title_card 0.25); the sparsest healthy template (threshold) measures
  // 0.098. The 0.45 Simi band therefore stays a warning; the hard sparse
  // floor sits below the sparsest healthy template, so the gate catches
  // degenerate near-empty boards (plus the <2 element count clause) without
  // hard-failing healthy geometry-capped layouts. Do NOT raise hardMin to
  // the Simi band without a layout redesign that provably lifts every
  // template above it.
  occupancy: { min: 0.45, target: 0.55, max: 0.75, hardMin: 0.08 },
  roughness: 0,
  motion: { strokeSpeedPxPerSec: 900, fillFadeMs: 250, textWipeCharMs: 35, arrowMs: 400, leadMs: 150, maxIdleMs: 2500 },
} as const;

export const paletteFill = (token: PaletteToken | undefined): string => STYLE.palette[token ?? 'none'];

/** Minimum readable label height in px at 1080p (gate G6 in hypothesis/v1_claude/03). */
export const MIN_READABLE_FONT_PX = 32;

/** Hard cap on simultaneous reveals (claude_pipeline.md §15). */
export const MAX_CONCURRENT_REVEALS = 2;

/** Hard cap on elements per scene (claude_pipeline.md §9). */
export const MAX_ELEMENTS_PER_SCENE = 9;

/** Hard cap on label word count (claude_pipeline.md §9). */
export const MAX_LABEL_WORDS = 4;

/** Scene titles: short, but reference titles run to six words. */
export const MAX_TITLE_WORDS = 7;

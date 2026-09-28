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
  /** Top band reserved for the scene title (layout keeps it clear, the renderer sets the title baseline there). */
  layout: { titleBandPx: 150 },
  element: { objectSize: [150, 220] as [number, number], boxMinW: 180, boxMinH: 120, gap: 64 },
  /**
   * Share of the frame the board's bounding box covers at scene end. Layout
   * scales a board toward `target`; outside [min, max] is a warning, below
   * `sparse` a hard `board-too-sparse` failure.
   */
  occupancy: { sparse: 0.3, min: 0.45, target: 0.55, max: 0.75 },
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

import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResvgRenderOptions } from '@resvg/resvg-js';

const DIST_SOURCE_MARKER = `${sep}dist${sep}src${sep}`;
const RAW_HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_HERE = RAW_HERE.includes(DIST_SOURCE_MARKER)
  ? RAW_HERE.replace(DIST_SOURCE_MARKER, `${sep}src${sep}`)
  : RAW_HERE;

/** Kalam is bundled so glyph measurement, MP4 rasterization, and browser playback use the same font. */
export const KALAM_BOLD_FILE = resolve(SOURCE_HERE, '../assets/fonts/Kalam-Bold.ttf');
export const KALAM_FONT_FAMILY = 'Kalam';
export const KALAM_FONT_SHA256 = '2f6576601db015d4f6c08678120277fc8510b98c06e932ce7a6a9cbff4cbdded';

export const RESVG_FONT_OPTIONS: ResvgRenderOptions = {
  font: {
    loadSystemFonts: false,
    fontFiles: [KALAM_BOLD_FILE],
    defaultFontFamily: KALAM_FONT_FAMILY,
    sansSerifFamily: KALAM_FONT_FAMILY,
  },
};

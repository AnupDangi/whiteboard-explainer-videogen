import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runFfmpeg } from './ffmpeg.js';

/**
 * Concatenate N real per-scene WAV files (from `synthesizeAndAlign`) into one
 * master-clock WAV, honestly padding with real silence — not stretching or
 * resampling any spoken word — between scenes (`gapMs`, matching the
 * SCENE_GAP_MS convention narration/align.ts uses in fixture mode) and, if
 * the golden's nominal clip length is longer than the real narrated content,
 * a trailing silence pad on the LAST scene (`trailingPadMs`) so the final
 * video holds the last scene's frame rather than cutting off early. Uses
 * ffmpeg's `apad` + `concat` audio filters (not the demuxer-based concat) so
 * per-file format differences are re-decoded safely.
 */
export async function concatSceneAudio(scenePaths: string[], gapMs: number, trailingPadMs: number, outPath: string): Promise<void> {
  if (scenePaths.length === 0) throw new Error('concatSceneAudio: no scene audio paths supplied');
  await mkdir(dirname(outPath), { recursive: true });
  const n = scenePaths.length;
  const filters: string[] = [];
  const labels: string[] = [];
  scenePaths.forEach((_, i) => {
    const padSec = i === n - 1 ? Math.max(0, trailingPadMs) / 1000 : Math.max(0, gapMs) / 1000;
    filters.push(`[${i}:a]apad=pad_dur=${padSec.toFixed(3)}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filterComplex = `${filters.join(';')};${labels.join('')}concat=n=${n}:v=0:a=1[out]`;
  const args = ['-y', ...scenePaths.flatMap((p) => ['-i', p]), '-filter_complex', filterComplex, '-map', '[out]', outPath];
  await runFfmpeg(args);
}

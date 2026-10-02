import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodedMediaDigest, mediaDigestsMatch, type MediaDigest } from '../export/mediaDigest.js';
import { encodeLockedLessonV2Clips } from './clipsV2.js';

export interface MediaReplayReport { runs: number; digest: MediaDigest; problems: string[]; againstExisting?: string[] }

/**
 * Full decoded-media replay: encode the locked lesson `runs` times from cold clip caches and require every decode (video frames
 * and audio samples) to match the first. When the run already produced a video, it must match too. This is the offline half of
 * the release determinism gate; the lock verifier still guards the inputs.
 */
export async function replayDecodedMediaV2(outputDir: string, options: { runs?: number; existingVideo?: string } = {}): Promise<MediaReplayReport> {
  const runs = Math.max(2, options.runs ?? 2);
  const scratch = await mkdtemp(path.join(tmpdir(), 'v2-media-replay-'));
  try {
    const digests: MediaDigest[] = [];
    for (let i = 0; i < runs; i++) {
      const out = path.join(scratch, `run-${i}.mp4`);
      await encodeLockedLessonV2Clips(outputDir, out, { cacheDir: path.join(scratch, `cache-${i}`) });
      digests.push(await decodedMediaDigest(out));
    }
    const problems = digests.slice(1).flatMap((digest, i) => mediaDigestsMatch(digests[0]!, digest).map((problem) => `run ${i + 2}: ${problem}`));
    const againstExisting = options.existingVideo ? mediaDigestsMatch(digests[0]!, await decodedMediaDigest(options.existingVideo)) : undefined;
    return { runs, digest: digests[0]!, problems: [...problems, ...(againstExisting ?? []).map((p) => `existing video: ${p}`)], ...(againstExisting ? { againstExisting } : {}) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

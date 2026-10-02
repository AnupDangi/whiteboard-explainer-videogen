import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderLockedFinalFrames, verifyLessonLock, type LessonLock, type VerifyLockOptions } from '../run/lessonLock.js';

/**
 * Deterministic-replay evidence (V2 plan Phase 0 exit / §12): replay the same lock N
 * times and require every hash class to agree. Geometry, events, assets and audio are
 * taken from the lock's own content hashes; frames are re-rendered from the locked
 * layout + timeline, so a renderer that reads anything else would drift here.
 */
export interface ReplayDigest { geometry: string; events: string; assets: string; audio: string; frames: string }
export interface ReplayMismatch { replay: number; kind: keyof ReplayDigest; expected: string; actual: string }
export interface ReplayComparison { replays: number; identical: boolean; mismatches: ReplayMismatch[] }

const KINDS: Array<keyof ReplayDigest> = ['geometry', 'events', 'assets', 'audio', 'frames'];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonicalize(v)]));
  return value;
}

/** SHA-256 of a JSON value with object keys sorted, so key order never changes a hash. */
export const canonicalHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');

export function compareReplayDigests(digests: ReplayDigest[]): ReplayComparison {
  if (digests.length < 2) throw new Error('determinism needs at least two replays');
  const [first, ...rest] = digests as [ReplayDigest, ...ReplayDigest[]];
  const mismatches: ReplayMismatch[] = [];
  rest.forEach((digest, index) => {
    for (const kind of KINDS) if (digest[kind] !== first[kind]) mismatches.push({ replay: index + 1, kind, expected: first[kind], actual: digest[kind] });
  });
  return { replays: digests.length, identical: mismatches.length === 0, mismatches };
}

/** One replay of a locked run directory. Re-renders final frames into `outputDir`, so pass a scratch copy. */
export async function replayDigest(outputDir: string, options: VerifyLockOptions = {}): Promise<ReplayDigest> {
  const problems = await verifyLessonLock(outputDir, options);
  if (problems.length) throw new Error(`lesson lock verification failed: ${problems.join('; ')}`);
  const lock = JSON.parse(await readFile(path.join(outputDir, 'lesson.lock.json'), 'utf8')) as LessonLock;
  const { frames } = await renderLockedFinalFrames(outputDir, { allowFailedDiagnostic: true, ...options });
  return {
    geometry: canonicalHash(lock.scenes.map((scene) => [scene.sceneId, scene.fileHashes.layout, scene.fileHashes.resolved])),
    events: canonicalHash(lock.scenes.map((scene) => [scene.sceneId, scene.fileHashes.timeline, scene.alignmentHash ?? null])),
    assets: canonicalHash([lock.assets, lock.scenes.map((scene) => [scene.sceneId, scene.assetRefs])]),
    audio: canonicalHash([lock.audioScenes.map((scene) => [scene.sceneId, scene.hash]), lock.media.audioHash ?? null]),
    frames: canonicalHash(Object.entries(frames).sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, svg]) => [id, createHash('sha256').update(svg, 'utf8').digest('hex')])),
  };
}

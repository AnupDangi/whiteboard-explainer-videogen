import { readFile } from 'node:fs/promises';
import { withHostResourcePermit } from '../../shared/hostResourcePool.js';
import { synthesizeAndAlign, type AlignedWord, type AlignerIdentity } from '../../shared/alignment/align.js';
import type { ContentAddressedArtifactStore } from '../artifactCache.js';
import { configuredConcurrency } from './limiter.js';
import { S5_MODEL_ID, S5_STAGE_VERSION } from './versions.js';

/** TTS + forced-alignment processes running at once on this host (all runs share it). */
export const DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY = configuredConcurrency('HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY', 2);

export interface SceneAudioRequest {
  sceneId: string;
  /** Plain narration text (markers removed), spoken verbatim. */
  text: string;
  language: string;
  voice?: string;
  /** Part of the cache key: a new calibration never reuses clocks measured under the old one. */
  calibrationMedianErrorMs?: number;
}

export interface SceneAudio {
  durationMs: number;
  words: AlignedWord[];
  aligner: AlignerIdentity;
  repairedWordIndexes: number[];
  audio: Buffer;
  cacheHit: boolean;
  /** Present when an artifact store was used. */
  artifact?: { key: string; contentHash: string; cacheHit: boolean };
}

export interface SceneAudioDeps {
  /** Replaces the local voice-engine + aligner (tests, alternative TTS). */
  aligner?: typeof synthesizeAndAlign;
  artifactStore?: ContentAddressedArtifactStore;
}

const ARTIFACT_META = { schemaVersion: 'claude-aligned-scene/v1', stageVersion: S5_STAGE_VERSION, modelId: S5_MODEL_ID } as const;
export const sceneAudioStage = (sceneId: string) => `S5-tts-alignment:${sceneId}`;

/**
 * S5 for one scene: synthesize speech and measure word timings, through the
 * content-addressed cache when one is given. The same function serves lesson
 * preparation (module audio budgets) and the live run, so both read the
 * identical cached artifact for the same text, voice and calibration.
 */
export async function synthesizeSceneAudio(request: SceneAudioRequest, deps: SceneAudioDeps = {}): Promise<SceneAudio> {
  const aligner = deps.aligner ?? synthesizeAndAlign;
  const generate = async () => {
    const generated = await withHostResourcePermit('tts-alignment', DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY, () => aligner(request.text, { language: request.language, voice: request.voice, provider: 'auto', model: 'base' }));
    return { durationMs: generated.durationMs, words: generated.words, aligner: generated.aligner, repairedWordIndexes: generated.repairedWordIndexes, audioBase64: (await readFile(generated.audioPath)).toString('base64') };
  };
  const cacheInput = { text: request.text, language: request.language, voice: request.voice, provider: 'auto', model: 'base', calibrationMedianErrorMs: request.calibrationMedianErrorMs };
  if (!deps.artifactStore) {
    const payload = await generate();
    return { ...fromPayload(payload), cacheHit: false };
  }
  const stage = sceneAudioStage(request.sceneId);
  const cached = await deps.artifactStore.run(stage, cacheInput, ARTIFACT_META, generate);
  // A later stage in this run may ask for the same scene; serve it from memory, not a second synthesis.
  deps.artifactStore.reuseWithinRun(stage, cacheInput, ARTIFACT_META, cached.artifact);
  return { ...fromPayload(cached.artifact.payload), cacheHit: cached.cacheHit, artifact: { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit } };
}

function fromPayload(payload: { durationMs: number; words: AlignedWord[]; aligner?: AlignerIdentity; repairedWordIndexes?: number[]; audioBase64: string }): Omit<SceneAudio, 'cacheHit' | 'artifact'> {
  return { durationMs: payload.durationMs, words: payload.words, aligner: payload.aligner ?? 'stable-ts', repairedWordIndexes: payload.repairedWordIndexes ?? [], audio: Buffer.from(payload.audioBase64, 'base64') };
}

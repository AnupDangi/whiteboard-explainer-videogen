import { readFile } from 'node:fs/promises';
import { elevenLabsAligner, loadElevenLabsCapabilitySnapshot, modelsForLanguage, resolveElevenLabsModel, resolveElevenLabsVoice, type ElevenLabsCapabilitySnapshot, type ElevenLabsUsageEvent } from './elevenlabs.js';
import { withHostResourcePermit } from '../shared/hostResourcePool.js';
import { synthesizeAndAlign, type AlignedWord, type AlignerIdentity } from '../shared/alignment/align.js';
import type { ContentAddressedArtifactStore } from '../run/artifactCache.js';
import { configuredConcurrency } from '../run/limiter.js';
import { S5_MODEL_ID, S5_STAGE_VERSION } from '../run/versions.js';

/** TTS + forced-alignment processes running at once on this host (all runs share it). */
export const DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY = configuredConcurrency('HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY', 2);

export interface SceneAudioRequest {
  sceneId: string;
  /** Plain narration text (markers removed), spoken verbatim. */
  text: string;
  language: string;
  voice?: string;
  /** Versioned lesson-wide native-language/English technical terminology policy. */
  languagePolicy?: 'english-only/v1' | 'native-plus-english-terms/v1';
  terminology?: ReadonlyArray<{ term: string; nativeExplanation?: string }>;
  /** Captured provider metadata makes routing deterministic and network-free in tests. */
  elevenLabsCapabilities?: ElevenLabsCapabilitySnapshot;
  elevenLabsModel?: string;
  voiceSettings?: { stability: number; similarity_boost: number; speed: number };
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
  providerMetadata?: { provider: 'elevenlabs'; model: string; voice: string; credits: number; submittedText: string; normalizedText: string; normalizationVersion: string; rawCharacterClock: { characters: string[]; startTimesSeconds: number[]; endTimesSeconds: number[] }; normalizedCharacterClock: { characters: string[]; startTimesSeconds: number[]; endTimesSeconds: number[] }; capabilitySnapshotId?: string };
}

export interface SceneAudioDeps {
  /** Replaces the local voice-engine + aligner (tests, alternative TTS). */
  aligner?: typeof synthesizeAndAlign;
  artifactStore?: ContentAddressedArtifactStore;
  onElevenLabsUsage?: (event: ElevenLabsUsageEvent) => void;
}

const ARTIFACT_META = { schemaVersion: 'claude-aligned-scene/v1', stageVersion: S5_STAGE_VERSION, modelId: S5_MODEL_ID } as const;
/** `TTS_PROVIDER=elevenlabs` switches speech and word timing to ElevenLabs; the default is the local voice engine plus forced alignment. */
export const ttsProvider = (env: NodeJS.ProcessEnv = process.env): 'local' | 'elevenlabs' => (env.TTS_PROVIDER === 'elevenlabs' ? 'elevenlabs' : 'local');
export const sceneAudioStage = (sceneId: string) => `S5-tts-alignment:${sceneId}`;

/** Audio must fit inside the requested clock; never trim, stretch, or pad it to manufacture a pass. */
export const FIXED_AUDIO_DURATION_TOLERANCE_MS = 200;
export function audioDurationProblems(actualDurationMs: number, requestedDurationMs: number, toleranceMs = FIXED_AUDIO_DURATION_TOLERANCE_MS): string[] {
  if (!Number.isFinite(actualDurationMs) || actualDurationMs <= 0) return ['audio duration is missing or invalid'];
  if (!Number.isFinite(requestedDurationMs) || requestedDurationMs <= 0) return ['requested duration is missing or invalid'];
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0) return ['duration tolerance is invalid'];
  return Math.abs(actualDurationMs - requestedDurationMs) <= toleranceMs ? [] : [`audio duration ${actualDurationMs}ms differs from requested ${requestedDurationMs}ms by more than ${toleranceMs}ms`];
}

/**
 * S5 for one scene: synthesize speech and measure word timings, through the
 * content-addressed cache when one is given. The same function serves lesson
 * preparation (module audio budgets) and the live run, so both read the
 * identical cached artifact for the same text, voice and calibration.
 */
export async function synthesizeSceneAudio(request: SceneAudioRequest, deps: SceneAudioDeps = {}): Promise<SceneAudio> {
  const tts = ttsProvider();
  const aligner = deps.aligner ?? (tts === 'elevenlabs' ? elevenLabsAligner : synthesizeAndAlign);
  const capabilities = tts === 'elevenlabs' ? request.elevenLabsCapabilities ?? loadElevenLabsCapabilitySnapshot() : undefined;
  const generate = async () => {
    const generated = await withHostResourcePermit('tts-alignment', DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY, () => tts === 'elevenlabs' && !deps.aligner
      ? elevenLabsAligner(request.text, { language: request.language, voice: request.voice, model: request.elevenLabsModel, capabilities, voiceSettings: request.voiceSettings, onUsage: deps.onElevenLabsUsage })
      : aligner(request.text, { language: request.language, voice: request.voice, provider: 'auto', model: 'base' }));
    const eleven = generated as typeof generated & Partial<{ model: string; voice: string; credits: number; submittedText: string; normalizedText: string; normalizationVersion: string; rawCharacterClock: NonNullable<SceneAudio['providerMetadata']>['rawCharacterClock']; normalizedCharacterClock: NonNullable<SceneAudio['providerMetadata']>['normalizedCharacterClock']; capabilitySnapshotId: string }>;
    const providerMetadata = typeof eleven.model === 'string' && typeof eleven.voice === 'string' && typeof eleven.credits === 'number' && typeof eleven.submittedText === 'string' && typeof eleven.normalizedText === 'string' && typeof eleven.normalizationVersion === 'string' && eleven.rawCharacterClock && eleven.normalizedCharacterClock
      ? { provider: 'elevenlabs' as const, model: eleven.model, voice: eleven.voice, credits: eleven.credits, submittedText: eleven.submittedText, normalizedText: eleven.normalizedText, normalizationVersion: eleven.normalizationVersion, rawCharacterClock: eleven.rawCharacterClock, normalizedCharacterClock: eleven.normalizedCharacterClock, ...(eleven.capabilitySnapshotId ? { capabilitySnapshotId: eleven.capabilitySnapshotId } : {}) }
      : undefined;
    return { durationMs: generated.durationMs, words: generated.words, aligner: generated.aligner, repairedWordIndexes: generated.repairedWordIndexes, ...(providerMetadata ? { providerMetadata } : {}), audioBase64: (await readFile(generated.audioPath)).toString('base64') };
  };
  const effectiveVoice = tts === 'elevenlabs' ? resolveElevenLabsVoice(request.voice) : request.voice;
  const requestedModel = tts === 'elevenlabs' ? resolveElevenLabsModel(request.elevenLabsModel) : undefined;
  const effectiveModel = tts === 'elevenlabs'
    ? requestedModel ?? (capabilities ? modelsForLanguage(capabilities, request.language)[0]?.id : undefined)
    : 'base';
  const languagePolicy = request.languagePolicy ?? (/^en(?:-|$)/iu.test(request.language) ? 'english-only/v1' : 'native-plus-english-terms/v1');
  const cacheInput = { text: request.text, language: request.language, voice: effectiveVoice, languagePolicy, terminology: request.terminology ?? [], provider: 'auto', model: effectiveModel, ...(tts === 'local' ? {} : { tts, capabilitySnapshotId: capabilities?.snapshotId ?? 'runtime-probe', voiceSettings: request.voiceSettings ?? { stability: 0.5, similarity_boost: 0.75, speed: 1 }, normalizationVersion: 'nfkc-whitespace/v1' }), calibration: { provider: tts, model: effectiveModel, voice: effectiveVoice, language: request.language, medianErrorMs: request.calibrationMedianErrorMs } };
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

function fromPayload(payload: { durationMs: number; words: AlignedWord[]; aligner?: AlignerIdentity; repairedWordIndexes?: number[]; audioBase64: string; providerMetadata?: SceneAudio['providerMetadata'] }): Omit<SceneAudio, 'cacheHit' | 'artifact'> {
  return { durationMs: payload.durationMs, words: payload.words, aligner: payload.aligner ?? 'stable-ts', repairedWordIndexes: payload.repairedWordIndexes ?? [], audio: Buffer.from(payload.audioBase64, 'base64'), ...(payload.providerMetadata ? { providerMetadata: payload.providerMetadata } : {}) };
}

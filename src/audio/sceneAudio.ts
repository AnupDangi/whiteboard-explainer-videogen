import { readFile } from 'node:fs/promises';
import { elevenLabsAligner, elevenLabsEnv, loadElevenLabsCapabilitySnapshot, modelsForLanguage, resolveElevenLabsModel, resolveElevenLabsVoice, type ElevenLabsCapabilitySnapshot, type ElevenLabsUsageEvent } from './elevenlabs.js';
import { withHostResourcePermit } from '../shared/hostResourcePool.js';
import { synthesizeAndAlign, type AlignedWord, type AlignerIdentity } from '../shared/alignment/align.js';
import type { ContentAddressedArtifactStore } from '../run/artifactCache.js';
import { configuredConcurrency } from '../run/limiter.js';
import { S5_MODEL_ID, S5_STAGE_VERSION } from '../run/versions.js';

/** TTS + forced-alignment processes running at once on this host (all runs share it). */
export const DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY = configuredConcurrency('HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY', 3);

/** Load TTS routing from the same env file as OpenRouter for CLI runs; explicit process/CLI settings win. */
export function applyTtsConfigFromEnvFile(): void {
  const env = elevenLabsEnv();
  if (process.env.TTS_PROVIDER === undefined && env.TTS_PROVIDER !== undefined) process.env.TTS_PROVIDER = env.TTS_PROVIDER;
  if (process.env.TTS_FALLBACK_LOCAL === undefined && env.TTS_FALLBACK_LOCAL !== undefined) process.env.TTS_FALLBACK_LOCAL = env.TTS_FALLBACK_LOCAL;
}

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
  /** Present when the elevenlabs attempt failed (spent keys, refusal, outage) and local synthesis carried the scene. */
  ttsFallback?: { from: 'elevenlabs'; reason: string };
}

export interface SceneAudioDeps {
  /** Replaces the local voice-engine + aligner (tests, alternative TTS). */
  aligner?: typeof synthesizeAndAlign;
  artifactStore?: ContentAddressedArtifactStore;
  onElevenLabsUsage?: (event: ElevenLabsUsageEvent) => void;
}

const inFlightSynthesis = new WeakMap<object, Map<string, Promise<unknown>>>();
function coalesceSynthesis<T>(store: object, key: string, start: () => Promise<T>): Promise<T> {
  let byKey = inFlightSynthesis.get(store);
  if (!byKey) { byKey = new Map(); inFlightSynthesis.set(store, byKey); }
  const running = byKey.get(key);
  if (running) return running as Promise<T>;
  const promise = start().finally(() => { byKey!.delete(key); });
  byKey.set(key, promise);
  return promise;
}

const ARTIFACT_META = { schemaVersion: 'claude-aligned-scene/v1', stageVersion: S5_STAGE_VERSION, modelId: S5_MODEL_ID } as const;
/** `TTS_PROVIDER=elevenlabs` switches speech and word timing to ElevenLabs; the default is the local voice engine plus forced alignment. */
export const ttsProvider = (env: NodeJS.ProcessEnv = process.env): 'local' | 'elevenlabs' => (env.TTS_PROVIDER === 'elevenlabs' ? 'elevenlabs' : 'local');
/** When elevenlabs synthesis fails (all keys spent, refused, unreachable), fall back to local synthesis instead of failing the scene. `TTS_FALLBACK_LOCAL=0` disables it. */
export const ttsLocalFallbackEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const raw = env.TTS_FALLBACK_LOCAL;
  return raw === undefined || (raw !== '0' && raw.toLowerCase() !== 'false');
};
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
  const capabilities = tts === 'elevenlabs' ? request.elevenLabsCapabilities ?? loadElevenLabsCapabilitySnapshot() : undefined;
  const languagePolicy = request.languagePolicy ?? (/^en(?:-|$)/iu.test(request.language) ? 'english-only/v1' : 'native-plus-english-terms/v1');
  const cacheInputFor = (provider: 'local' | 'elevenlabs') => {
    const effectiveVoice = provider === 'elevenlabs' ? resolveElevenLabsVoice(request.voice) : request.voice;
    const effectiveModel = provider === 'elevenlabs'
      ? resolveElevenLabsModel(request.elevenLabsModel) ?? (capabilities ? modelsForLanguage(capabilities, request.language)[0]?.id : undefined)
      : 'base';
    return { text: request.text, language: request.language, voice: effectiveVoice, languagePolicy, terminology: request.terminology ?? [], provider: 'auto', model: effectiveModel, ...(provider === 'local' ? {} : { tts: provider, capabilitySnapshotId: capabilities?.snapshotId ?? 'runtime-probe', voiceSettings: request.voiceSettings ?? { stability: 0.5, similarity_boost: 0.75, speed: 1 }, normalizationVersion: 'nfkc-whitespace/v1' }), calibration: { provider, model: effectiveModel, voice: effectiveVoice, language: request.language, medianErrorMs: request.calibrationMedianErrorMs } };
  };
  const run = async (provider: 'local' | 'elevenlabs') => {
    const generated = await withHostResourcePermit('tts-alignment', DEFAULT_HOST_TTS_ALIGNMENT_CONCURRENCY, () => provider === 'elevenlabs'
      ? elevenLabsAligner(request.text, { language: request.language, voice: request.voice, model: request.elevenLabsModel, capabilities, voiceSettings: request.voiceSettings, onUsage: deps.onElevenLabsUsage })
      : (deps.aligner ?? synthesizeAndAlign)(request.text, { language: request.language, voice: request.voice, provider: 'auto', model: 'base' }));
    const eleven = generated as typeof generated & Partial<{ model: string; voice: string; credits: number; submittedText: string; normalizedText: string; normalizationVersion: string; rawCharacterClock: NonNullable<SceneAudio['providerMetadata']>['rawCharacterClock']; normalizedCharacterClock: NonNullable<SceneAudio['providerMetadata']>['normalizedCharacterClock']; capabilitySnapshotId: string }>;
    const providerMetadata = typeof eleven.model === 'string' && typeof eleven.voice === 'string' && typeof eleven.credits === 'number' && typeof eleven.submittedText === 'string' && typeof eleven.normalizedText === 'string' && typeof eleven.normalizationVersion === 'string' && eleven.rawCharacterClock && eleven.normalizedCharacterClock
      ? { provider: 'elevenlabs' as const, model: eleven.model, voice: eleven.voice, credits: eleven.credits, submittedText: eleven.submittedText, normalizedText: eleven.normalizedText, normalizationVersion: eleven.normalizationVersion, rawCharacterClock: eleven.rawCharacterClock, normalizedCharacterClock: eleven.normalizedCharacterClock, ...(eleven.capabilitySnapshotId ? { capabilitySnapshotId: eleven.capabilitySnapshotId } : {}) }
      : undefined;
    return { durationMs: generated.durationMs, words: generated.words, aligner: generated.aligner, repairedWordIndexes: generated.repairedWordIndexes, ...(providerMetadata ? { providerMetadata } : {}), audioBase64: (await readFile(generated.audioPath)).toString('base64') };
  };
  const deliver = (payload: Awaited<ReturnType<typeof run>> & { ttsFallback?: SceneAudio['ttsFallback'] }, cacheHit: boolean, artifact?: SceneAudio['artifact']): SceneAudio =>
    ({ ...fromPayload(payload), cacheHit, ...(artifact ? { artifact } : {}), ...(payload.ttsFallback ? { ttsFallback: payload.ttsFallback } : {}) });
  if (tts === 'local') {
    if (!deps.artifactStore) return deliver(await run('local'), false);
    const stage = sceneAudioStage(request.sceneId);
    const store = deps.artifactStore;
    // Identical requests in flight (an early prewarm and the later S5 call) share one synthesis: TTS runs once per scene text.
    const cached = await coalesceSynthesis(store, `${stage}\0${JSON.stringify(cacheInputFor('local'))}`, () => store.run(stage, cacheInputFor('local'), ARTIFACT_META, () => run('local')));
    deps.artifactStore.reuseWithinRun(stage, cacheInputFor('local'), ARTIFACT_META, cached.artifact);
    return deliver(cached.artifact.payload, cached.cacheHit, { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit });
  }
  const attemptElevenlabs = async () => {
    if (!deps.artifactStore) return deliver(await run('elevenlabs'), false);
    const stage = sceneAudioStage(request.sceneId);
    const cached = await deps.artifactStore.run(stage, cacheInputFor('elevenlabs'), ARTIFACT_META, () => run('elevenlabs'));
    deps.artifactStore.reuseWithinRun(stage, cacheInputFor('elevenlabs'), ARTIFACT_META, cached.artifact);
    return deliver(cached.artifact.payload, cached.cacheHit, { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit });
  };
  try {
    return await attemptElevenlabs();
  } catch (error) {
    if (!ttsLocalFallbackEnabled()) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const payload = deps.artifactStore
      ? await deps.artifactStore.run(sceneAudioStage(request.sceneId), cacheInputFor('local'), ARTIFACT_META, () => run('local')).then((cached) => {
        deps.artifactStore!.reuseWithinRun(sceneAudioStage(request.sceneId), cacheInputFor('local'), ARTIFACT_META, cached.artifact);
        return deliver(cached.artifact.payload, cached.cacheHit, { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit });
      })
      : deliver(await run('local'), false);
    return { ...payload, ttsFallback: { from: 'elevenlabs', reason } };
  }
}

function fromPayload(payload: { durationMs: number; words: AlignedWord[]; aligner?: AlignerIdentity; repairedWordIndexes?: number[]; audioBase64: string; providerMetadata?: SceneAudio['providerMetadata'] }): Omit<SceneAudio, 'cacheHit' | 'artifact'> {
  return { durationMs: payload.durationMs, words: payload.words, aligner: payload.aligner ?? 'stable-ts', repairedWordIndexes: payload.repairedWordIndexes ?? [], audio: Buffer.from(payload.audioBase64, 'base64'), ...(payload.providerMetadata ? { providerMetadata: payload.providerMetadata } : {}) };
}

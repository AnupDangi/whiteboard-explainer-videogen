import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { audioDurationProblems, FIXED_AUDIO_DURATION_TOLERANCE_MS, synthesizeSceneAudio, type SceneAudioDeps } from '../audio/sceneAudio.js';
import { ContentAddressedArtifactStore } from '../run/artifactCache.js';

test('fixed duration gate accepts only the requested clock within the declared tolerance', () => {
  assert.equal(FIXED_AUDIO_DURATION_TOLERANCE_MS, 200);
  assert.deepEqual(audioDurationProblems(59_800, 60_000), []);
  assert.deepEqual(audioDurationProblems(60_200, 60_000), []);
  assert.match(audioDurationProblems(60_201, 60_000)[0]!, /differs from requested/);
  assert.match(audioDurationProblems(Number.NaN, 60_000)[0]!, /invalid/);
});

test('elevenlabs failure falls back to local synthesis with the reason recorded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-audio-fallback-'));
  const audioPath = path.join(root, 'fake.wav');
  await writeFile(audioPath, Buffer.from('offline synthetic audio'));
  const previousProvider = process.env.TTS_PROVIDER;
  const previousFallback = process.env.TTS_FALLBACK_LOCAL;
  process.env.TTS_PROVIDER = 'elevenlabs';
  delete process.env.TTS_FALLBACK_LOCAL;
  try {
    const store = new ContentAddressedArtifactStore(path.join(root, 'cache'));
    let calls = 0;
    const localDouble: NonNullable<SceneAudioDeps['aligner']> = async () => { calls++; return { durationMs: 1000, words: [{ word: 'osmosis', startMs: 0, endMs: 500 }], aligner: 'stable-ts', repairedWordIndexes: [], audioPath }; };
    const base = { sceneId: 's1', text: 'osmosis', language: 'en' };
    const first = await synthesizeSceneAudio(base, { aligner: localDouble, artifactStore: store });
    assert.equal(first.cacheHit, false);
    assert.equal(first.providerMetadata, undefined);
    assert.equal(first.ttsFallback?.from, 'elevenlabs');
    assert.match(first.ttsFallback?.reason ?? '', /capability snapshot|ElevenLabs/);
    const same = await synthesizeSceneAudio(base, { aligner: localDouble, artifactStore: store });
    assert.equal(same.cacheHit, true);
    assert.equal(same.ttsFallback?.from, 'elevenlabs');
    assert.equal(calls, 1);
    // The fallback artifact lives under the local cache identity: plain local synthesis reuses it.
    delete process.env.TTS_PROVIDER;
    const local = await synthesizeSceneAudio(base, { aligner: localDouble, artifactStore: store });
    assert.equal(local.cacheHit, true);
    assert.equal(local.ttsFallback, undefined);
    assert.equal(calls, 1);
  } finally {
    if (previousProvider === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = previousProvider;
    if (previousFallback === undefined) delete process.env.TTS_FALLBACK_LOCAL; else process.env.TTS_FALLBACK_LOCAL = previousFallback;
    await rm(root, { recursive: true, force: true });
  }
});

test('TTS_FALLBACK_LOCAL=0 keeps an elevenlabs failure hard', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-audio-no-fallback-'));
  const audioPath = path.join(root, 'fake.wav');
  await writeFile(audioPath, Buffer.from('offline synthetic audio'));
  const previousProvider = process.env.TTS_PROVIDER;
  const previousFallback = process.env.TTS_FALLBACK_LOCAL;
  process.env.TTS_PROVIDER = 'elevenlabs';
  process.env.TTS_FALLBACK_LOCAL = '0';
  try {
    const localDouble: NonNullable<SceneAudioDeps['aligner']> = async () => ({ durationMs: 1000, words: [], aligner: 'stable-ts', repairedWordIndexes: [], audioPath });
    await assert.rejects(() => synthesizeSceneAudio({ sceneId: 's1', text: 'osmosis', language: 'en' }, { aligner: localDouble }));
  } finally {
    if (previousProvider === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = previousProvider;
    if (previousFallback === undefined) delete process.env.TTS_FALLBACK_LOCAL; else process.env.TTS_FALLBACK_LOCAL = previousFallback;
    await rm(root, { recursive: true, force: true });
  }
});

test('audio cache identity includes language policy and canonical lesson terminology', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-audio-policy-'));
  const audioPath = path.join(root, 'fake.wav');
  await writeFile(audioPath, Buffer.from('offline synthetic audio'));
  try {
    const store = new ContentAddressedArtifactStore(path.join(root, 'cache'));
    let calls = 0;
    const aligner: NonNullable<SceneAudioDeps['aligner']> = async () => ({ durationMs: 1000, words: [{ word: 'osmosis', startMs: 0, endMs: 500 }], aligner: 'stable-ts', repairedWordIndexes: [], audioPath });
    const base = { sceneId: 's1', text: 'osmosis', language: 'hi', voice: 'voice-a', languagePolicy: 'native-plus-english-terms/v1' as const, terminology: [{ term: 'osmosis', nativeExplanation: 'जल का झिल्ली से गुजरना' }] };
    const countedAligner: NonNullable<SceneAudioDeps['aligner']> = async (...args) => { calls++; return aligner(...args); };
    const first = await synthesizeSceneAudio(base, { aligner: countedAligner, artifactStore: store });
    const same = await synthesizeSceneAudio(base, { aligner: countedAligner, artifactStore: store });
    const changed = await synthesizeSceneAudio({ ...base, terminology: [{ term: 'osmosis', nativeExplanation: 'दूसरी व्याख्या' }] }, { aligner: countedAligner, artifactStore: store });
    const english = await synthesizeSceneAudio({ ...base, language: 'en', languagePolicy: undefined }, { aligner: countedAligner, artifactStore: store });
    const englishAgain = await synthesizeSceneAudio({ ...base, language: 'en', languagePolicy: undefined }, { aligner: countedAligner, artifactStore: store });
    assert.equal(first.cacheHit, false); assert.equal(same.cacheHit, true); assert.equal(changed.cacheHit, false);
    assert.equal(english.cacheHit, false); assert.equal(englishAgain.cacheHit, true);
    assert.equal(calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent requests for the same scene audio share one synthesis (a prewarm and the later S5 call never both run TTS)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-audio-coalesce-'));
  const audioPath = path.join(root, 'fake.wav');
  await writeFile(audioPath, Buffer.from('offline synthetic audio'));
  const previousProvider = process.env.TTS_PROVIDER;
  delete process.env.TTS_PROVIDER;
  try {
    const store = new ContentAddressedArtifactStore(path.join(root, 'cache'), 'cold');
    let calls = 0;
    const slow: NonNullable<SceneAudioDeps['aligner']> = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return { durationMs: 1000, words: [{ word: 'osmosis', startMs: 0, endMs: 500 }], aligner: 'stable-ts', repairedWordIndexes: [], audioPath }; };
    const request = { sceneId: 's1', text: 'osmosis', language: 'en' };
    const [first, second] = await Promise.all([synthesizeSceneAudio(request, { aligner: slow, artifactStore: store }), synthesizeSceneAudio(request, { aligner: slow, artifactStore: store })]);
    assert.equal(calls, 1);
    assert.equal(first.durationMs, second.durationMs);
    const later = await synthesizeSceneAudio(request, { aligner: slow, artifactStore: store });
    assert.equal(calls, 1, 'a later call in the same run reuses the finished artifact');
    assert.equal(later.cacheHit, true);
  } finally {
    if (previousProvider === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = previousProvider;
    await rm(root, { recursive: true, force: true });
  }
});

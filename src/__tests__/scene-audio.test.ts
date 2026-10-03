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
    assert.equal(first.cacheHit, false); assert.equal(same.cacheHit, true); assert.equal(changed.cacheHit, false);
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

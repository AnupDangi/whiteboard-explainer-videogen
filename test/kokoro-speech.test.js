import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKokoroSpeech, KOKORO_VOICES} from '../dist/src/kokoro-speech.js';

const RUNTIME = process.env.TEST_KOKORO_TTS === '1';

test('Kokoro voice allowlist rejects unknown voices without spawning', async () => {
  await assert.rejects(generateKokoroSpeech('hello', {voiceId: 'not-a-voice'}), /Unknown Kokoro voice/);
  assert(KOKORO_VOICES.includes('af_heart'));
});

test('Kokoro speech returns real WAV with native word timings', {skip: !RUNTIME}, async () => {
  const {audio, timing, format} = await generateKokoroSpeech('hello world hello', {voiceId: 'af_heart'});
  assert.equal(format, 'wav');
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  const sampleRate = audio.readUInt32LE(24), channels = audio.readUInt16LE(22), bits = audio.readUInt16LE(34);
  assert.equal(sampleRate, 24000); assert.equal(channels, 1);
  const duration = audio.readUInt32LE(40) / (sampleRate * channels * bits / 8) * 1000;
  assert(Math.abs(duration - timing.durationMs) < 1);
  assert.deepEqual(timing.words.map(w => w.word), ['hello', 'world', 'hello']);
  assert.equal(timing.kind, 'kokoro-aligned');
  timing.words.forEach((word, i) => {
    assert(word.endMs > word.startMs);
    assert(word.endMs <= timing.durationMs + 1);
    if (i) assert(word.startMs >= timing.words[i - 1].endMs - 1);
  });
  assert(audio.subarray(44).some(byte => byte !== 0));
});

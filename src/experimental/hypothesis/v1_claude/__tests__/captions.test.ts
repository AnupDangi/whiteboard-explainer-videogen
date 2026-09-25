import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebVtt } from '../export/captions.js';
import type { AlignedAudio } from '../types.js';

test('captions are grouped from the aligned word clock, split at sentences, and escaped', () => {
  const audio: AlignedAudio = {
    schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: 'audio.wav', durationMs: 2400,
    sceneBoundsMs: { s1: { startMs: 0, endMs: 2400 } }, mentions: [],
    sceneWords: { s1: [
      { w: 'Signal', startMs: 100, endMs: 400 },
      { w: '<flows>', startMs: 410, endMs: 700 },
      { w: 'through', startMs: 710, endMs: 1000 },
      { w: 'a', startMs: 1010, endMs: 1100 },
      { w: 'gate.', startMs: 1110, endMs: 1400 },
      { w: 'Output', startMs: 1600, endMs: 1900 },
      { w: 'follows.', startMs: 1910, endMs: 2300 },
    ] },
  };
  const vtt = buildWebVtt(audio);
  assert.match(vtt, /^WEBVTT\n/);
  assert.match(vtt, /00:00:00\.100 --> 00:00:01\.400\nSignal &lt;flows&gt; through a gate\./);
  assert.match(vtt, /00:00:01\.600 --> 00:00:02\.300\nOutput follows\./);
});

test('captions fail closed when the aligned word clock is empty', () => {
  const audio: AlignedAudio = {
    schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: 'audio.wav', durationMs: 1000,
    sceneBoundsMs: {}, sceneWords: {}, mentions: [],
  };
  assert.throws(() => buildWebVtt(audio), /contains no words/);
});

test('captions fail closed when a word timing escapes the audio clock', () => {
  const audio: AlignedAudio = {
    schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: 'audio.wav', durationMs: 1000,
    sceneBoundsMs: {}, sceneWords: { s1: [{ w: 'late', startMs: 900, endMs: 1100 }] }, mentions: [],
  };
  assert.throws(() => buildWebVtt(audio), /invalid or out-of-order aligned word/);
});

test('captions fail closed when measured alignment assigns a zero-duration word', () => {
  const audio: AlignedAudio = {
    schemaVersion: 'claude-aligned-audio/v1', provider: 'stable-ts', wavPath: 'audio.wav', durationMs: 1000,
    sceneBoundsMs: {}, sceneWords: { s1: [{ w: 'word', startMs: 120, endMs: 120 }] }, mentions: [],
  };
  assert.throws(() => buildWebVtt(audio), /invalid or out-of-order aligned word/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPcmWav, joinPaddedScenes, parsePcmWav } from '../export/player/wavPrefix.js';

const tone = (ms: number, rate = 8000) => buildPcmWav(rate, 1, Buffer.alloc(Math.round(ms * rate / 1000) * 2, 1));

test('scene speech is padded with silence to its placement and joined in order', () => {
  const joined = parsePcmWav(joinPaddedScenes([{ wav: tone(500), placementMs: 800 }, { wav: tone(200), placementMs: 400 }]));
  assert.equal(joined.sampleRate, 8000);
  assert.equal(joined.data.length / 2, 1200 * 8, '800 ms + 400 ms of samples');
  assert.equal(joined.data[0], 1, 'speech first');
  assert.equal(joined.data[(500 * 8) * 2], 0, 'silence after the first scene speech');
  assert.equal(joined.data[(800 * 8) * 2], 1, 'second scene speech starts at its placement');
});

test('a scene longer than its placement, a format change, or non-PCM audio fails closed', () => {
  assert.throws(() => joinPaddedScenes([{ wav: tone(900), placementMs: 800 }]), /longer than its placement/);
  assert.throws(() => joinPaddedScenes([{ wav: tone(100, 8000), placementMs: 200 }, { wav: tone(100, 16000), placementMs: 200 }]), /formats differ/);
  const float = tone(100); float.writeUInt16LE(3, 20);
  assert.throws(() => parsePcmWav(float), /16-bit PCM/);
  assert.throws(() => parsePcmWav(Buffer.from('nope')), /RIFF/);
  assert.throws(() => joinPaddedScenes([]), /no scenes/);
});

test('a streamed WAV whose declared size exceeds the bytes present is read up to the real end', () => {
  const wav = tone(100);
  wav.writeUInt32LE(0xffffffff, 40);
  assert.equal(parsePcmWav(wav).data.length, 100 * 8 * 2);
});

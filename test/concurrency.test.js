import test from 'node:test';
import assert from 'node:assert/strict';
import {mapConcurrent, concurrencyLimit} from '../dist/src/semantic/harness/concurrency.js';
import {narratedSpeech, joinWav} from '../dist/src/semantic/semantic-timing.js';
import {wordsFromDuration} from '../dist/src/shared/voice-engine-client.js';

/** S6 — bounded concurrency. Beats are independent and the merge is
 *  order-preserving, so synthesis runs concurrently but the audio and the
 *  timeline must be byte-identical to the serial result. */

const wav = (dataLength, frequency = 440) => {
  const header = Buffer.alloc(44), data = Buffer.alloc(dataLength, 7);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + dataLength, 4); header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(frequency, 24); header.writeUInt32LE(frequency * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii'); header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, data]);
};

test('results keep input order however the tasks finish', async () => {
  const delays = [40, 5, 20, 1];
  const out = await mapConcurrent(delays, 4, async (ms, i) => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3], 'the fastest task must not be placed first');
});

test('the worker count is bounded and the first failure stops the work', async () => {
  let inFlight = 0, peak = 0;
  await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
  });
  assert.ok(peak <= 2, `limit must be respected, saw ${peak} in flight`);

  let started = 0;
  await assert.rejects(() => mapConcurrent([1, 2, 3, 4, 5, 6], 1, async (n) => {
    started++;
    if (n === 2) throw new Error('boom');
  }), /boom/);
  assert.equal(started, 2, 'no work is scheduled after the failure');
});

test('the limit is validated and clamped from the environment', async () => {
  assert.deepEqual(await mapConcurrent([], 3, async () => 1), []);
  await assert.rejects(() => mapConcurrent([1], 0, async () => 1), /1-8/);
  await assert.rejects(() => mapConcurrent([1], 9, async () => 1), /1-8/);
  assert.equal(concurrencyLimit({}, 'V2_TTS_CONCURRENCY'), 3);
  assert.equal(concurrencyLimit({V2_TTS_CONCURRENCY: '2'}, 'V2_TTS_CONCURRENCY'), 2);
  assert.equal(concurrencyLimit({V2_TTS_CONCURRENCY: '99'}, 'V2_TTS_CONCURRENCY'), 8);
  assert.equal(concurrencyLimit({V2_TTS_CONCURRENCY: '0'}, 'V2_TTS_CONCURRENCY'), 3);
});

test('narrated beats are synthesised concurrently but concatenated in beat order', async () => {
  const beats = [0, 1, 2, 3].map(i => ({id: `b${i}`, text: `beat ${i} words`}));
  let inFlight = 0, peak = 0;
  const calls = [];
  const speech = async (text) => {
    const index = Number(/beat (\d+)/.exec(text)[1]);
    calls.push(index);
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, (4 - index) * 6)); // reverse order completion
    inFlight--;
    const durationMs = 100 + index * 10;
    return {timing: wordsFromDuration(text, durationMs), audio: wav(40 + index), format: 'wav', provider: 'test', timingSource: 'estimated'};
  };
  const result = await narratedSpeech({text: beats.map(b => b.text).join(' '), beats}, speech, undefined, {V2_TTS_CONCURRENCY: '4'});
  assert.ok(peak > 1, 'beats must overlap, not run one at a time');
  assert.deepEqual(calls.sort((a, b) => a - b), [0, 1, 2, 3], 'every beat is synthesised');
  assert.deepEqual(result.audio, joinWav([wav(40), wav(41), wav(42), wav(43)]),
    'audio must equal the serial concatenation in beat order, not completion order');
  assert.deepEqual(result.timing.words.length > 0, true);
});

test('a single-beat narration still makes exactly one call', async () => {
  let calls = 0;
  const speech = async (text) => { calls++; return {timing: wordsFromDuration(text, 100), audio: wav(20), format: 'wav', timingSource: 'estimated'}; };
  await narratedSpeech({text: 'one', beats: [{id: 'b0', text: 'one'}]}, speech, undefined, {});
  assert.equal(calls, 1);
});

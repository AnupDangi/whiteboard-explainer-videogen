import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenKeyPool, elevenLabsKeys, pcmToWav, synthesizeWithElevenLabs, wordsFromCharacterTimes, type FetchLike } from '../audio/elevenlabs.js';
import { tokenizeWords } from '../narration/align.js';

// Offline contract tests with a scripted fetch; no provider is called.
const chars = (text: string, step = 0.1) => ({ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * step), character_end_times_seconds: [...text].map((_, i) => (i + 1) * step) });
const pcm = (ms: number) => Buffer.alloc(Math.round((24000 * 2 * ms) / 1000));
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('keys are read from ELEVENLABS_API_KEY_1..9 in order and de-duplicated', () => {
  assert.deepEqual(elevenLabsKeys({ ELEVENLABS_API_KEY_2: 'b', ELEVENLABS_API_KEY_1: 'a', ELEVENLABS_API_KEY_3: 'a' }), ['a', 'b']);
  assert.deepEqual(elevenLabsKeys({}), []);
});

test('character times become positive, ordered words that keep the narration token sequence in any script', () => {
  for (const text of ['Water moves across.', 'पानी झिल्ली के पार जाता है।']) {
    const words = wordsFromCharacterTimes(chars(text), 5000);
    assert.deepEqual(words.flatMap((w) => tokenizeWords(w.word)), tokenizeWords(text));
    words.forEach((w, i) => { assert.ok(w.endMs > w.startMs); if (i) assert.ok(w.startMs >= words[i - 1]!.endMs); assert.ok(w.endMs <= 5000); });
  }
  assert.throws(() => wordsFromCharacterTimes({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }, 1000), /empty/);
});

test('the pool uses one key at a time and moves on when a key lacks credits or is refused', async () => {
  const limits: Record<string, number> = { a: 100, b: 10_000 };
  const fetcher: FetchLike = async (_url, init) => { const key = init.headers!['xi-api-key']!; return key === 'bad' ? reply(401, {}) : reply(200, { character_count: 0, character_limit: limits[key] }); };
  const pool = new ElevenKeyPool(['bad', 'a', 'b'], fetcher);
  assert.equal(await pool.pick(50), 'a');
  pool.spent('a', 60);
  assert.equal(await pool.pick(50), 'b', 'a has 40 left, so the next key is used');
  pool.retire('b');
  await assert.rejects(pool.pick(50), /no ElevenLabs key has 50 credits/);
});

test('synthesis tries the cheapest model, falls through on an unsupported language, and returns WAV audio with the provider word clock', async () => {
  const calls: string[] = [];
  const text = 'पानी झिल्लीबाट पार हुन्छ।';
  const fetcher: FetchLike = async (url, init) => {
    if (url.endsWith('/user/subscription')) return reply(200, { character_count: 0, character_limit: 10_000 });
    const body = JSON.parse(init.body!) as { model_id: string; language_code: string };
    calls.push(`${body.model_id}:${body.language_code}`);
    if (body.model_id !== 'eleven_v3') return reply(400, { detail: { code: 'invalid_parameters', status: 'unsupported_language', message: `Model '${body.model_id}' does not support language_code '${body.language_code}'.` } });
    return reply(200, { audio_base64: pcm(2000).toString('base64'), alignment: chars(text, 0.05) });
  };
  const result = await synthesizeWithElevenLabs(text, { language: 'ne-test-fallthrough', fetcher, env: { ELEVENLABS_API_KEY_1: 'k' } });
  assert.deepEqual(calls, ['eleven_flash_v2_5:ne-test-fallthrough', 'eleven_multilingual_v2:ne-test-fallthrough', 'eleven_v3:ne-test-fallthrough']);
  assert.equal(result.model, 'eleven_v3'); assert.equal(result.aligner, 'elevenlabs-timestamps'); assert.equal(result.repairedWordIndexes.length, 0);
  assert.equal(result.durationMs, 2000); assert.equal(result.words.length, 4);
  assert.equal(pcmToWav(pcm(1000), 24000).subarray(0, 4).toString(), 'RIFF');
});

test('an out-of-credits key is retired and the next key serves the same request', async () => {
  const used: string[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const key = init.headers!['xi-api-key']!;
    if (url.endsWith('/user/subscription')) return reply(200, { character_count: 0, character_limit: 10_000 });
    used.push(key);
    return key === 'one' ? reply(401, { detail: { status: 'quota_exceeded' } }) : reply(200, { audio_base64: pcm(500).toString('base64'), alignment: chars('Hi there', 0.05) });
  };
  const r = await synthesizeWithElevenLabs('Hi there', { language: 'en-test-rotate', fetcher, env: { ELEVENLABS_API_KEY_1: 'one', ELEVENLABS_API_KEY_2: 'two' } });
  assert.deepEqual(used, ['one', 'two']); assert.equal(r.words.length, 2);
});

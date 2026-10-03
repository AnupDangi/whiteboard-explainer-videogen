import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenKeyPool, elevenLabsKeys, modelsForLanguage, normalizedCharacterClock, pcmToWav, synthesizeWithElevenLabs, wordsFromCharacterTimes, type FetchLike } from '../audio/elevenlabs.js';
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

test('credit reservations are atomic across concurrent scene requests', async () => {
  const pool = new ElevenKeyPool(['a'], async () => reply(200, { character_count: 0, character_limit: 100 }));
  const first = await pool.reserve(60);
  await assert.rejects(pool.reserve(60), /no ElevenLabs key/);
  first.cancel();
  const next = await pool.reserve(60);
  next.settle(60);
  await assert.rejects(pool.reserve(50), /no ElevenLabs key/);
});

test('capability snapshot chooses the cheapest language-compatible model and refuses unsupported pairs offline', () => {
  const snapshot = { snapshotId: 'cap-test-1', capturedAt: '2026-10-03T00:00:00Z', models: [
    { id: 'v3', creditsPerChar: 1, languages: ['ne'] },
    { id: 'flash', creditsPerChar: 0.5, languages: ['en', 'hi'] },
  ] };
  assert.deepEqual(modelsForLanguage(snapshot, 'HI-in').map((m) => m.id), ['flash']);
  assert.deepEqual(modelsForLanguage(snapshot, 'ne-NP').map((m) => m.id), ['v3']);
  assert.deepEqual(modelsForLanguage(snapshot, 'zh'), []);
});

test('a captured capability snapshot rejects unsupported routing without contacting the provider', async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return reply(500, {}); };
  await assert.rejects(synthesizeWithElevenLabs('test', {
    language: 'zh', fetcher, env: { ELEVENLABS_API_KEY_1: 'k' },
    capabilities: { snapshotId: 'captured', capturedAt: '2026-10-03T00:00:00Z', models: [{ id: 'flash', creditsPerChar: 0.5, languages: ['en'] }] },
  }), /no ElevenLabs model.*supports zh/);
  assert.equal(calls, 0);
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
  const result = await synthesizeWithElevenLabs(text, { language: 'ne-test-fallthrough', fetcher, env: { ELEVENLABS_API_KEY_1: 'k' }, capabilities: { snapshotId: 'ne-cap-1', capturedAt: '2026-10-03T00:00:00Z', models: [{ id: 'eleven_v3', creditsPerChar: 1, languages: ['ne'] }] } });
  assert.deepEqual(calls, ['eleven_v3:ne-test-fallthrough']);
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
  const r = await synthesizeWithElevenLabs('Hi there', { language: 'en-test-rotate', fetcher, env: { ELEVENLABS_API_KEY_1: 'one', ELEVENLABS_API_KEY_2: 'two' }, capabilities: { snapshotId: 'en-cap-1', capturedAt: '2026-10-03T00:00:00Z', models: [{ id: 'eleven_flash_v2_5', creditsPerChar: 0.5, languages: ['en'] }] } });
  assert.deepEqual(used, ['one', 'two']); assert.equal(r.words.length, 2);
});

test('429 is retried without retiring a valid key, and success reports provider usage', async () => {
  let calls = 0; const usage: string[] = [];
  const fetcher: FetchLike = async (url) => {
    if (url.endsWith('/user/subscription')) return reply(200, { character_count: 0, character_limit: 10_000 });
    if (++calls === 1) return reply(429, { detail: 'rate limited' });
    return reply(200, { audio_base64: pcm(1000).toString('base64'), alignment: chars('Hello there.', 0.05) });
  };
  const result = await synthesizeWithElevenLabs('Hello there.', { language: 'en', fetcher, env: { ELEVENLABS_API_KEY_1: 'a' }, capabilities: { snapshotId: 'en-cap-2', capturedAt: '2026-10-03T00:00:00Z', models: [{ id: 'eleven_flash_v2_5', creditsPerChar: 0.5, languages: ['en'] }] }, onUsage: (event) => usage.push(event.status) });
  assert.equal(calls, 2); assert.deepEqual(usage, ['succeeded']); assert.equal(result.voice, 'Xb7hH8MSUJpSbSDYk0k2');
  assert.equal(result.submittedText, 'Hello there.'); assert.equal(result.normalizedText, 'Hello there.');
});

test('malformed provider clocks are rejected instead of clamped into apparently valid words', () => {
  assert.throws(() => wordsFromCharacterTimes({ characters: ['x'], character_start_times_seconds: [0.2], character_end_times_seconds: [0.1] }, 1000), /malformed/);
  assert.throws(() => wordsFromCharacterTimes({ characters: ['x'], character_start_times_seconds: [0], character_end_times_seconds: [0] }, 1000), /zero-length/);
});

test('normalized character clocks map composed Unicode and collapsed whitespace back to timed source spans', () => {
  const raw = { characters: ['e', '\u0301', ' ', ' ', 'x'], startTimesSeconds: [0, 0.01, 0.1, 0.15, 0.2], endTimesSeconds: [0.01, 0.05, 0.13, 0.18, 0.3] };
  const mapped = normalizedCharacterClock(raw);
  assert.equal(mapped.characters.join(''), 'é x');
  assert.deepEqual(mapped.startTimesSeconds, [0, 0.1, 0.2]);
  assert.deepEqual(mapped.endTimesSeconds, [0.05, 0.18, 0.3]);
});

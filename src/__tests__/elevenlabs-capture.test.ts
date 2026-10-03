import test from 'node:test';
import assert from 'node:assert/strict';
import { captureElevenLabsCapabilities } from '../audio/elevenlabsCapture.js';
import { loadElevenLabsCapabilitySnapshot, modelsForLanguage } from '../audio/elevenlabs.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Provider responses below are synthetic contract data in the documented /v1/models and /v1/voices shapes, not a live capture.
const models = [
  { model_id: 'eleven_flash_v2_5', can_do_text_to_speech: true, token_cost_factor: 0.5, languages: [{ language_id: 'en', name: 'English' }, { language_id: 'hi', name: 'Hindi' }] },
  { model_id: 'eleven_v3', can_do_text_to_speech: true, token_cost_factor: 1, languages: [{ language_id: 'en' }, { language_id: 'ne' }] },
  { model_id: 'eleven_english_sts_v2', can_do_text_to_speech: false, token_cost_factor: 1, languages: [{ language_id: 'en' }] },
  { model_id: 'eleven_free_model', can_do_text_to_speech: true, token_cost_factor: 0, languages: [{ language_id: 'en' }] },
];
const voices = { voices: [{ voice_id: 'v1', verified_languages: [{ language: 'en' }, { language: 'hi' }] }, { voice_id: 'v2', labels: { language: 'ne' } }] };
const fetcher = (calls: string[]) => async (url: string, init: { headers?: Record<string, string> }) => {
  calls.push(`${url}|${init.headers?.['xi-api-key']}`);
  const body = url.endsWith('/models') ? models : url.includes('/voices') ? voices : undefined;
  return { ok: body !== undefined, status: body ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body ?? {}) };
};

test('a capability snapshot is built from the provider model and voice lists: TTS models only, positive rates, deterministic id', async () => {
  const calls: string[] = [];
  const snapshot = await captureElevenLabsCapabilities({ apiKey: 'key-1', fetcher: fetcher(calls), includeVoices: true, now: () => new Date('2026-10-03T00:00:00Z') });
  assert.deepEqual(calls.map((c) => c.split('|')[0]), ['https://api.elevenlabs.io/v1/models', 'https://api.elevenlabs.io/v1/voices']);
  assert.deepEqual(snapshot.models.map((m) => m.id), ['eleven_flash_v2_5', 'eleven_v3'], 'speech-to-speech and zero-rate models are not speech models');
  assert.deepEqual(snapshot.models[0], { id: 'eleven_flash_v2_5', creditsPerChar: 0.5, languages: ['en', 'hi'] });
  assert.deepEqual(snapshot.voices, [{ id: 'v1', languages: ['en', 'hi'] }, { id: 'v2', languages: ['ne'] }]);
  assert.equal(snapshot.capturedAt, '2026-10-03T00:00:00.000Z');
  const again = await captureElevenLabsCapabilities({ apiKey: 'other-key', fetcher: fetcher([]), includeVoices: true, now: () => new Date('2026-10-03T00:00:00Z') });
  assert.equal(again.snapshotId, snapshot.snapshotId, 'the id commits to content and time, never to the key');
  assert.match(snapshot.snapshotId, /^elevenlabs-[0-9a-f]{16}$/);
});

test('the captured snapshot loads through the same validator synthesis uses, and drives model choice per language', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'el-cap-'));
  try {
    const snapshot = await captureElevenLabsCapabilities({ apiKey: 'k', fetcher: fetcher([]), now: () => new Date('2026-10-03T00:00:00Z') });
    const file = path.join(dir, 'caps.json');
    await writeFile(file, JSON.stringify(snapshot));
    const loaded = loadElevenLabsCapabilitySnapshot({ ELEVENLABS_CAPABILITIES_FILE: file })!;
    assert.deepEqual(modelsForLanguage(loaded, 'hi').map((m) => m.id), ['eleven_flash_v2_5']);
    assert.deepEqual(modelsForLanguage(loaded, 'ne').map((m) => m.id), ['eleven_v3']);
    assert.deepEqual(modelsForLanguage(loaded, 'fr'), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('capture fails closed on provider errors and empty model lists instead of writing a partial snapshot', async () => {
  const failing = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized' });
  await assert.rejects(captureElevenLabsCapabilities({ apiKey: 'bad', fetcher: failing }), /401/);
  const empty = async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith('/models') ? [] : { voices: [] }), text: async () => '' });
  await assert.rejects(captureElevenLabsCapabilities({ apiKey: 'k', fetcher: empty }), /no speech models/i);
});

test('voices are pinned only on request, so a library voice outside the account list is not rejected', async () => {
  const calls: string[] = [];
  const snapshot = await captureElevenLabsCapabilities({ apiKey: 'k', fetcher: fetcher(calls), now: () => new Date('2026-10-03T00:00:00Z') });
  assert.deepEqual(calls.map((c) => c.split('|')[0]), ['https://api.elevenlabs.io/v1/models']);
  assert.equal(snapshot.voices, undefined);
});

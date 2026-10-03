import { createHash } from 'node:crypto';
import type { ElevenLabsCapabilitySnapshot, FetchLike } from './elevenlabs.js';

const API = 'https://api.elevenlabs.io/v1';

interface ProviderModel { model_id?: string; can_do_text_to_speech?: boolean; token_cost_factor?: number; languages?: Array<{ language_id?: string }> }
interface ProviderVoice { voice_id?: string; verified_languages?: Array<{ language?: string }>; labels?: Record<string, string> }

/**
 * Capture what the provider offers right now (models with their credit rate and languages, plus the voices and the languages they
 * speak) as the snapshot synthesis requires. Read-only GETs; the snapshot id commits to the content and capture time, never to the key.
 */
export async function captureElevenLabsCapabilities(options: { apiKey: string; fetcher: FetchLike; now?: () => Date; /** Pin a voice allowlist too. Off by default: an account may legitimately use a library voice that its own voice list does not show. */ includeVoices?: boolean }): Promise<ElevenLabsCapabilitySnapshot> {
  const get = async (route: string): Promise<unknown> => {
    const response = await options.fetcher(`${API}${route}`, { headers: { 'xi-api-key': options.apiKey } });
    if (!response.ok) throw new Error(`ElevenLabs ${route} failed with ${response.status}`);
    return response.json();
  };
  const rawModels = await get('/models') as ProviderModel[];
  const rawVoices = options.includeVoices ? (await get('/voices') as { voices?: ProviderVoice[] }).voices ?? [] : [];
  const models = (Array.isArray(rawModels) ? rawModels : []).flatMap((model) => {
    const languages = [...new Set((model.languages ?? []).flatMap((language) => language.language_id ? [language.language_id] : []))].sort();
    if (!model.model_id || model.can_do_text_to_speech !== true || !(typeof model.token_cost_factor === 'number' && model.token_cost_factor > 0) || !languages.length) return [];
    return [{ id: model.model_id, creditsPerChar: model.token_cost_factor, languages }];
  }).sort((a, b) => a.creditsPerChar - b.creditsPerChar || a.id.localeCompare(b.id));
  if (!models.length) throw new Error('ElevenLabs reported no speech models');
  const voices = rawVoices.flatMap((voice) => {
    const languages = [...new Set([...(voice.verified_languages ?? []).flatMap((entry) => entry.language ? [entry.language] : []), ...(voice.labels?.language ? [voice.labels.language] : [])])].sort();
    return voice.voice_id && languages.length ? [{ id: voice.voice_id, languages }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
  const capturedAt = (options.now?.() ?? new Date()).toISOString();
  const snapshotId = `elevenlabs-${createHash('sha256').update(JSON.stringify({ capturedAt, models, voices })).digest('hex').slice(0, 16)}`;
  return { snapshotId, capturedAt, models, ...(voices.length ? { voices } : {}) };
}

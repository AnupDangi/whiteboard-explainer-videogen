import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DEFAULT_OUT_DIR} from './paths.js';
import {synthesizePiper} from './providers/piper.js';
import {synthesizeSupertonic} from './providers/supertonic.js';
import {route} from './router.js';
import type {SynthesizeInput, SynthesizeResult} from './types.js';

export {route} from './router.js';
export * from './languages.js';
export * from './voices.js';
export type * from './types.js';

/**
 * text + language -> pick Supertonic or Piper -> local CPU TTS.
 * Providers are isolated; this is the only public entry point.
 */
export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  const {text, language, voice, provider = 'auto'} = input;
  if (!text || !text.trim()) throw new Error('text is required');

  const decision = route({language, provider});
  await mkdir(DEFAULT_OUT_DIR, {recursive: true});

  const stamp = Date.now().toString(36);
  const digest = createHash('sha1').update(text).digest('hex').slice(0, 8);
  const audioPath = resolve(DEFAULT_OUT_DIR, `${decision.provider}-${decision.language}-${stamp}-${digest}.wav`);

  const result = decision.provider === 'supertonic'
    ? await synthesizeSupertonic({text, language: decision.language, voice, audioPath})
    : await synthesizePiper({text, language: decision.language, voice, audioPath});

  return {
    audioPath: result.audioPath,
    provider: decision.provider,
    language: decision.language,
    voice: result.voice,
    generationMs: Math.round(result.generationMs),
    audioDurationMs: Math.round(result.audioDurationMs),
    rtf: result.audioDurationMs > 0 ? Number((result.generationMs / result.audioDurationMs).toFixed(3)) : 0,
  };
}

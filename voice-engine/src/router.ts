import {isPiperLanguage, isSupertonicLanguage, normalizeLanguage} from './languages.js';
import type {ProviderSelector, RouteDecision} from './types.js';

/** Nepal is always Piper, even though Supertonic claims a `ne`-adjacent space. */
const PIPER_LOCKED = new Set(['ne']);

export function route({language, provider = 'auto'}: {language: string; provider?: ProviderSelector}): RouteDecision {
  const code = normalizeLanguage(language);

  if (provider === 'supertonic') {
    if (!isSupertonicLanguage(code)) throw new Error(`Supertonic does not support language ${code}`);
    return {provider: 'supertonic', language: code};
  }
  if (provider === 'piper') {
    if (!isPiperLanguage(code)) throw new Error(`Piper has no voice registered for language ${code}`);
    return {provider: 'piper', language: code};
  }

  if (PIPER_LOCKED.has(code)) return {provider: 'piper', language: code};
  if (isSupertonicLanguage(code)) return {provider: 'supertonic', language: code};
  if (isPiperLanguage(code)) return {provider: 'piper', language: code};

  throw new Error(`No local TTS provider supports language ${code}`);
}

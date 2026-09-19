import {PIPER_DEFAULT_VOICES, normalizeLanguage} from './languages.js';

/** Supertonic built-in voices: 5 male + 5 female fixed styles. */
export const SUPERTONIC_VOICES = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'F1', 'F2', 'F3', 'F4', 'F5',
] as const;

export const DEFAULT_SUPERTONIC_VOICE = 'F3';

export function resolveSupertonicVoice(voice?: string): string {
  if (!voice) return DEFAULT_SUPERTONIC_VOICE;
  const normalized = voice.toUpperCase();
  if (!(SUPERTONIC_VOICES as readonly string[]).includes(normalized)) {
    throw new Error(`Unknown Supertonic voice ${voice}; use one of ${SUPERTONIC_VOICES.join(', ')}`);
  }
  return normalized;
}

export function defaultPiperVoice(language: string): string {
  const code = normalizeLanguage(language);
  const voice = PIPER_DEFAULT_VOICES[code];
  if (!voice) throw new Error(`No Piper voice registered for language ${code}`);
  return voice;
}

export function resolvePiperVoice(language: string, voice?: string): string {
  return voice ?? defaultPiperVoice(language);
}

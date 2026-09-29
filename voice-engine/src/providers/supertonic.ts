import {resolve} from 'node:path';
import {PYTHON_DIR} from '../paths.js';
import {runPythonBridge} from '../python-bridge.js';
import {resolveSupertonicVoice} from '../voices.js';
import type {ProviderRequest, ProviderResult} from '../types.js';

const SCRIPT = resolve(PYTHON_DIR, 'supertonic_tts.py');

export function synthesizeSupertonic(request: ProviderRequest): Promise<ProviderResult> {
  const voice = resolveSupertonicVoice(request.voice);
  return runPythonBridge(SCRIPT, {
    text: request.text,
    language: request.language,
    voice,
    audioPath: request.audioPath,
  }).then(result => ({
    audioPath: result.audioPath,
    voice,
    generationMs: result.generationMs,
    audioDurationMs: result.audioDurationMs,
  }));
}

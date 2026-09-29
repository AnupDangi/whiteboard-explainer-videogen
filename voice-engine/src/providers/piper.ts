import {resolve} from 'node:path';
import {PIPER_MODELS_DIR, PYTHON_DIR} from '../paths.js';
import {runPythonBridge} from '../python-bridge.js';
import {resolvePiperVoice} from '../voices.js';
import type {ProviderRequest, ProviderResult} from '../types.js';

const SCRIPT = resolve(PYTHON_DIR, 'piper_tts.py');

export function synthesizePiper(request: ProviderRequest): Promise<ProviderResult> {
  const voice = resolvePiperVoice(request.language, request.voice);
  return runPythonBridge(SCRIPT, {
    text: request.text,
    language: request.language,
    voice,
    voicePath: resolve(PIPER_MODELS_DIR, `${voice}.onnx`),
    audioPath: request.audioPath,
  }).then(result => ({
    audioPath: result.audioPath,
    voice,
    generationMs: result.generationMs,
    audioDurationMs: result.audioDurationMs,
  }));
}

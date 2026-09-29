import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** Package root works from both `src/` and compiled `dist/` (both are one level deep). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const VENV_PYTHON = resolve(PACKAGE_ROOT, '.venv/bin/python');
export const PYTHON_DIR = resolve(PACKAGE_ROOT, 'src/python');
export const PIPER_MODELS_DIR = resolve(PACKAGE_ROOT, 'models/piper');
export const DEFAULT_OUT_DIR = process.env.VOICE_ENGINE_OUT
  ? resolve(process.env.VOICE_ENGINE_OUT)
  : resolve(PACKAGE_ROOT, 'out');

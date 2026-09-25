import { readFile } from 'node:fs/promises';

/**
 * Explicit-load-at-runtime source for OpenRouter credentials, per the live-run
 * task's instruction: the key lives in the sibling `explain-canvas-lab`
 * checkout's `.env` and must NEVER be copied into this worktree or committed.
 * This module only reads that file into `process.env` at process start; it
 * never writes it anywhere.
 */
const SIBLING_ENV_PATH = '/Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/explain-canvas-lab/.env';

export interface OpenRouterEnv {
  apiKey: string;
  directorModel: string;
  /** S6 Scene Planner: strongest affordable model (01 §1). OPENROUTER_SCENE_MODEL overrides. */
  sceneModel: string;
  /** S2-S4 mid-tier model. OPENROUTER_CONTENT_MODEL overrides. */
  contentModel: string;
}

/** Default S6 model: strongest Claude model that fits the $0.10 per 1-minute clip ceiling (Opus is ~2x the price). */
export const DEFAULT_SCENE_MODEL = 'anthropic/claude-sonnet-5';

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) out[key] = value;
  }
  return out;
}

/** Reads OPENROUTER_API_KEY / OPENROUTER_DIRECTOR_MODEL from the sibling .env at runtime, without copying the file or mutating process.env by default. */
export async function loadOpenRouterEnv(envPath: string = SIBLING_ENV_PATH): Promise<OpenRouterEnv> {
  let raw: string;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read OpenRouter credentials from ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = parseEnvFile(raw);
  const apiKey = process.env.OPENROUTER_API_KEY || parsed.OPENROUTER_API_KEY;
  const directorModel = process.env.OPENROUTER_DIRECTOR_MODEL || parsed.OPENROUTER_DIRECTOR_MODEL;
  if (!apiKey) throw new Error(`OPENROUTER_API_KEY not found in ${envPath}`);
  if (!directorModel) throw new Error(`OPENROUTER_DIRECTOR_MODEL not found in ${envPath}`);
  const sceneModel = process.env.OPENROUTER_SCENE_MODEL || parsed.OPENROUTER_SCENE_MODEL || DEFAULT_SCENE_MODEL;
  const contentModel = process.env.OPENROUTER_CONTENT_MODEL || parsed.OPENROUTER_CONTENT_MODEL || directorModel;
  return { apiKey, directorModel, sceneModel, contentModel };
}

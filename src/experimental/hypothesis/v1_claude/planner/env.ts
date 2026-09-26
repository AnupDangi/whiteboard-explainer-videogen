import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Runtime source for OpenRouter credentials and model routing. Keys and model
 * ids live only in `.env` (never in code, never committed). The file is read
 * from `HYPOTHESIS_ENV_FILE` when set, otherwise from `.env` in the working
 * directory. Process environment variables override file values.
 *
 * Every model id is configuration. There is no model default in code: a
 * missing stage model is a startup error, so a run can never silently use a
 * model nobody chose.
 */
export const ENV_FILE_VARIABLE = 'HYPOTHESIS_ENV_FILE';

export interface OpenRouterEnv {
  apiKey: string;
  directorModel: string;
  /** S6 board planner. OPENROUTER_SCENE_MODEL. */
  sceneModel: string;
  /** S2-S4 content stages. OPENROUTER_CONTENT_MODEL, else OPENROUTER_DIRECTOR_MODEL. */
  contentModel: string;
  /** Vision judge. OPENROUTER_VISION_MODEL; undefined when not configured. */
  visionModel?: string;
  /** Explicit provider settings needed by the Python RAG sidecar. */
  ragSidecarEnv: RagSidecarEnv;
}

export type RagSidecarEnv = Partial<Record<
  | 'OPENROUTER_API_KEY'
  | 'OPENROUTER_BASE_URL'
  | 'OPENROUTER_MODEL'
  | 'OPENROUTER_VISION_MODEL'
  | 'RAG_LLM_MODEL'
  | 'RAG_VISION_MODEL'
  | 'EMBEDDINGS_API_KEY'
  | 'EMBEDDINGS_BASE_URL'
  | 'EMBEDDINGS_API_URL'
  | 'EMBEDDINGS_MODEL'
  | 'EMBEDDINGS_DIM',
  string
>>;

export function defaultEnvPath(): string {
  return process.env[ENV_FILE_VARIABLE] || resolve(process.cwd(), '.env');
}

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

/** Reads credentials and model ids from the env file plus process env, without copying the file or mutating process.env. */
export async function loadOpenRouterEnv(envPath: string = defaultEnvPath(), environment: NodeJS.ProcessEnv = process.env): Promise<OpenRouterEnv> {
  let raw: string;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read OpenRouter configuration from ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = parseEnvFile(raw);
  const value = (key: string): string | undefined => environment[key] || parsed[key] || undefined;
  const required = (key: string, fallbackKey?: string): string => {
    const found = value(key) ?? (fallbackKey ? value(fallbackKey) : undefined);
    if (!found) throw new Error(`${key}${fallbackKey ? ` (or ${fallbackKey})` : ''} is not set in ${envPath} or the process environment`);
    return found;
  };
  const apiKey = required('OPENROUTER_API_KEY');
  const directorModel = required('OPENROUTER_DIRECTOR_MODEL');
  const sceneModel = required('OPENROUTER_SCENE_MODEL');
  const contentModel = required('OPENROUTER_CONTENT_MODEL', 'OPENROUTER_DIRECTOR_MODEL');
  const visionModel = value('OPENROUTER_VISION_MODEL');
  const ragSidecarKeys = [
    'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_MODEL', 'OPENROUTER_VISION_MODEL',
    'RAG_LLM_MODEL', 'RAG_VISION_MODEL', 'EMBEDDINGS_API_KEY', 'EMBEDDINGS_BASE_URL',
    'EMBEDDINGS_API_URL', 'EMBEDDINGS_MODEL', 'EMBEDDINGS_DIM',
  ] as const;
  const ragSidecarEnv: RagSidecarEnv = Object.fromEntries(
    ragSidecarKeys.flatMap((key) => {
      const configured = value(key);
      return configured ? [[key, configured]] : [];
    }),
  );
  return { apiKey, directorModel, sceneModel, contentModel, ...(visionModel ? { visionModel } : {}), ragSidecarEnv };
}

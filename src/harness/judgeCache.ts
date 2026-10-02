import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { stableJson } from '../shared/artifacts.js';

const CACHE_SCHEMA = 'vision-judge-cache/v1';

export function judgeCacheKey(input: {
  model: string;
  promptVersion: string;
  schemaId: string;
  prompt: string;
  images: Buffer[];
}): string {
  const imageSha256 = input.images.map((image) => createHash('sha256').update(image).digest('hex'));
  return createHash('sha256').update(stableJson({
    schemaVersion: CACHE_SCHEMA,
    model: input.model,
    promptVersion: input.promptVersion,
    schemaId: input.schemaId,
    prompt: input.prompt,
    imageSha256,
  })).digest('hex');
}

export async function readJudgeCache<T>(cacheDir: string | undefined, key: string, schema: z.ZodType<T>): Promise<T | undefined> {
  if (!cacheDir) return undefined;
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const envelope = JSON.parse(await readFile(file, 'utf8')) as { schemaVersion?: string; key?: string; value?: unknown };
    if (envelope.schemaVersion !== CACHE_SCHEMA || envelope.key !== key) return undefined;
    const parsed = schema.safeParse(envelope.value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function writeJudgeCache<T>(cacheDir: string | undefined, key: string, value: T): Promise<void> {
  if (!cacheDir) return;
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${key}.json`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: CACHE_SCHEMA, key, value }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

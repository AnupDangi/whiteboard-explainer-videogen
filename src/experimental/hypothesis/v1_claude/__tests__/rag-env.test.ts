import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOpenRouterEnv } from '../planner/env.js';
import { buildRagSidecarProcessEnv } from '../plan/ragSidecar.js';

test('OpenRouter .env credentials and RAG settings reach the Python child without mutating process.env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hyp-rag-env-'));
  const envPath = join(root, '.env');
  await writeFile(envPath, [
    'OPENROUTER_API_KEY=file-secret-test-value',
    'OPENROUTER_DIRECTOR_MODEL=provider/director-test',
    'OPENROUTER_SCENE_MODEL=provider/scene-test',
    'OPENROUTER_CONTENT_MODEL=provider/content-test',
    'OPENROUTER_BASE_URL=https://router.example/v1',
    'OPENROUTER_MODEL=provider/rag-test',
    'RAG_LLM_MODEL=provider/rag-llm-test',
    'EMBEDDINGS_MODEL=openai/test-embedding',
  ].join('\n'));

  const parentEnv: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/tmp/test-home',
    OPENROUTER_API_KEY: 'process-secret-test-value',
    UNRELATED_SECRET: 'must-not-leak',
  };
  const before = { ...parentEnv };
  try {
    const config = await loadOpenRouterEnv(envPath, parentEnv);
    assert.equal(config.apiKey, 'process-secret-test-value', 'process environment overrides .env');
    assert.deepEqual(parentEnv, before, 'loading config does not mutate the parent environment');

    const childEnv = buildRagSidecarProcessEnv(parentEnv, config.ragSidecarEnv);
    assert.equal(childEnv.OPENROUTER_API_KEY, 'process-secret-test-value');
    assert.equal(childEnv.OPENROUTER_BASE_URL, 'https://router.example/v1');
    assert.equal(childEnv.OPENROUTER_MODEL, 'provider/rag-test');
    assert.equal(childEnv.RAG_LLM_MODEL, 'provider/rag-llm-test');
    assert.equal(childEnv.EMBEDDINGS_MODEL, 'openai/test-embedding');
    assert.equal(childEnv.PATH, '/usr/bin');
    assert.equal(childEnv.UNRELATED_SECRET, undefined, 'unrelated parent secrets are not inherited');
    assert.equal(childEnv.EMBEDDINGS_API_KEY, undefined, 'unset optional credentials remain unset');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

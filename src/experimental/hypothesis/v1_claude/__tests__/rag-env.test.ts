import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOpenRouterEnv } from '../planner/env.js';
import { buildRagSidecarProcessEnv, indexSourceBundleWithRag, RAG_MIN_WORDS, ragWorthwhile } from '../plan/ragSidecar.js';
import { buildSourceBundle } from '../plan/sourceBundle.js';
import { sourceDocFromText } from '../plan/sourceDoc.js';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';

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

test('short single-document text sources skip RAG; large, multi-doc or figure sources use it', () => {
  assert.equal(RAG_MIN_WORDS, 6000);
  const small = sourceDocFromText(`# Notes\n\n${'word '.repeat(250)}`, 'markdown');
  const smallBundle = buildSourceBundle([small], 'notes').sourceBundle;
  assert.equal(ragWorthwhile(small, smallBundle).use, false);

  const large = sourceDocFromText(`# Notes\n\n${'word '.repeat(RAG_MIN_WORDS + 1)}`, 'markdown');
  const largeBundle = buildSourceBundle([large], 'notes').sourceBundle;
  assert.equal(ragWorthwhile(large, largeBundle).use, true);

  const first = sourceDocFromText('# First\n\nSome text here.', 'markdown');
  const second = sourceDocFromText('# Second\n\nOther text here.', 'markdown');
  const multi = buildSourceBundle([first, second], 'text');
  assert.equal(ragWorthwhile(multi.sourceDoc, multi.sourceBundle).use, true);

  const figDoc = sourceDocFromText('# Notes\n\nShort text.', 'markdown');
  const figBundle = buildSourceBundle([figDoc], 'notes').sourceBundle;
  figBundle.figures.push({ sourceId: figDoc.sourceId, sha256: 'b'.repeat(64), mediaType: 'image/png', assetPath: '/tmp/fig.png', derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
  assert.equal(ragWorthwhile(figDoc, figBundle).use, true);

  const tableDoc = sourceDocFromText('## Data\n\n| x | y |\n|---|---|\n| 1 | 2 |', 'markdown');
  const tableBundle = buildSourceBundle([tableDoc], 'data').sourceBundle;
  assert.equal(ragWorthwhile(tableDoc, tableBundle).use, true);

  const boundary = sourceDocFromText(`# Notes\n\n${'word '.repeat(RAG_MIN_WORDS - 10)}`, 'markdown');
  const boundaryBundle = buildSourceBundle([boundary], 'notes').sourceBundle;
  assert.equal(ragWorthwhile(boundary, boundaryBundle).use, false);
});

test('small sources skip deep RAG indexing truthfully without spending budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hyp-rag-skip-'));
  const repoRoot = join(root, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(join(repoRoot, 'rag-engine', '.venv', 'bin'), { recursive: true });
  await writeFile(join(repoRoot, 'rag-engine', '.venv', 'bin', 'python'), '');
  await writeFile(join(repoRoot, 'rag-engine', 'service.py'), '');
  const priorEngine = process.env.RAG_ENGINE;
  const priorRoot = process.env.HYPOTHESIS_REPO_ROOT;
  process.env.RAG_ENGINE = 'on';
  process.env.HYPOTHESIS_REPO_ROOT = repoRoot;
  try {
    const doc = sourceDocFromText('# Optics\n\nLight bends when it enters glass.', 'markdown');
    const { sourceDoc, sourceBundle } = buildSourceBundle([doc], 'light bends');
    const hitsBefore = sourceBundle.evidenceHits.length;
    const outcome = await indexSourceBundleWithRag({ sourceDoc, sourceBundle, query: 'light bends', workingDir: join(root, 'work'), ledger: new PersistentBudgetLedger(join(root, 'ledger.json'), 0.1), remainingBudgetUsd: 0.1, providerEnv: {} });
    assert.equal(outcome.status, 'skipped');
    assert.equal(outcome.indexed, false);
    assert.equal(outcome.estimatedCostUsd, 0);
    assert.equal(outcome.cacheHit, false);
    assert.ok(outcome.reason?.length);
    assert.equal(sourceBundle.retrievalMode, 'local-text');
    assert.equal(sourceBundle.evidenceHits.length, hitsBefore);
    assert.equal((await new PersistentBudgetLedger(join(root, 'ledger.json'), 0.1).snapshot()).spentUsd, 0);
  } finally {
    if (priorEngine === undefined) delete process.env.RAG_ENGINE;
    else process.env.RAG_ENGINE = priorEngine;
    if (priorRoot === undefined) delete process.env.HYPOTHESIS_REPO_ROOT;
    else process.env.HYPOTHESIS_REPO_ROOT = priorRoot;
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function oneManifest(root: string, id: string): Promise<Record<string, unknown>> {
  const runsRoot = path.join(root, 'runs', id, 'runs');
  const dirs = await readdir(runsRoot);
  assert.equal(dirs.length, 1);
  return JSON.parse(await readFile(path.join(runsRoot, dirs[0]!, 'run-manifest.json'), 'utf8')) as Record<string, unknown>;
}

test('lesson CLI accounts for a frozen cold trial rejected before source intake', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lesson-attempt-'));
  try {
    const envPath = path.join(root, 'test.env');
    await writeFile(envPath, 'OPENROUTER_API_KEY=test-only\nOPENROUTER_CONTENT_MODEL=test-content\nOPENROUTER_SCENE_MODEL=test-scene\n');
    const result = spawnSync(process.execPath, [
      path.resolve('dist/src/run/lessonCli.js'),
      '--source=bench/sources/osmosis.md', '--id=osmosis', '--duration=60', '--cache=cold',
      '--benchmark-attempt=osmosis-trial-1', '--instruction=incorrect', `--out=${path.join(root, 'runs')}`,
    ], { cwd: process.cwd(), env: { ...process.env, HYPOTHESIS_ENV_FILE: envPath }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const manifest = await oneManifest(root, 'osmosis');
    assert.equal(manifest.status, 'failed');
    assert.equal((manifest.benchmark as { attemptId: string }).attemptId, 'osmosis-trial-1');
    assert.equal((manifest.options as { cache: string }).cache, 'cold');
    assert.equal((manifest.failure as { stage: string }).stage, 'cli-validation');
    assert.ok((manifest.artifactSha256 as Record<string, string>)['evaluation-bundle.json']);
    assert.equal((manifest.artifactSha256 as Record<string, string>)['run-manifest.json'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lesson CLI keeps an S1 intake failure with the input path and exact error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lesson-attempt-'));
  try {
    const envPath = path.join(root, 'test.env');
    await writeFile(envPath, 'OPENROUTER_API_KEY=test-only\nOPENROUTER_CONTENT_MODEL=test-content\nOPENROUTER_SCENE_MODEL=test-scene\n');
    const missing = path.join(root, 'missing.md');
    const result = spawnSync(process.execPath, [
      path.resolve('dist/src/run/lessonCli.js'),
      `--source=${missing}`, '--id=missing', `--out=${path.join(root, 'runs')}`,
    ], { cwd: process.cwd(), env: { ...process.env, HYPOTHESIS_ENV_FILE: envPath }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const manifest = await oneManifest(root, 'missing');
    assert.equal(manifest.status, 'failed');
    assert.deepEqual((manifest.stages as { inputSourcePaths: string[] }).inputSourcePaths, [missing]);
    assert.equal((manifest.failure as { stage: string }).stage, 'S1-source-intake');
    assert.match((manifest.failure as { message: string }).message, /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lesson CLI derives a frozen trial request and records it when provider setup fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lesson-attempt-'));
  try {
    const result = spawnSync(process.execPath, [
      path.resolve('dist/src/run/lessonCli.js'),
      '--benchmark-attempt=osmosis-trial-2', `--out=${path.join(root, 'runs')}`,
    ], { cwd: process.cwd(), env: { ...process.env, HYPOTHESIS_ENV_FILE: path.join(root, 'absent.env') }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const manifest = await oneManifest(root, 'osmosis');
    assert.equal((manifest.benchmark as { attemptId: string }).attemptId, 'osmosis-trial-2');
    assert.deepEqual((manifest.stages as { inputSourcePaths: string[] }).inputSourcePaths, [path.resolve('bench/sources/osmosis.md')]);
    assert.equal((manifest.options as { cache: string }).cache, 'cold');
    assert.equal((manifest.failure as { stage: string }).stage, 'cli-setup');
    assert.match((manifest.failure as { message: string }).message, /Could not read OpenRouter configuration/);
    assert.equal((manifest.stages as { settingsHash?: string }).settingsHash, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDevelopmentAttempt } from '../harness/developmentBenchmark.js';

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

test('development resolver returns only the selected frozen trial after verifying all source bytes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dev-attempt-'));
  try {
    const manifestPath = path.join(process.cwd(), 'bench/manifests/teaching-compiler-v1-dev-set.v1.json');
    const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      schemaVersion: string; setId: string; targetDurationSec: number; instruction: string;
      topics: Array<{ topicId: string; sourcePath: string; sourceSha256: string }>;
      plannedAttempts: Array<{ attemptId: string; topicId: string; trial: number; cache: 'cold' }>;
    };
    const topics = [];
    for (const topic of sourceManifest.topics) {
      const relative = `sources/${topic.topicId}.md`;
      await mkdir(path.dirname(path.join(temp, relative)), { recursive: true });
      const sourceBytes = await readFile(path.join(process.cwd(), topic.sourcePath));
      await copyFile(path.join(process.cwd(), topic.sourcePath), path.join(temp, relative));
      topics.push({ ...topic, sourcePath: relative, sourceSha256: sha256(sourceBytes) });
    }
    const manifest = { ...sourceManifest, topics };
    const manifestDir = path.join(temp, 'bench/manifests');
    await mkdir(manifestDir, { recursive: true });
    const localManifest = path.join(manifestDir, 'teaching-compiler-v1-dev-set.v1.json');
    await writeFile(localManifest, JSON.stringify(manifest));

    const expected = manifest.plannedAttempts.find(({ attemptId }) => attemptId === 'osmosis-trial-2')!;
    const attempt = resolveDevelopmentAttempt(temp, expected.attemptId);
    assert.equal(attempt.attemptId, expected.attemptId);
    assert.equal(attempt.topicId, expected.topicId);
    assert.equal(attempt.trial, expected.trial);
    assert.equal(attempt.targetDurationSec, 60);
    assert.equal(attempt.instructionSha256, sha256(manifest.instruction));
    assert.equal(attempt.sourceSha256, topics[0]!.sourceSha256);

    assert.throws(() => resolveDevelopmentAttempt(temp, 'not-a-planned-trial'), /unknown development attempt/);
    const duplicateTrial = { ...manifest, plannedAttempts: manifest.plannedAttempts.map((planned, index) =>
      index === 1 ? { ...planned, trial: 1 } : planned) };
    await writeFile(localManifest, JSON.stringify(duplicateTrial));
    assert.throws(() => resolveDevelopmentAttempt(temp, expected.attemptId), /duplicate planned trial/);
    await writeFile(localManifest, JSON.stringify(manifest));
    await writeFile(path.join(temp, topics[0]!.sourcePath), 'mutated source');
    assert.throws(() => resolveDevelopmentAttempt(temp, expected.attemptId), /source drift/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

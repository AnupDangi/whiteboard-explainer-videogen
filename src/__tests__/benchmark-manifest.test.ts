import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

interface DevelopmentSet {
  schemaVersion: string;
  setId: string;
  targetDurationSec: number;
  instruction: string;
  topics: Array<{ topicId: string; sourcePath: string; sourceSha256: string }>;
  plannedAttempts: Array<{ attemptId: string; topicId: string; trial: number; cache: string }>;
}

test('frozen development set pins the five sources and all 15 cold trials', () => {
  const root = process.cwd();
  const manifestPath = path.join(root, 'bench/manifests/teaching-compiler-v1-dev-set.v1.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DevelopmentSet;
  assert.equal(manifest.schemaVersion, 'teaching-compiler-v1-development-set/v1');
  assert.equal(manifest.setId, 'teaching-compiler-v1-dev-set-v1');
  assert.equal(manifest.targetDurationSec, 60);
  assert.ok(manifest.instruction.trim());

  const expectedTopics = ['osmosis', 'thermostat-feedback', 'vaccination', 'drug-half-life', 'spaced-repetition'];
  assert.deepEqual(manifest.topics.map(({ topicId }) => topicId), expectedTopics);
  for (const topic of manifest.topics) {
    const source = readFileSync(path.join(root, topic.sourcePath));
    assert.equal(createHash('sha256').update(source).digest('hex'), topic.sourceSha256, `${topic.topicId} source drift`);
  }

  assert.equal(manifest.plannedAttempts.length, 15);
  for (const topicId of expectedTopics) {
    const trials = manifest.plannedAttempts.filter((attempt) => attempt.topicId === topicId);
    assert.deepEqual(trials.map(({ trial }) => trial), [1, 2, 3]);
    assert.ok(trials.every(({ cache }) => cache === 'cold'));
  }
  assert.equal(new Set(manifest.plannedAttempts.map(({ attemptId }) => attemptId)).size, 15);
});

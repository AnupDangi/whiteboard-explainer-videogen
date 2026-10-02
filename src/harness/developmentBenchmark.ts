import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const DEVELOPMENT_SET_RELATIVE_PATH = 'bench/manifests/teaching-compiler-v1-dev-set.v1.json';

interface FrozenDevelopmentSet {
  schemaVersion: 'teaching-compiler-v1-development-set/v1';
  setId: string;
  targetDurationSec: number;
  instruction: string;
  topics: Array<{ topicId: string; sourcePath: string; sourceSha256: string }>;
  plannedAttempts: Array<{ attemptId: string; topicId: string; trial: number; cache: 'cold' }>;
}

export interface DevelopmentAttempt {
  setId: string;
  attemptId: string;
  topicId: string;
  trial: number;
  sourcePath: string;
  sourceSha256: string;
  instruction: string;
  instructionSha256: string;
  targetDurationSec: number;
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Resolve one preallocated trial only after revalidating every frozen source byte. */
export function resolveDevelopmentAttempt(projectRoot: string, attemptId: string): DevelopmentAttempt {
  const root = realpathSync(projectRoot);
  const manifestPath = path.join(root, DEVELOPMENT_SET_RELATIVE_PATH);
  const frozen = JSON.parse(readFileSync(manifestPath, 'utf8')) as FrozenDevelopmentSet;
  if (frozen.schemaVersion !== 'teaching-compiler-v1-development-set/v1' || frozen.setId !== 'teaching-compiler-v1-dev-set-v1') {
    throw new Error('unsupported or unfrozen development benchmark manifest');
  }
  if (!Number.isInteger(frozen.targetDurationSec) || frozen.targetDurationSec < 1 || !frozen.instruction.trim()) {
    throw new Error('development benchmark manifest has invalid shared run settings');
  }
  if (frozen.topics.length !== 5 || frozen.plannedAttempts.length !== 15) {
    throw new Error('development benchmark manifest must pin exactly five topics and 15 planned attempts');
  }
  if (new Set(frozen.topics.map(({ topicId }) => topicId)).size !== frozen.topics.length ||
      frozen.topics.some(({ topicId, sourcePath, sourceSha256 }) =>
        !topicId.trim() || !sourcePath.trim() || !/^[a-f0-9]{64}$/.test(sourceSha256))) {
    throw new Error('development benchmark manifest has duplicate topics or invalid source metadata');
  }
  const sourceById = new Map(frozen.topics.map((topic) => [topic.topicId, topic]));
  for (const topic of frozen.topics) {
    const candidate = path.resolve(root, topic.sourcePath);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`development source escapes repository root: ${topic.sourcePath}`);
    const sourcePath = realpathSync(candidate);
    if (!sourcePath.startsWith(`${root}${path.sep}`)) throw new Error(`development source escapes repository root through a symlink: ${topic.sourcePath}`);
    const actual = sha256(readFileSync(sourcePath));
    if (actual !== topic.sourceSha256) throw new Error(`frozen development source drift for ${topic.topicId}: ${actual}`);
  }
  const attempts = new Map<string, FrozenDevelopmentSet['plannedAttempts'][number]>();
  const trialKeys = new Set<string>();
  for (const attempt of frozen.plannedAttempts) {
    if (attempts.has(attempt.attemptId)) throw new Error(`duplicate planned attempt ${attempt.attemptId}`);
    if (!sourceById.has(attempt.topicId) || attempt.cache !== 'cold' || !Number.isInteger(attempt.trial) || attempt.trial < 1 || attempt.trial > 3) {
      throw new Error(`invalid planned attempt ${attempt.attemptId}`);
    }
    const trialKey = `${attempt.topicId}\u0000${attempt.trial}`;
    if (trialKeys.has(trialKey)) throw new Error(`duplicate planned trial ${attempt.topicId} trial ${attempt.trial}`);
    trialKeys.add(trialKey);
    attempts.set(attempt.attemptId, attempt);
  }
  if (trialKeys.size !== 15 || frozen.topics.some(({ topicId }) =>
    [1, 2, 3].some((trial) => !trialKeys.has(`${topicId}\u0000${trial}`)))) {
    throw new Error('development benchmark manifest must plan exactly trials 1..3 for every topic');
  }
  const planned = attempts.get(attemptId);
  if (!planned) throw new Error(`unknown development attempt ${attemptId}`);
  const topic = sourceById.get(planned.topicId)!;
  return {
    setId: frozen.setId,
    attemptId,
    topicId: planned.topicId,
    trial: planned.trial,
    sourcePath: topic.sourcePath,
    sourceSha256: topic.sourceSha256,
    instruction: frozen.instruction,
    instructionSha256: sha256(frozen.instruction),
    targetDurationSec: frozen.targetDurationSec,
  };
}

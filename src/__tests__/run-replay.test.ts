import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReplayFixtures, replayChainProblems } from '../harness/runReplay.js';

const fixture = (stage: string, subject: string, responses: number) => ({
  schemaVersion: 'structured-replay/v1', stage, subject, model: 'test/model', provider: 'openrouter', schemaName: 'doc',
  responses: Array.from({ length: responses }, () => ({ content: '{}', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, cost: 0 }, schemaConstrained: true, requestHash: 'h' })),
});

test('collectReplayFixtures lists every call under structured/ in deterministic order; the chain is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyp-replay-'));
  try {
    await mkdir(join(dir, 'structured', 'plan', '0001-teaching-plan'), { recursive: true });
    await mkdir(join(dir, 'structured', 'planner', '0001-scene-a'), { recursive: true });
    await writeFile(join(dir, 'structured', 'plan', '0001-teaching-plan', 'replay-fixture.json'), JSON.stringify(fixture('plan', 'teaching plan', 2)));
    await writeFile(join(dir, 'structured', 'planner', '0001-scene-a', 'replay-fixture.json'), JSON.stringify(fixture('planner', 'scene a', 1)));
    const entries = collectReplayFixtures(dir);
    assert.deepEqual(entries.map((entry) => `${entry.stage}|${entry.subject}|${entry.responses}`), ['plan|teaching plan|2', 'planner|scene a|1']);
    assert.deepEqual(replayChainProblems(entries), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty run and a zero-response fixture are reported, never silently accepted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyp-replay-'));
  try {
    assert.deepEqual(replayChainProblems(collectReplayFixtures(dir)), ['run has no replay fixtures; nothing to replay']);
    await mkdir(join(dir, 'structured', 'plan', '0001-x'), { recursive: true });
    await writeFile(join(dir, 'structured', 'plan', '0001-x', 'replay-fixture.json'), JSON.stringify(fixture('plan', 'x', 0)));
    assert.ok(replayChainProblems(collectReplayFixtures(dir)).some((problem) => /recorded no responses/.test(problem)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

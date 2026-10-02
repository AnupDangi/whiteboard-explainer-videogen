import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { FileCallRecorder, withCallRecorder } from '../structured/recorder.js';
import { replayClient, type ReplayFixture } from '../structured/replayClient.js';
import { structuredCall } from '../llm/structuredCall.js';
import type { ModelClient } from '../llm/modelClient.js';

const schema = z.object({ title: z.string(), qty: z.number() }).strict();
const usage = { promptTokens: 2, completionTokens: 3, cachedTokens: 0, costUsd: 0.0002 };
const scripted = (replies: string[]): ModelClient => {
  let i = 0;
  return { provider: 'fake', chat: async () => ({ content: replies[i++] ?? '{}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }) };
};
const base = { stage: 'plan', subject: 'scene one', model: 'google/x', apiKey: 'k', system: 'SYSTEM', user: 'USER', schema, schemaName: 'doc', maxTokens: 100, remainingBudgetUsd: 1 };
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-recorder-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('every call is retained: raw output, validation errors, repair patches, validated output, coercions, report and a replay fixture', async () => {
  await withTmp(async (dir) => {
    const client = scripted(['{"title":"T","qty":"many"}', '{"patches":[{"op":"replace","path":"/qty","valueJson":"4"}]}']);
    const result = await withCallRecorder(new FileCallRecorder(dir), () => structuredCall({ ...base, client }));
    assert.deepEqual(result.value, { title: 'T', qty: 4 });
    const callDirs = await readdir(path.join(dir, 'structured', 'plan'));
    assert.equal(callDirs.length, 1);
    const callDir = path.join(dir, 'structured', 'plan', callDirs[0]!);
    assert.deepEqual((await readdir(callDir)).sort(), ['coercions.json', 'raw-model-output.json', 'repair-patches.json', 'replay-fixture.json', 'report.json', 'validated-output.json', 'validation-errors.json']);
    const raw = await readJson(path.join(callDir, 'raw-model-output.json'));
    assert.equal(raw.responses.length, 2);
    assert.equal(raw.responses[0].content, '{"title":"T","qty":"many"}', 'the first (invalid) output is kept verbatim');
    const errors = await readJson(path.join(callDir, 'validation-errors.json'));
    assert.equal(errors.errors[0].issues[0].path, '/qty');
    const patches = await readJson(path.join(callDir, 'repair-patches.json'));
    assert.deepEqual(patches.repairs[0].patches, [{ op: 'replace', path: '/qty', value: 4 }]);
    assert.deepEqual(await readJson(path.join(callDir, 'validated-output.json')), { title: 'T', qty: 4 });
    const report = await readJson(path.join(callDir, 'report.json'));
    assert.deepEqual(report.retained, { raw: true, replayFixture: true });
    assert.deepEqual(result.reports[0]!.retained, { raw: true, replayFixture: true });
  });
});

test('a failed call is retained too and the validated output file says there was none', async () => {
  await withTmp(async (dir) => {
    const result = await withCallRecorder(new FileCallRecorder(dir), () => structuredCall({ ...base, client: scripted(['{"nope":1}', '{"patches":[{"op":"remove","path":"/zzz"}]}']) }));
    assert.equal(result.value, undefined);
    const [callDir] = await readdir(path.join(dir, 'structured', 'plan'));
    const validated = await readJson(path.join(dir, 'structured', 'plan', callDir!, 'validated-output.json'));
    assert.equal(validated.validated, false);
    const raw = await readJson(path.join(dir, 'structured', 'plan', callDir!, 'raw-model-output.json'));
    assert.equal(raw.responses.length, 2);
  });
});

test('recording never overwrites: two calls with the same stage and subject get distinct directories', async () => {
  await withTmp(async (dir) => {
    const recorder = new FileCallRecorder(dir);
    await withCallRecorder(recorder, async () => {
      await structuredCall({ ...base, client: scripted(['{"title":"A","qty":1}']) });
      await structuredCall({ ...base, client: scripted(['{"title":"B","qty":2}']) });
    });
    const dirs = await readdir(path.join(dir, 'structured', 'plan'));
    assert.equal(new Set(dirs).size, 2);
  });
});

test('a replay fixture reproduces the same value, repairs and cost with no model call', async () => {
  await withTmp(async (dir) => {
    const live = await withCallRecorder(new FileCallRecorder(dir), () => structuredCall({ ...base, client: scripted(['{"title":"T","qty":"x"}', '{"patches":[{"op":"replace","path":"/qty","valueJson":"9"}]}']) }));
    const [callDir] = await readdir(path.join(dir, 'structured', 'plan'));
    const fixture = await readJson(path.join(dir, 'structured', 'plan', callDir!, 'replay-fixture.json')) as unknown as ReplayFixture;
    const client = replayClient(fixture);
    const replayed = await structuredCall({ ...base, client });
    assert.deepEqual(replayed.value, live.value);
    assert.deepEqual(replayed.trace.repairs, live.trace.repairs);
    assert.equal(replayed.usage.costUsd, live.usage.costUsd);
    client.assertDrained();
  });
});

test('replay refuses a request whose prompt differs from the recorded one, and an exhausted or unused fixture', async () => {
  await withTmp(async (dir) => {
    await withCallRecorder(new FileCallRecorder(dir), () => structuredCall({ ...base, client: scripted(['{"title":"T","qty":1}']) }));
    const [callDir] = await readdir(path.join(dir, 'structured', 'plan'));
    const fixture = await readJson(path.join(dir, 'structured', 'plan', callDir!, 'replay-fixture.json')) as unknown as ReplayFixture;
    const changed = await structuredCall({ ...base, user: 'A DIFFERENT PROMPT', client: replayClient(fixture) }).catch((error: Error) => error);
    assert.ok(changed instanceof Error || (changed as { failures: Array<{ message: string }> }).failures.some((f) => /replay fixture/.test(f.message)));
    const unused = replayClient(fixture);
    assert.throws(() => unused.assertDrained(), /unused/);
    const used = replayClient(fixture);
    await structuredCall({ ...base, client: used });
    await assert.rejects(() => used.chat({ model: 'm', system: 'SYSTEM', user: 'USER', schema: {}, schemaName: 'doc', maxTokens: 1, temperature: 0 }), /exhausted/);
  });
});

test('a recorder that cannot write is a visible soft failure, the call still succeeds, and the report says nothing was retained', async () => {
  await withTmp(async (dir) => {
    const blocker = path.join(dir, 'file-not-dir');
    await writeFile(blocker, 'x');
    const result = await withCallRecorder(new FileCallRecorder(path.join(blocker, 'sub')), () => structuredCall({ ...base, client: scripted(['{"title":"T","qty":1}']) }));
    assert.deepEqual(result.value, { title: 'T', qty: 1 });
    assert.ok(result.failures.some((f) => f.code === 'plan-record-failed' && !f.hard));
    assert.deepEqual(result.reports[0]!.retained, { raw: false, replayFixture: false });
  });
});

test('the recorder exposes every call report it saw, with the final retained flags', async () => {
  await withTmp(async (dir) => {
    const recorder = new FileCallRecorder(dir);
    await withCallRecorder(recorder, async () => {
      await structuredCall({ ...base, client: scripted(['{"title":"A","qty":1}']) });
      await structuredCall({ ...base, stage: 'script', client: scripted(['{"title":"B","qty":2}']) });
    });
    assert.deepEqual(recorder.reports().map((r) => [r.stage, r.retained.raw]), [['plan', true], ['script', true]]);
  });
});

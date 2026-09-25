import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContentAddressedArtifactStore } from '../artifactCache.js';
import { budgetLedgerAccountingProblems, PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { sourceDocFromText } from '../plan/sourceDoc.js';

test('content-addressed stage cache reuses unchanged inputs and invalidates changed dependencies or versions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-stage-cache-'));
  try {
    const cold = new ContentAddressedArtifactStore(root, 'cold');
    const meta = { schemaVersion: 'test/v1', stageVersion: 'renderer-1', modelId: 'fixture-model', promptVersion: 'prompt-3', catalogVersion: 'catalog-7' };
    let calls = 0;
    const first = await cold.run('S10-render', { sourceHash: 'a1', scene: { title: 'A' } }, meta, () => ({ svg: `render-${++calls}` }));
    assert.equal(first.cacheHit, false);

    const warm = new ContentAddressedArtifactStore(root, 'warm');
    const repeated = await warm.run('S10-render', { scene: { title: 'A' }, sourceHash: 'a1' }, meta, () => ({ svg: `render-${++calls}` }));
    assert.equal(repeated.cacheHit, true);
    assert.deepEqual(repeated.artifact.payload, first.artifact.payload);
    assert.equal(calls, 1, 'producer must not run on a warm hit');

    const changedInput = await warm.run('S10-render', { sourceHash: 'a2', scene: { title: 'A' } }, meta, () => ({ svg: `render-${++calls}` }));
    assert.equal(changedInput.cacheHit, false, 'a source change invalidates the dependent stage');
    const changedRenderer = await warm.run('S10-render', { sourceHash: 'a1', scene: { title: 'A' } }, { ...meta, stageVersion: 'renderer-2' }, () => ({ svg: `render-${++calls}` }));
    assert.equal(changedRenderer.cacheHit, false, 'a renderer version change invalidates the artifact');
    await cold.run('S3-teaching-plan', { sourceHash: 'a1' }, { ...meta, promptVersion: 'teaching-plan-prompt-v1' }, () => ({ plan: `plan-${++calls}` }));
    const oldPromptWarm = await warm.run('S3-teaching-plan', { sourceHash: 'a1' }, { ...meta, promptVersion: 'teaching-plan-prompt-v1' }, () => ({ plan: `plan-${++calls}` }));
    assert.equal(oldPromptWarm.cacheHit, true);
    const changedPrompt = await warm.run('S3-teaching-plan', { sourceHash: 'a1' }, { ...meta, promptVersion: 'teaching-plan-prompt-v2' }, () => ({ plan: `plan-${++calls}` }));
    assert.equal(changedPrompt.cacheHit, false, 'a teaching-plan prompt change invalidates the cached plan');
    const changedCatalog = await warm.run('S7-resolve', { sourceHash: 'a1' }, meta, () => ({ resolution: `catalog-${++calls}` }));
    const nextCatalog = await warm.run('S7-resolve', { sourceHash: 'a1' }, { ...meta, catalogVersion: 'catalog-8' }, () => ({ resolution: `catalog-${++calls}` }));
    assert.equal(changedCatalog.cacheHit, false);
    assert.equal(nextCatalog.cacheHit, false, 'a catalog version change invalidates resolution artifacts');

    const promptAudit = { compiledPrompt: { system: 'versioned director prompt', user: 'source-grounded scene context' }, promptHash: 'prompt-hash', contextHash: 'context-hash', selectedExamples: [{ id: 'example-1', order: 0, score: 0.7 }] };
    type PlannerCachePayload = { result: { sceneId: string }; promptAudit: typeof promptAudit };
    const firstPlanner = await cold.run<PlannerCachePayload>('S6-scene-planner', { inputHash: 'scene-a', promptAudit }, { ...meta, schemaVersion: 'claude-scene-spec/v1', stageVersion: 'planner-3' }, () => ({ result: { sceneId: 'scene-a' }, promptAudit }));
    const warmPlanner = await warm.run<PlannerCachePayload>('S6-scene-planner', { inputHash: 'scene-a', promptAudit }, { ...meta, schemaVersion: 'claude-scene-spec/v1', stageVersion: 'planner-3' }, () => { throw new Error('warm S6 cache should not rerun the planner'); });
    assert.equal(warmPlanner.cacheHit, true);
    assert.deepEqual(warmPlanner.artifact.payload.promptAudit, firstPlanner.artifact.payload.promptAudit);
    assert.equal(warmPlanner.artifact.payload.promptAudit.compiledPrompt.user, 'source-grounded scene context');

    const replay = new ContentAddressedArtifactStore(root, 'replay');
    await assert.rejects(replay.run('S9-timeline', { sourceHash: 'a1' }, meta, () => ({ events: [] })), /Replay cache miss/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file stage cache materializes binary outputs across run directories and repairs missing blobs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-file-cache-'));
  try {
    const input = { sceneHash: 'generated-scene-hash', audioHash: 'audio-hash' };
    const meta = { schemaVersion: 'video/mp4', stageVersion: 'encoder-file-cache-2', modelId: 'resvg+ffmpeg' };
    const firstOutput = path.join(root, 'run-one', 'video.mp4');
    const secondOutput = path.join(root, 'run-two', 'video.mp4');
    const cold = new ContentAddressedArtifactStore(path.join(root, 'cache'), 'cold');
    let calls = 0;
    const first = await cold.runFile('S11-mp4-encode', input, meta, firstOutput, async () => {
      calls += 1;
      await writeFile(firstOutput, Buffer.from('synthetic binary output'));
    });
    assert.equal(first.cacheHit, false);
    const warm = new ContentAddressedArtifactStore(path.join(root, 'cache'), 'warm');
    const second = await warm.runFile('S11-mp4-encode', input, meta, secondOutput, async () => {
      calls += 1;
      throw new Error('warm binary cache must materialize without rerunning encoder');
    });
    assert.equal(second.cacheHit, true);
    assert.deepEqual(await readFile(secondOutput), await readFile(firstOutput));
    assert.equal(second.artifact.payload.outputBytes, Buffer.byteLength('synthetic binary output'));
    assert.equal(calls, 1);

    const blobPath = path.join(path.join(root, 'cache'), first.key.slice(0, 2), `${first.key}.blob`);
    await rm(blobPath);
    await rm(secondOutput);
    const repairedOutput = path.join(root, 'run-three', 'video.mp4');
    const repaired = await warm.runFile('S11-mp4-encode', input, meta, repairedOutput, async () => {
      calls += 1;
      await writeFile(repairedOutput, Buffer.from('regenerated binary output'));
    });
    assert.equal(repaired.cacheHit, false, 'warm mode regenerates metadata-only artifacts when the binary is absent');
    assert.equal(calls, 2);
    assert.equal((await readFile(repairedOutput)).toString(), 'regenerated binary output');

    const replay = new ContentAddressedArtifactStore(path.join(root, 'empty-cache'), 'replay');
    await assert.rejects(replay.runFile('S11-mp4-encode', input, meta, path.join(root, 'run-four', 'video.mp4'), async () => {}), /Replay cache miss/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('source-location changes invalidate source-derived concept artifacts even when extracted text is identical', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-source-location-cache-'));
  try {
    const text = 'The mechanism increases the output.';
    const firstSource = sourceDocFromText(text, 'docx', [{ startChar: 0, endChar: text.length, sourceLocation: { kind: 'docx-paragraph', bodyBlock: 2, paragraph: 1 } }]);
    const relocatedSource = sourceDocFromText(text, 'docx', [{ startChar: 0, endChar: text.length, sourceLocation: { kind: 'docx-paragraph', bodyBlock: 4, paragraph: 2 } }]);
    assert.equal(firstSource.sourceId, relocatedSource.sourceId, 'semantic text identity remains stable across source-location changes');
    assert.notDeepEqual(firstSource.spans[0].sourceLocation, relocatedSource.spans[0].sourceLocation);
    const cold = new ContentAddressedArtifactStore(root, 'cold');
    const metadata = { schemaVersion: 'concept-graph/v1', stageVersion: 'source-locations-1', promptVersion: 'concept-prompt-1' };
    await cold.run('S2-concepts', { sourceDoc: firstSource }, metadata, () => ({ concepts: ['mechanism'] }));
    const warm = new ContentAddressedArtifactStore(root, 'warm');
    const changed = await warm.run('S2-concepts', { sourceDoc: relocatedSource }, metadata, () => ({ concepts: ['mechanism'] }));
    assert.equal(changed.cacheHit, false, 'a changed native citation location must invalidate S2 provenance');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger carries spend across calls and prevents concurrent calls from bypassing the cap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-ledger-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.006);
    const results = await Promise.all([
      ledger.call(0.01, async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { value: 'first', costUsd: 0.006 }; }),
      ledger.call(0.01, async () => ({ value: 'second', costUsd: 0.006 })),
    ]);
    assert.equal(results.filter((result) => result.allowed).length, 1, 'the second call observes the first call spend before starting');
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.calls, 1);
    assert.equal(snapshot.spentUsd, 0.006);
    const blocked = await ledger.call(0.01, async () => ({ value: 'must-not-run', costUsd: 0 }));
    assert.deepEqual(blocked, { allowed: false, spentUsd: 0.006 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger passes the true shared remaining allowance into each provider request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-remaining-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    await ledger.call(0.01, async () => ({ value: 'S2', costUsd: 0.007 }));
    let observedAllowance = 0;
    const lastCall = await ledger.call(0.009, async (allowedUsd) => {
      observedAllowance = allowedUsd;
      return { value: 'S6', costUsd: 0.003 };
    });
    assert.equal(observedAllowance, 0.003, 'later-stage price caps must account for spend already recorded by earlier stages');
    assert.deepEqual(lastCall, { allowed: true, value: 'S6', costUsd: 0.003 });
    const denied = await ledger.call(0.009, async () => ({ value: 'must-not-run', costUsd: 0 }));
    assert.deepEqual(denied, { allowed: false, spentUsd: 0.01 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger refuses to proceed if a previous call left an uncertain lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-lock-'));
  try {
    const filePath = path.join(root, 'budget.json');
    const ledger = new PersistentBudgetLedger(filePath, 0.01, 0);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(`${filePath}.lock`, 'uncertain'));
    await assert.rejects(ledger.call(0.01, async () => ({ value: true, costUsd: 0 })), /refusing an unaccounted model call/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger blocks later requests after an uncertain provider failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-uncertain-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    await assert.rejects(ledger.call(0.01, async () => { throw new Error('provider timed out after dispatch'); }), /provider timed out/);
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, true);
    assert.equal(snapshot.uncertainty, 'provider timed out after dispatch');
    await assert.rejects(ledger.call(0.01, async () => ({ value: true, costUsd: 0 })), /budget ledger is blocked/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger records measured overrun and blocks every later provider call', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-overrun-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    const first = await ledger.call(0.01, async () => ({ value: 'measured', costUsd: 0.012 }));
    assert.deepEqual(first, { allowed: true, value: 'measured', costUsd: 0.012 });
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.spentUsd, 0.012);
    assert.equal(snapshot.blocked, true);
    assert.match(snapshot.blockReason ?? '', /exceeded the \$0\.010000 budget/);
    await assert.rejects(ledger.call(0.01, async () => ({ value: 'must-not-run', costUsd: 0 })), /refusing further calls/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent budget ledger rejects recorded over-budget spend that is incorrectly marked unblocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-inconsistent-'));
  try {
    const filePath = path.join(root, 'budget.json');
    const ledger = new PersistentBudgetLedger(filePath, 0.1);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, JSON.stringify({
      schemaVersion: 'hypothesis-budget-ledger/v1', budgetUsd: 0.1, spentUsd: 0.119435816,
      calls: 9, blocked: false, updatedAt: '2026-09-24T08:14:30.567Z',
    })));
    await assert.rejects(ledger.snapshot(), /recorded spend \$0\.119436 exceeds the \$0\.100000 budget but the ledger is not blocked/);
    let called = false;
    await assert.rejects(ledger.call(0.01, async () => { called = true; return { value: true, costUsd: 0 }; }), /inconsistent budget ledger/);
    assert.equal(called, false, 'a corrupt over-budget ledger must fail before any provider request');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('run budget reconciliation ignores cached artifact cost and permits cumulative prior-attempt spend', () => {
  const snapshot = { schemaVersion: 'hypothesis-budget-ledger/v1' as const, budgetUsd: 0.1, spentUsd: 0.004681016, calls: 6, blocked: false, updatedAt: '2026-09-24T00:00:00Z' };
  assert.deepEqual(budgetLedgerAccountingProblems(snapshot, [
    { kind: 'provider', apiCostUsd: 0.0026154 },
    { kind: 'provider', apiCostUsd: 0.002065616 },
    { kind: 'provider', apiCostUsd: 0 },
    { kind: 'local', apiCostUsd: 0 },
  ]), []);
  assert.deepEqual(budgetLedgerAccountingProblems({ ...snapshot, spentUsd: 0.02 }, [
    { kind: 'provider', apiCostUsd: 0.0026154 },
    { kind: 'provider', apiCostUsd: 0.002065616 },
  ]), [], 'ledger totals may include earlier attempts while current stages describe only this run');
  assert.match(budgetLedgerAccountingProblems(snapshot, [
    { kind: 'provider', apiCostUsd: 0.006 },
  ])[0] ?? '', /ledger reports only \$0\.004681 spent but this run's provider stages report \$0\.006000/);
});

test('persistent budget ledger records known DNS/connection preflight failures without charging or blocking retry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-budget-preflight-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.01);
    const dnsError = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    await assert.rejects(ledger.call(0.01, async () => { throw dnsError; }), /fetch failed/);
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.preflightFailures, 1);
    assert.equal(snapshot.spentUsd, 0);
    assert.equal(snapshot.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

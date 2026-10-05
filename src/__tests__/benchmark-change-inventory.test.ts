import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureBenchmarkChangeInventory,
  createBenchmarkTrialChangeEvidence,
  isBenchmarkChangeInventory,
  isBenchmarkTrialChangeEvidence,
} from '../harness/benchmarkChangeInventory.js';

test('benchmark change inventory pins changed, added, and deleted tests plus frozen baseline bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benchmark-change-inventory-'));
  try {
    await mkdir(path.join(root, 'src/__tests__'), { recursive: true });
    await mkdir(path.join(root, 'harness/baselines'), { recursive: true });
    await writeFile(path.join(root, 'src/__tests__/changed.test.ts'), 'assert.equal(1, 1);\n');
    await writeFile(path.join(root, 'src/__tests__/deleted.test.ts'), 'assert.equal(2, 2);\n');
    await writeFile(path.join(root, 'harness/baselines/expected.json'), '{"answer":42}\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: root });

    await writeFile(path.join(root, 'src/__tests__/changed.test.ts'), 'assert.equal(1, 2);\n');
    await writeFile(path.join(root, 'src/__tests__/added.test.ts'), 'assert.equal(3, 3);\n');
    await rm(path.join(root, 'src/__tests__/deleted.test.ts'));
    await writeFile(path.join(root, 'harness/baselines/expected.json'), '{"answer":43}\n');

    const inventory = captureBenchmarkChangeInventory(root);
    assert.equal(isBenchmarkChangeInventory(inventory), true);
    assert.deepEqual(inventory.changedTestFiles.map(({ path: file, state }) => [file, state]), [
      ['src/__tests__/added.test.ts', 'untracked'],
      ['src/__tests__/changed.test.ts', 'changed'],
      ['src/__tests__/deleted.test.ts', 'deleted'],
    ]);
    assert.deepEqual(inventory.changedBaselineFiles.map(({ path: file, state }) => [file, state]), [
      ['harness/baselines/expected.json', 'changed'],
    ]);
    assert.equal(inventory.changedTestFiles.find((entry) => entry.path.endsWith('changed.test.ts'))!.sha256?.length, 64);
    assert.equal(inventory.changedTestFiles.find((entry) => entry.path.endsWith('deleted.test.ts'))!.sha256, null);

    const tampered = structuredClone(inventory);
    tampered.changedTestFiles[0]!.sha256 = '0'.repeat(64);
    assert.equal(isBenchmarkChangeInventory(tampered), false);
    const stableEvidence = createBenchmarkTrialChangeEvidence(inventory, inventory);
    assert.equal(stableEvidence.stableDuringTrial, true);
    assert.equal(isBenchmarkTrialChangeEvidence(stableEvidence), true);
    await writeFile(path.join(root, 'harness/baselines/expected.json'), '{"answer":44}\n');
    const changed = captureBenchmarkChangeInventory(root);
    assert.notEqual(changed.inventorySha256, inventory.inventorySha256);
    const mutatedEvidence = createBenchmarkTrialChangeEvidence(inventory, changed);
    assert.equal(mutatedEvidence.stableDuringTrial, false);
    assert.equal(isBenchmarkTrialChangeEvidence(mutatedEvidence), true);
    const tamperedEvidence = structuredClone(stableEvidence);
    tamperedEvidence.stableDuringTrial = false;
    assert.equal(isBenchmarkTrialChangeEvidence(tamperedEvidence), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

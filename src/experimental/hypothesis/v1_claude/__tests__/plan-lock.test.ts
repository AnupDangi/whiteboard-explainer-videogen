import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

interface PlanLock { schemaVersion: 'plan-lock/v1'; plans: Array<{ path: string; sha256: string; amendmentsPath: string; lockedAt: string }> }

const ROOT = process.cwd();
const lock = JSON.parse(readFileSync(resolve(ROOT, 'docs/superpowers/plans/plan-lock.json'), 'utf8')) as PlanLock;

test('plan lock file declares at least one frozen plan', () => {
  assert.equal(lock.schemaVersion, 'plan-lock/v1');
  assert.ok(lock.plans.length >= 1);
});

test('frozen plans match their locked SHA-256', () => {
  for (const entry of lock.plans) {
    const digest = createHash('sha256').update(readFileSync(resolve(ROOT, entry.path))).digest('hex');
    assert.equal(digest, entry.sha256, `${entry.path} changed after it was locked; record changes in ${entry.amendmentsPath} with quoted user approval instead`);
  }
});

test('frozen plans are read-only on disk', () => {
  for (const entry of lock.plans) {
    assert.equal(statSync(resolve(ROOT, entry.path)).mode & 0o222, 0, `${entry.path} must stay chmod 444`);
  }
});

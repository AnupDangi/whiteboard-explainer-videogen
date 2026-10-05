import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface BenchmarkChangeRecord {
  path: string;
  state: 'changed' | 'untracked' | 'deleted';
  sha256: string | null;
}

export interface BenchmarkChangeInventory {
  schemaVersion: 'benchmark-change-inventory/v1';
  head: string;
  changedTestFiles: BenchmarkChangeRecord[];
  changedBaselineFiles: BenchmarkChangeRecord[];
  inventorySha256: string;
}

export interface BenchmarkTrialChangeEvidence {
  schemaVersion: 'benchmark-trial-change-evidence/v1';
  before: BenchmarkChangeInventory;
  after: BenchmarkChangeInventory;
  stableDuringTrial: boolean;
  inventorySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_HEAD = /^[a-f0-9]{40,64}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function inventoryDigest(inventory: Omit<BenchmarkChangeInventory, 'inventorySha256'>): string {
  return createHash('sha256').update(stableJson(inventory)).digest('hex');
}

function trialEvidenceDigest(evidence: Omit<BenchmarkTrialChangeEvidence, 'inventorySha256'>): string {
  return createHash('sha256').update(stableJson(evidence)).digest('hex');
}

function changedNames(root: string, args: string[]): string[] {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

function isTestFile(file: string): boolean {
  return /(?:^|\/)__tests__(?:\/|$)/u.test(file)
    || /(?:^|\/)tests?(?:\/|$)/u.test(file)
    || /\.(?:test|spec)\.[^/]+$/iu.test(file)
    || /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.[^/]+$/iu.test(file);
}

function isBaselineFile(file: string): boolean {
  return file.startsWith('bench/benchmark-v2/')
    || file.startsWith('harness/baselines/')
    || file.startsWith('harness/reference/lamina/')
    || file.startsWith('src/fixtures/')
    || file === 'src/shared/fixtures.ts'
    || /(?:^|\/)(?:__fixtures__|baselines?|goldens?|expected)(?:\/|$)/iu.test(file)
    || /\.(?:snap|golden)\.[^/]+$/iu.test(file);
}

function recordsFor(root: string, files: readonly string[], untracked: ReadonlySet<string>): BenchmarkChangeRecord[] {
  return [...new Set(files)].sort().map((file) => {
    if (path.isAbsolute(file) || file.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error(`Git reported an unsafe changed path: ${file}`);
    }
    const absolute = path.join(root, file);
    let present = false;
    try {
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Refusing symlink in benchmark change inventory: ${file}`);
      present = info.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const state = !present ? 'deleted' : untracked.has(file) ? 'untracked' : 'changed';
    return { path: file, state, sha256: present ? createHash('sha256').update(readFileSync(absolute)).digest('hex') : null };
  });
}

/** Snapshot changed tests and frozen/expected inputs at benchmark start, including their current bytes. */
export function captureBenchmarkChangeInventory(root: string): BenchmarkChangeInventory {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!GIT_HEAD.test(head)) throw new Error('Git returned an invalid HEAD for the benchmark change inventory');
  const changed = changedNames(root, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--']);
  const untracked = new Set(changedNames(root, ['ls-files', '--others', '--exclude-standard', '-z', '--']));
  const all = [...new Set([...changed, ...untracked])];
  const body = {
    schemaVersion: 'benchmark-change-inventory/v1' as const,
    head,
    changedTestFiles: recordsFor(root, all.filter(isTestFile), untracked),
    changedBaselineFiles: recordsFor(root, all.filter(isBaselineFile), untracked),
  };
  return { ...body, inventorySha256: inventoryDigest(body) };
}

/** Validate the inventory contract and its digest before accepting runner evidence. */
export function isBenchmarkChangeInventory(value: unknown): value is BenchmarkChangeInventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BenchmarkChangeInventory>;
  if (Object.keys(candidate).sort().join(',') !== 'changedBaselineFiles,changedTestFiles,head,inventorySha256,schemaVersion') return false;
  if (candidate.schemaVersion !== 'benchmark-change-inventory/v1' || !GIT_HEAD.test(candidate.head ?? '')
    || !SHA256.test(candidate.inventorySha256 ?? '') || !Array.isArray(candidate.changedTestFiles)
    || !Array.isArray(candidate.changedBaselineFiles)) return false;
  const validRecords = (records: BenchmarkChangeRecord[], classifier: (file: string) => boolean) => {
    const seen = new Set<string>();
    for (const record of records) {
      if (!record || Object.keys(record).sort().join(',') !== 'path,sha256,state'
        || typeof record.path !== 'string' || !record.path || record.path.includes('\\') || path.isAbsolute(record.path)
        || !classifier(record.path)
        || record.path.split('/').some((part) => part === '..' || part === '.')
        || !['changed', 'untracked', 'deleted'].includes(record.state)
        || (record.state === 'deleted' ? record.sha256 !== null : !SHA256.test(record.sha256 ?? ''))
        || seen.has(record.path)) return false;
      seen.add(record.path);
    }
    return records.every((record, index) => index === 0 || records[index - 1]!.path < record.path);
  };
  if (!validRecords(candidate.changedTestFiles, isTestFile) || !validRecords(candidate.changedBaselineFiles, isBaselineFile)) return false;
  const { inventorySha256, ...body } = candidate as BenchmarkChangeInventory;
  return inventoryDigest(body) === inventorySha256;
}

/** Bind before/after snapshots so mutation during a trial is visible and cannot qualify Stage A. */
export function createBenchmarkTrialChangeEvidence(
  before: BenchmarkChangeInventory,
  after: BenchmarkChangeInventory,
): BenchmarkTrialChangeEvidence {
  if (!isBenchmarkChangeInventory(before) || !isBenchmarkChangeInventory(after)) {
    throw new Error('Cannot seal an invalid benchmark change inventory');
  }
  const body = {
    schemaVersion: 'benchmark-trial-change-evidence/v1' as const,
    before,
    after,
    stableDuringTrial: before.head === after.head && before.inventorySha256 === after.inventorySha256,
  };
  return { ...body, inventorySha256: trialEvidenceDigest(body) };
}

export function isBenchmarkTrialChangeEvidence(value: unknown): value is BenchmarkTrialChangeEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BenchmarkTrialChangeEvidence>;
  if (Object.keys(candidate).sort().join(',') !== 'after,before,inventorySha256,schemaVersion,stableDuringTrial'
    || candidate.schemaVersion !== 'benchmark-trial-change-evidence/v1'
    || typeof candidate.inventorySha256 !== 'string' || !SHA256.test(candidate.inventorySha256)
    || typeof candidate.stableDuringTrial !== 'boolean'
    || !isBenchmarkChangeInventory(candidate.before) || !isBenchmarkChangeInventory(candidate.after)) return false;
  const expectedStable = candidate.before.head === candidate.after.head
    && candidate.before.inventorySha256 === candidate.after.inventorySha256;
  if (candidate.stableDuringTrial !== expectedStable) return false;
  const { inventorySha256, ...body } = candidate as BenchmarkTrialChangeEvidence;
  return trialEvidenceDigest(body) === inventorySha256;
}

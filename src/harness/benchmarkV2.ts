import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * V2 benchmark contract (plan §4.2, §7): a frozen cold 5 × 3 grid and the Stage A/B latency and failure gates. Every gate is
 * `passed`, `failed` or `unmeasured`; a metric that was not recorded is never a pass.
 */
export const BenchmarkManifestSchema = z.object({
  schemaVersion: z.literal('benchmark-v2/v1'),
  name: z.string().min(1),
  trialsPerCase: z.number().int().min(1),
  cases: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), domain: z.string().min(1), capability: z.string().min(1), sourceFile: z.string().min(1) }).strict()).min(1),
}).strict();
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Hashes of every source file, to be written beside the manifest and never edited afterwards. */
export async function freezeBenchmarkSources(dir: string, manifest: BenchmarkManifest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of manifest.cases) out[item.id] = sha256(await readFile(path.join(dir, item.sourceFile)));
  return out;
}

/** Problems between the manifest, the sources on disk and the frozen hashes. Empty when the benchmark is intact. */
export async function verifyFrozenBenchmark(dir: string, manifest: BenchmarkManifest, frozen: Record<string, string>): Promise<string[]> {
  const problems: string[] = [];
  const ids = manifest.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) problems.push('duplicate case id');
  for (const item of manifest.cases) {
    if (!frozen[item.id]) { problems.push(`${item.id}: no frozen source hash`); continue; }
    try { if (sha256(await readFile(path.join(dir, item.sourceFile))) !== frozen[item.id]) problems.push(`${item.id}: source changed since it was frozen`); }
    catch { problems.push(`${item.id}: source file missing`); }
  }
  for (const id of Object.keys(frozen)) if (!ids.includes(id)) problems.push(`${id}: frozen hash for a case not in the manifest`);
  return problems;
}

export interface TrialSummary { caseId: string; trial: number; status: 'draft' | 'failed' | 'passed'; metrics: Record<string, number>; hardFailures: number; wrongIcons?: number }
export type GateStatus = 'passed' | 'failed' | 'unmeasured';
export interface GateResult { gate: string; status: GateStatus; observed?: number; limit?: number; detail?: string }

const seconds = (ms: number | undefined): number | undefined => (ms === undefined ? undefined : ms / 1000);
const worst = (trials: readonly TrialSummary[], key: string): number | undefined => {
  const values = trials.map((trial) => trial.metrics[key]);
  return values.some((value) => value === undefined || !Number.isFinite(value)) ? undefined : Math.max(...(values as number[]));
};
function atMost(gate: string, observed: number | undefined, limit: number, unit = ''): GateResult {
  return observed === undefined ? { gate, status: 'unmeasured', limit } : { gate, status: observed <= limit ? 'passed' : 'failed', observed, limit, ...(unit ? { detail: unit } : {}) };
}

/** Stage A (minimum acceptable) over a set of trials; the worst trial decides each latency gate. */
export function evaluateStageA(trials: readonly TrialSummary[], expected: { cases: number; trialsPerCase: number }): GateResult[] {
  const complete = new Set(trials.map((t) => t.caseId)).size === expected.cases && trials.length === expected.cases * expected.trialsPerCase;
  const hard = trials.reduce((n, t) => n + t.hardFailures, 0);
  const r10 = worst(trials, 'v2.labelledEntities');
  return [
    { gate: 'all trials present', status: complete ? 'passed' : 'failed', observed: trials.length, limit: expected.cases * expected.trialsPerCase },
    atMost('time to first playable (s) ≤ 20', seconds(worst(trials, 'v2.timeToFirstClipMs')), 20),
    atMost('full generation (s) ≤ 60', seconds(worst(trials, 'v2.totalMs')), 60),
    atMost('render + encode (s) ≤ 10', seconds(worst(trials, 'v2.encodeMs')), 10),
    { gate: 'hard semantic failures = 0', status: hard === 0 ? 'passed' : 'failed', observed: hard, limit: 0 },
    atMost('labelled-box fallbacks (worst trial) = 0', r10, 0),
    trials.every((t) => t.wrongIcons !== undefined)
      ? { gate: 'wrong icons = 0', status: trials.every((t) => t.wrongIcons === 0) ? 'passed' : 'failed', observed: trials.reduce((n, t) => n + (t.wrongIcons ?? 0), 0), limit: 0 }
      : { gate: 'wrong icons = 0', status: 'unmeasured', detail: 'needs independent muted-board review' },
  ];
}

/** True only when every gate passed; anything failed or unmeasured blocks acceptance. */
export const stageAccepted = (gates: readonly GateResult[]): boolean => gates.every((gate) => gate.status === 'passed');

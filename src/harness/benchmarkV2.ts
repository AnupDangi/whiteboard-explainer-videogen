import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isArtifactStatus, type ArtifactStatus } from '../shared/artifactStatus.js';

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

export interface TrialSummary {
  caseId: string;
  trial: number;
  status: ArtifactStatus;
  metrics: Record<string, number>;
  /** Missing is unknown evidence, never a zero-failure result. */
  hardFailures?: number;
  /** Set only after verifying the immutable run manifest, lock, playable media and hashes. */
  artifactsComplete?: boolean;
  /** Explicit terminal outcome from the runner; absence cannot establish a crash-free batch. */
  infrastructureCrash?: boolean;
  /** Count of coercions or repairs omitted from the recorded candidate operation history. */
  silentRepairs?: number;
  /** V2 metrics use a monotonic clock from request acceptance. */
  requestStarted?: boolean;
  cold?: boolean;
  wrongIcons?: number;
  majorR10OnlyClaims?: number;
  /** Cost gate cannot pass unless every provider component, including TTS, has a USD value. */
  totalCostUsd?: number;
  ttsUsdKnown?: boolean;
  /** Digest of the pipeline implementation recorded by the verified V2 lesson lock. */
  pipelineDigest?: string;
  /** Hash of the effective run configuration, independent from the source-code digest. */
  configHash?: string;
  /** Hash of the changed-test and baseline inventory sealed in runner evidence. */
  testBaselineInventorySha256?: string;
  /** False means test or baseline files changed while this trial was running. */
  testBaselineInventoryStable?: boolean;
  /** Sum of board and speech fallbacks; a fallback cannot be a release-passing trial. */
  fallbackCount?: number;
}
export type GateStatus = 'passed' | 'failed' | 'unmeasured';
export interface GateResult { gate: string; status: GateStatus; observed?: number; limit?: number; detail?: string }

const seconds = (ms: number | undefined): number | undefined => (ms === undefined ? undefined : ms / 1000);
const worst = (trials: readonly TrialSummary[], key: string): number | undefined => {
  if (trials.length === 0) return undefined;
  const values = trials.map((trial) => trial.metrics[key]);
  return values.some((value) => value === undefined || !Number.isFinite(value) || value < 0) ? undefined : Math.max(...(values as number[]));
};
const COMPLETE_PIPELINE_DIGEST = /^pipeline-source\/v2:[a-f0-9]{40,64}:[a-f0-9]{64}$/u;
const SHA256_DIGEST = /^[a-f0-9]{64}$/u;
function atMost(gate: string, observed: number | undefined, limit: number, unit = ''): GateResult {
  return observed === undefined ? { gate, status: 'unmeasured', limit } : { gate, status: observed <= limit ? 'passed' : 'failed', observed, limit, ...(unit ? { detail: unit } : {}) };
}

/** Stage A (minimum acceptable) over a set of trials; the worst trial decides each latency gate. */
export function evaluateStageA(trials: readonly TrialSummary[], expected: { cases: number; trialsPerCase: number; caseIds?: readonly string[] }): GateResult[] {
  const caseIds = expected.caseIds ?? [...new Set(trials.map((t) => t.caseId))];
  const expectedKeys = new Set(caseIds.flatMap((id) => Array.from({ length: expected.trialsPerCase }, (_, i) => `${id}\0${i + 1}`)));
  const seen = new Set<string>();
  let duplicate = false;
  let invalidSlot = false;
  for (const t of trials) {
    const key = `${t.caseId}\0${t.trial}`;
    if (seen.has(key)) duplicate = true;
    seen.add(key);
    if (!expectedKeys.has(key)) invalidSlot = true;
  }
  const complete = !duplicate && !invalidSlot && expectedKeys.size === expected.cases * expected.trialsPerCase && seen.size === expectedKeys.size && [...expectedKeys].every((key) => seen.has(key));
  const fullGrid = complete && expected.cases === 5 && expected.trialsPerCase === 3 && expectedKeys.size === 15;
  const artifacts = fullGrid && trials.every((t) => t.artifactsComplete === true);
  const statusEvidence = fullGrid && trials.every((t) => isArtifactStatus(t.status));
  const isPassing = (status: ArtifactStatus) => status === 'PASSED_AUTOMATED' || status === 'PASSED_REVIEW';
  const releasePassing = statusEvidence ? trials.filter((t) => isPassing(t.status) && t.artifactsComplete === true && t.fallbackCount === 0).length : undefined;
  const numericEvidence = fullGrid && artifacts && trials.every((t) => isPassing(t.status) && t.fallbackCount === 0);
  const numericStatus = (result: GateResult): GateResult => result.status === 'passed' && !numericEvidence
    ? { ...result, status: 'unmeasured', detail: 'requires a complete cold-v2 grid of verified, passed trials' }
    : result;
  const allKnown = <T>(values: readonly (T | undefined)[]): values is readonly T[] => values.length === 15 && values.every((value) => value !== undefined);
  const crashes = trials.map((t) => t.infrastructureCrash);
  const silentRepairs = trials.map((t) => t.silentRepairs);
  const requestTiming = trials.length > 0 && trials.every((t) => t.requestStarted === true);
  const cold = trials.length > 0 && trials.every((t) => t.cold === true);
  const pipelineDigests = trials.map((t) => t.pipelineDigest);
  const knownPipelineDigests = new Set(pipelineDigests.filter((digest): digest is string => typeof digest === 'string' && digest.length > 0));
  const pipelineDigestGate: GateResult = !fullGrid || pipelineDigests.some((digest) => typeof digest !== 'string' || !COMPLETE_PIPELINE_DIGEST.test(digest))
    ? { gate: 'one verified pipeline digest across cold grid', status: 'unmeasured', detail: 'requires a complete compiler working-tree SHA-256 and Git HEAD identity in every lock' }
    : knownPipelineDigests.size === 1
      ? { gate: 'one verified pipeline digest across cold grid', status: 'passed', detail: [...knownPipelineDigests][0] }
      : { gate: 'one verified pipeline digest across cold grid', status: 'failed', detail: `mixed pipeline digests: ${[...knownPipelineDigests].join(', ')}` };
  const configHashes = trials.map((t) => t.configHash);
  const knownConfigHashes = new Set(configHashes.filter((hash): hash is string => typeof hash === 'string' && hash.length > 0));
  const configHashGate: GateResult = !fullGrid || configHashes.some((hash) => typeof hash !== 'string' || hash.length === 0)
    ? { gate: 'one verified run configuration across cold grid', status: 'unmeasured', detail: 'requires a non-empty effective config hash for all 15 trials' }
    : knownConfigHashes.size === 1
      ? { gate: 'one verified run configuration across cold grid', status: 'passed', detail: [...knownConfigHashes][0] }
      : { gate: 'one verified run configuration across cold grid', status: 'failed', detail: `mixed run configuration hashes: ${[...knownConfigHashes].join(', ')}` };
  const changeInventoryHashes = trials.map((t) => t.testBaselineInventorySha256);
  const knownChangeInventoryHashes = new Set(changeInventoryHashes.filter((hash): hash is string => typeof hash === 'string' && SHA256_DIGEST.test(hash)));
  const inventoryStability = trials.map((t) => t.testBaselineInventoryStable);
  const changeInventoryGate: GateResult = inventoryStability.some((stable) => stable === false)
    ? { gate: 'changed test and baseline inventory recorded', status: 'failed', detail: 'test or baseline files changed during a benchmark trial' }
    : !fullGrid || changeInventoryHashes.some((hash) => typeof hash !== 'string' || !SHA256_DIGEST.test(hash)) || inventoryStability.some((stable) => stable !== true)
      ? { gate: 'changed test and baseline inventory recorded', status: 'unmeasured', detail: 'requires stable before/after inventory evidence for all 15 trials' }
      : knownChangeInventoryHashes.size === 1
        ? { gate: 'changed test and baseline inventory recorded', status: 'passed', detail: [...knownChangeInventoryHashes][0] }
        : { gate: 'changed test and baseline inventory recorded', status: 'failed', detail: 'the changed test/baseline inventory differs across trials' };
  const hard = trials.length === 0 || trials.some((t) => t.hardFailures === undefined || !Number.isInteger(t.hardFailures) || t.hardFailures < 0) ? undefined : trials.reduce((n, t) => n + t.hardFailures!, 0);
  const r10 = trials.length === 0 || trials.some((t) => t.majorR10OnlyClaims === undefined || !Number.isInteger(t.majorR10OnlyClaims) || t.majorR10OnlyClaims < 0) ? undefined : Math.max(...trials.map((t) => t.majorR10OnlyClaims!));
  return [
    { gate: 'exact cold-v2 trial slots present once (15/15)', status: fullGrid ? 'passed' : complete ? 'failed' : duplicate || invalidSlot ? 'failed' : 'unmeasured', observed: trials.length, limit: 15, detail: duplicate ? 'duplicate case/trial slot' : invalidSlot ? 'unexpected case/trial slot' : undefined },
    { gate: 'complete verified artifacts (15/15)', status: trials.some((t) => t.artifactsComplete === false) ? 'failed' : !fullGrid || trials.some((t) => t.artifactsComplete === undefined) ? 'unmeasured' : artifacts ? 'passed' : 'failed', observed: trials.filter((t) => t.artifactsComplete === true).length, limit: 15, detail: 'requires a verified lock, manifest, playable audio/video and matching artifact hashes' },
    { gate: 'infrastructure crashes = 0 (15/15)', status: crashes.some((crash) => crash === true) ? 'failed' : !fullGrid || !allKnown(crashes) ? 'unmeasured' : 'passed', ...(allKnown(crashes) ? { observed: crashes.filter(Boolean).length } : {}), limit: 0 },
    { gate: 'silent repairs = 0 (15/15)', status: silentRepairs.some((n) => n !== undefined && n > 0) ? 'failed' : !fullGrid || !allKnown(silentRepairs) || silentRepairs.some((n) => n === undefined || !Number.isInteger(n) || (n !== undefined && n < 0)) ? 'unmeasured' : 'passed', ...(allKnown(silentRepairs) ? { observed: silentRepairs.filter((value): value is number => value !== undefined).reduce((n, value) => n + value, 0) } : {}), limit: 0 },
    { gate: 'release-passing trials ≥ 14/15', status: releasePassing === undefined || trials.some((t) => t.artifactsComplete === undefined) ? 'unmeasured' : releasePassing >= 14 ? 'passed' : 'failed', ...(releasePassing === undefined ? {} : { observed: releasePassing }), limit: 14 },
    { gate: 'cold cache profile', status: trials.some((t) => t.cold === undefined) ? 'unmeasured' : cold ? 'passed' : 'failed' },
    pipelineDigestGate,
    configHashGate,
    changeInventoryGate,
    { gate: 'fallback-free trial outputs', status: trials.some((t) => t.fallbackCount !== undefined && t.fallbackCount > 0) ? 'failed' : !fullGrid || trials.some((t) => t.fallbackCount === undefined || !Number.isInteger(t.fallbackCount) || t.fallbackCount < 0) ? 'unmeasured' : 'passed', ...(trials.every((t) => Number.isInteger(t.fallbackCount) && (t.fallbackCount ?? -1) >= 0) ? { observed: trials.reduce((sum, t) => sum + (t.fallbackCount ?? 0), 0) } : {}), limit: 0 },
    { gate: 'request start timing present', status: trials.some((t) => t.requestStarted === undefined) ? 'unmeasured' : requestTiming ? 'passed' : 'failed' },
    numericStatus(atMost('request to first audible playable (s) ≤ 20', seconds(worst(trials, 'v2.firstAudiblePlayableMs')), 20)),
    numericStatus(atMost('full generation (s) ≤ 60', seconds(worst(trials, 'v2.requestToCompleteMs')), 60)),
    numericStatus(atMost('render + encode (s) ≤ 10', seconds(worst(trials, 'v2.encodeMs')), 10)),
    numericStatus({ gate: 'total lesson cost ≤ $0.10 with TTS valued', status: trials.length === 0 || trials.some((t) => t.totalCostUsd === undefined || !Number.isFinite(t.totalCostUsd) || t.totalCostUsd < 0 || t.ttsUsdKnown !== true) ? 'unmeasured' : Math.max(...trials.map((t) => t.totalCostUsd!)) <= 0.1 ? 'passed' : 'failed', ...(trials.length > 0 && trials.every((t) => t.totalCostUsd !== undefined && Number.isFinite(t.totalCostUsd) && t.totalCostUsd >= 0) ? { observed: Math.max(...trials.map((t) => t.totalCostUsd!)) } : {}), limit: 0.1, detail: 'unpriced TTS credits never establish a USD cost pass' }),
    numericStatus({ gate: 'hard semantic failures = 0', status: hard === undefined ? 'unmeasured' : hard === 0 ? 'passed' : 'failed', ...(hard === undefined ? {} : { observed: hard }), limit: 0 }),
    numericStatus(atMost('major R10-only claims (worst trial) = 0', r10, 0)),
    trials.length > 0 && trials.every((t) => t.wrongIcons !== undefined)
      ? numericStatus({ gate: 'wrong icons = 0', status: trials.every((t) => t.wrongIcons === 0) ? 'passed' : 'failed', observed: trials.reduce((n, t) => n + (t.wrongIcons ?? 0), 0), limit: 0 })
      : { gate: 'wrong icons = 0', status: 'unmeasured', detail: 'needs independent muted-board review' },
  ];
}

/** True only when every gate passed; anything failed or unmeasured blocks acceptance. */
export const stageAccepted = (gates: readonly GateResult[]): boolean => gates.every((gate) => gate.status === 'passed');

/** Process failure evidence wins over a terminal artifact written before exit. */
export function deriveInfrastructureCrash(
  evidence: { spawnError?: string | null; signal?: string | null; exitCode?: number | null } | undefined,
  terminalStatus: ArtifactStatus | undefined,
): boolean | undefined {
  if (!evidence) return undefined;
  if (evidence.spawnError || evidence.signal) return true;
  if (evidence.exitCode !== null && evidence.exitCode !== undefined && evidence.exitCode !== 0) return true;
  if (isArtifactStatus(terminalStatus)) return false;
  return undefined;
}

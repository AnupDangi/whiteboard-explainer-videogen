import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isTransportError, transportCauseCode } from '../llm/openrouter.js';

export interface BudgetLedgerSnapshot {
  schemaVersion: 'hypothesis-budget-ledger/v1';
  budgetUsd: number;
  spentUsd: number;
  calls: number;
  blocked: boolean;
  blockReason?: string;
  uncertainty?: string;
  preflightFailures?: number;
  lastPreflightFailure?: string;
  updatedAt: string;
}

/** Compare durable spend with non-cached provider-stage costs before a run can be reported. */
export function budgetLedgerAccountingProblems(
  snapshot: BudgetLedgerSnapshot,
  stageRuns: Array<{ kind: string; apiCostUsd: number; accountingRole?: 'aggregate' }>,
  toleranceUsd = 0.000001,
): string[] {
  const providerCosts = stageRuns.filter((stage) => stage.kind === 'provider' && stage.accountingRole !== 'aggregate').map((stage) => stage.apiCostUsd);
  if (providerCosts.some((cost) => !Number.isFinite(cost) || cost < 0)) return ['provider stage ledger contains an invalid API cost'];
  if (!Number.isFinite(toleranceUsd) || toleranceUsd < 0) throw new Error('budget accounting tolerance must be finite and non-negative');
  const reportedSpendUsd = providerCosts.reduce((sum, cost) => sum + cost, 0);
  // The durable ledger intentionally carries earlier attempts in the same output directory;
  // the current run's provider stages therefore provide a lower bound, not an equality target.
  if (snapshot.spentUsd + toleranceUsd < reportedSpendUsd) {
    return [`persistent budget ledger reports only $${snapshot.spentUsd.toFixed(6)} spent but this run's provider stages report $${reportedSpendUsd.toFixed(6)}`];
  }
  return [];
}

/**
 * Durable, fail-closed spend accounting for live model calls. The lock is held
 * through the provider request so concurrent stages cannot all observe the
 * same remaining budget. A process crash intentionally leaves the lock behind:
 * spend may be uncertain, so the next run must not silently retry it.
 */
export class PersistentBudgetLedger {
  readonly lockPath: string;

  constructor(readonly filePath: string, readonly budgetUsd: number, readonly lockWaitMs = 300_000) {
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error('budget ledger requires a finite non-negative budget');
    this.lockPath = `${filePath}.lock`;
  }

  async snapshot(): Promise<BudgetLedgerSnapshot> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as BudgetLedgerSnapshot;
      if (value.schemaVersion !== 'hypothesis-budget-ledger/v1' || value.budgetUsd !== this.budgetUsd || !Number.isFinite(value.spentUsd) || !Number.isInteger(value.calls) || typeof value.blocked !== 'boolean') {
        throw new Error(`invalid or incompatible budget ledger at ${this.filePath}`);
      }
      if (value.spentUsd > value.budgetUsd && !value.blocked) {
        throw new Error(`inconsistent budget ledger at ${this.filePath}: recorded spend $${value.spentUsd.toFixed(6)} exceeds the $${value.budgetUsd.toFixed(6)} budget but the ledger is not blocked`);
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { schemaVersion: 'hypothesis-budget-ledger/v1', budgetUsd: this.budgetUsd, spentUsd: 0, calls: 0, blocked: false, updatedAt: new Date(0).toISOString() };
    }
  }

  async call<T>(localRemainingUsd: number, operation: (allowedUsd: number) => Promise<{ value: T; costUsd: number }>): Promise<{ allowed: true; value: T; costUsd: number } | { allowed: false; spentUsd: number }> {
    const release = await this.acquire();
    try {
      const current = await this.snapshot();
      if (current.blocked) throw new Error(`budget ledger is blocked: ${current.blockReason ?? current.uncertainty ?? 'unknown failure'}`);
      const persistentRemainingUsd = Math.max(0, this.budgetUsd - current.spentUsd);
      const allowedUsd = Math.min(Math.max(0, localRemainingUsd), persistentRemainingUsd);
      if (allowedUsd <= 0) return { allowed: false, spentUsd: current.spentUsd };
      let result: { value: T; costUsd: number };
      try {
        result = await operation(allowedUsd);
      } catch (error) {
        const causeCode = transportCauseCode(error);
        // DNS lookup and connection refusal happen before an HTTP request can
        // reach the provider. OpenRouter's "no endpoints found" 404 and an
        // exhausted 429 mean no model endpoint ran. Keep a durable diagnostic
        // without reserving spend, and allow a later retry.
        const definitelyNotDispatched = isTransportError(error);
        if (definitelyNotDispatched) {
          const diagnostic = `${error instanceof Error ? error.message : String(error)} (${causeCode})`;
          const preflight: BudgetLedgerSnapshot = {
            ...current, blocked: false,
            preflightFailures: (current.preflightFailures ?? 0) + 1,
            lastPreflightFailure: diagnostic,
            updatedAt: new Date().toISOString(),
          };
          const temporary = `${this.filePath}.${process.pid}.tmp`;
          await writeFile(temporary, `${JSON.stringify(preflight, null, 2)}\n`, 'utf8');
          await rename(temporary, this.filePath);
          throw error;
        }
        const blocked: BudgetLedgerSnapshot = {
          ...current, blocked: true,
          blockReason: 'provider call outcome is uncertain; refusing further spend',
          uncertainty: `${error instanceof Error ? error.message : String(error)}${causeCode ? ` (${causeCode})` : ''}`,
          updatedAt: new Date().toISOString(),
        };
        const temporary = `${this.filePath}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');
        await rename(temporary, this.filePath);
        throw error;
      }
      if (!Number.isFinite(result.costUsd) || result.costUsd < 0) throw new Error('provider returned invalid cost for budget ledger');
      const nextSpentUsd = current.spentUsd + result.costUsd;
      const exceeded = nextSpentUsd > this.budgetUsd;
      const next: BudgetLedgerSnapshot = {
        ...current, schemaVersion: 'hypothesis-budget-ledger/v1', budgetUsd: this.budgetUsd,
        spentUsd: nextSpentUsd, calls: current.calls + 1, blocked: exceeded,
        ...(exceeded ? { blockReason: `measured provider spend $${nextSpentUsd.toFixed(6)} exceeded the $${this.budgetUsd.toFixed(6)} budget; refusing further calls` } : {}),
        updatedAt: new Date().toISOString(),
      };
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(temporary, this.filePath);
      return { allowed: true, value: result.value, costUsd: result.costUsd };
    } finally {
      await release();
    }
  }

  private async acquire(): Promise<() => Promise<void>> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const started = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        await handle.close();
        return async () => { await unlink(this.lockPath); };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() - started > this.lockWaitMs) throw new Error(`budget ledger lock is held or abandoned at ${this.lockPath}; refusing an unaccounted model call`);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
  }
}

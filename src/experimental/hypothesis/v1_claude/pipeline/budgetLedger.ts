import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  /** Worst-case USD held by calls that are in flight (see PersistentBudgetLedger.call). */
  reservedUsd?: number;
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
 * Durable, fail-closed spend accounting for live model calls.
 *
 * With a worst-case estimate (`reserveUsd`, from the model's published
 * prices) a call reserves that amount under the lock, releases the lock while
 * the provider works, and settles the billed cost afterwards, so concurrent
 * stages run in parallel yet can never jointly exceed the budget. Without an
 * estimate the lock is held through the request (the original serialised
 * behaviour), because the call may spend anything up to the remaining budget.
 *
 * Outcomes: a billed call adds its cost; a call that never reached a model
 * (no endpoint, rate limit, request rejected, aborted in queue) is recorded as
 * a preflight failure; anything else blocks the ledger, because spend is
 * uncertain. A crash while holding the lock leaves it behind on purpose.
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

  async call<T>(
    localRemainingUsd: number,
    operation: (allowedUsd: number) => Promise<{ value: T; costUsd: number }>,
    options: { reserveUsd?: number } = {},
  ): Promise<{ allowed: true; value: T; costUsd: number } | { allowed: false; spentUsd: number; reason: 'exhausted' | 'reservation-exceeds-budget' }> {
    const reserveUsd = options.reserveUsd;
    if (reserveUsd !== undefined && (!Number.isFinite(reserveUsd) || reserveUsd < 0)) throw new Error('budget reservation must be finite and non-negative');
    let release: (() => Promise<void>) | undefined;
    let allowedUsd = 0;
    const waitStarted = Date.now();
    for (;;) {
      release = await this.acquire();
      let waitForInFlight = false;
      try {
        const current = await this.snapshot();
        if (current.blocked) throw new Error(`budget ledger is blocked: ${current.blockReason ?? current.uncertainty ?? 'unknown failure'}`);
        const inFlightUsd = current.reservedUsd ?? 0;
        const persistentRemainingUsd = Math.max(0, this.budgetUsd - current.spentUsd - inFlightUsd);
        allowedUsd = Math.min(Math.max(0, localRemainingUsd), persistentRemainingUsd);
        const fits = reserveUsd === undefined ? allowedUsd > 0 : allowedUsd > 0 && reserveUsd <= allowedUsd;
        // Other calls still hold reservations: their settled cost is usually far below the worst case, so wait for them.
        waitForInFlight = !fits && inFlightUsd > 0 && Date.now() - waitStarted < this.lockWaitMs;
        if (!fits && !waitForInFlight) {
          await release();
          release = undefined;
          return { allowed: false, spentUsd: current.spentUsd, reason: allowedUsd <= 0 ? 'exhausted' : 'reservation-exceeds-budget' };
        }
        if (fits && reserveUsd !== undefined) {
          await this.write({ ...current, reservedUsd: inFlightUsd + reserveUsd, updatedAt: new Date().toISOString() });
          await release();
          release = undefined;
        }
      } catch (error) {
        if (release) await release();
        throw error;
      }
      if (!waitForInFlight) break;
      await release!();
      release = undefined;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    let outcome: { ok: true; value: T; costUsd: number } | { ok: false; error: unknown };
    try {
      const result = await operation(allowedUsd);
      outcome = { ok: true, value: result.value, costUsd: result.costUsd };
    } catch (error) {
      outcome = { ok: false, error };
    }

    if (!release) release = await this.acquire();
    try {
      const current = await this.snapshot();
      const reservedUsd = Math.max(0, (current.reservedUsd ?? 0) - (reserveUsd ?? 0));
      const settled = { ...current, ...(current.reservedUsd !== undefined || reserveUsd !== undefined ? { reservedUsd } : {}) };
      if (!outcome.ok) {
        const error = outcome.error;
        const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
        const causeCode = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: unknown }).code) : '';
        const message = `${error instanceof Error ? error.message : String(error)}${causeCode ? ` (${causeCode})` : ''}`;
        // DNS/connection failures and the provider's own "nothing ran" answers mean no model was billed.
        // The RAG sidecar surfaces its throttling as a plain `RateLimitError ... 429 ...` message with no
        // cause code, and undici surfaces network failures as `TypeError: fetch failed`, so match those too.
        const definitelyNotDispatched = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_REJECTED', 'PROVIDER_NOT_SENT'].includes(causeCode)
          || /\b429\b|rate.?limit|too many requests|fetch failed|failed to fetch|network request failed|socket hang up/i.test(message);
        await this.write(definitelyNotDispatched
          ? { ...settled, blocked: false, preflightFailures: (current.preflightFailures ?? 0) + 1, lastPreflightFailure: message, updatedAt: new Date().toISOString() }
          : { ...settled, blocked: true, blockReason: 'provider call outcome is uncertain; refusing further spend', uncertainty: message, updatedAt: new Date().toISOString() });
        throw error;
      }
      if (!Number.isFinite(outcome.costUsd) || outcome.costUsd < 0) throw new Error('provider returned invalid cost for budget ledger');
      const nextSpentUsd = current.spentUsd + outcome.costUsd;
      const exceeded = nextSpentUsd > this.budgetUsd;
      await this.write({
        ...settled, schemaVersion: 'hypothesis-budget-ledger/v1', budgetUsd: this.budgetUsd,
        spentUsd: nextSpentUsd, calls: current.calls + 1, blocked: exceeded,
        ...(exceeded ? { blockReason: `measured provider spend $${nextSpentUsd.toFixed(6)} exceeded the $${this.budgetUsd.toFixed(6)} budget; refusing further calls` } : {}),
        updatedAt: new Date().toISOString(),
      });
      return { allowed: true, value: outcome.value, costUsd: outcome.costUsd };
    } finally {
      await release();
    }
  }

  private async write(snapshot: BudgetLedgerSnapshot): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
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

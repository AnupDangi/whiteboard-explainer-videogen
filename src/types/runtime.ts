/** Durable execution contracts. These deliberately contain no planner or renderer
 * details so API processes and disposable workers can share the same queue. */
import type {ArtifactReference, DegradationRecord, TaskPool, TaskPriority} from './contracts.js';
export type {ArtifactReference, DegradationRecord, TaskPool, TaskPriority} from './contracts.js';

export type DurableJobStatus =
  | 'queued'
  | 'running'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type DurableTaskStatus =
  | 'blocked'
  | 'queued'
  | 'leased'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface DurableJob {
  id: string;
  status: DurableJobStatus;
  schemaVersion: string;
  request: unknown;
  budgetLimitUsd: number;
  createdAt: number;
  updatedAt: number;
  cancelledAt?: number;
  error?: string;
}

export interface DurableTask {
  id: string;
  jobId: string;
  kind: string;
  pool: TaskPool;
  priority: TaskPriority;
  status: DurableTaskStatus;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  createdAt: number;
  updatedAt: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  heartbeatAt?: number;
  cancelledAt?: number;
  inputArtifactHashes: string[];
  outputArtifactHash?: string;
  degradation?: DegradationRecord;
  lastError?: string;
}

export interface DurableEvent {
  id: string;
  jobId: string;
  sequence: number;
  type: string;
  at: number;
  payload: unknown;
  artifacts: ArtifactReference[];
}

export interface TaskClaim {
  workerId: string;
  pools: readonly TaskPool[];
  leaseMs: number;
  now?: number;
}

export interface UsageReservation {
  id: string;
  jobId: string;
  taskId?: string;
  provider: string;
  providerRequestId?: string;
  amountUsd: number;
  actualAmountUsd?: number;
  status: 'reserved' | 'settled' | 'refunded';
  createdAt: number;
  settledAt?: number;
}

export interface CacheEntry {
  key: string;
  artifactHash: string;
  namespace: string;
  version: string;
  createdAt: number;
  expiresAt?: number;
}

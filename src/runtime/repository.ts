import type {
  ArtifactReference,
  CacheEntry,
  DegradationRecord,
  DurableEvent,
  DurableJob,
  DurableJobStatus,
  DurableTask,
  DurableTaskStatus,
  TaskClaim,
  TaskPool,
  TaskPriority,
  UsageReservation,
} from '../types/runtime.js';

export interface CreateJobInput {
  id: string;
  request: unknown;
  schemaVersion: string;
  budgetLimitUsd?: number;
  idempotencyKey?: string;
  requestHash?: string;
  now?: number;
}

export interface EnqueueTaskInput {
  id: string;
  jobId: string;
  kind: string;
  pool: TaskPool;
  priority: TaskPriority;
  payload?: unknown;
  maxAttempts?: number;
  availableAt?: number;
  dependencyIds?: readonly string[];
  inputArtifactHashes?: readonly string[];
  now?: number;
}

export interface AppendEventInput {
  id: string;
  jobId: string;
  type: string;
  payload?: unknown;
  artifacts?: readonly ArtifactReference[];
  now?: number;
}

export interface CompleteTaskInput {
  taskId: string;
  workerId: string;
  outputArtifactHash?: string;
  degradation?: DegradationRecord;
  now?: number;
}

export interface FailTaskInput {
  taskId: string;
  workerId: string;
  error: string;
  retryAt?: number;
  degradation?: DegradationRecord;
  now?: number;
}

export interface ReserveUsageInput {
  id: string;
  jobId: string;
  taskId?: string;
  provider: string;
  providerRequestId?: string;
  amountUsd: number;
  now?: number;
}

/** Persistence boundary used by the scheduler. Implementations must make claim,
 * completion, event sequencing, and usage settlement atomic. */
export interface RuntimeRepository {
  createJob(input: CreateJobInput): Promise<DurableJob>;
  getJob(id: string): Promise<DurableJob | undefined>;
  listJobs(limit?: number): Promise<DurableJob[]>;
  setJobStatus(id: string, status: DurableJobStatus, error?: string, now?: number): Promise<boolean>;
  cancelJob(id: string, now?: number): Promise<boolean>;

  enqueueTask(input: EnqueueTaskInput): Promise<DurableTask>;
  getTask(id: string): Promise<DurableTask | undefined>;
  listTasks(jobId: string): Promise<DurableTask[]>;
  claimTask(input: TaskClaim): Promise<DurableTask | undefined>;
  heartbeatTask(taskId: string, workerId: string, leaseMs: number, now?: number): Promise<boolean>;
  completeTask(input: CompleteTaskInput): Promise<boolean>;
  failTask(input: FailTaskInput): Promise<DurableTaskStatus | undefined>;
  reapExpiredLeases(now?: number): Promise<number>;

  appendEvent(input: AppendEventInput): Promise<DurableEvent>;
  listEvents(jobId: string, afterSequence?: number, limit?: number): Promise<DurableEvent[]>;

  reserveUsage(input: ReserveUsageInput): Promise<UsageReservation>;
  settleUsage(id: string, actualAmountUsd: number, providerRequestId?: string, now?: number): Promise<UsageReservation | undefined>;
  refundUsage(id: string, now?: number): Promise<UsageReservation | undefined>;

  putArtifact(reference: ArtifactReference, createdAt?: number): Promise<void>;
  getArtifact(hash: string): Promise<ArtifactReference | undefined>;
  putCacheEntry(entry: CacheEntry): Promise<void>;
  getCacheEntry(namespace: string, key: string, version: string, now?: number): Promise<CacheEntry | undefined>;

  acquireSingleFlight(key: string, owner: string, leaseMs: number, now?: number): Promise<boolean>;
  releaseSingleFlight(key: string, owner: string): Promise<boolean>;
}

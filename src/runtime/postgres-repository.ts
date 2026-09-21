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
import type {
  AppendEventInput,
  CompleteTaskInput,
  CreateJobInput,
  EnqueueTaskInput,
  FailTaskInput,
  ReserveUsageInput,
  RuntimeRepository,
} from './repository.js';

interface SqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

/** Structurally compatible with pg.Pool and pg.PoolClient. Keeping this boundary
 * package-free lets core tests run without a database driver. */
export interface SqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

type Row = Record<string, unknown>;
const ms = (value: unknown): number => value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
const optionalMs = (value: unknown): number | undefined => value == null ? undefined : ms(value);
const json = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : value as T;

function jobFromRow(row: Row): DurableJob {
  return {
    id: String(row.id),
    status: String(row.status) as DurableJobStatus,
    schemaVersion: String(row.schema_version),
    request: json(row.request),
    budgetLimitUsd: Number(row.budget_limit_usd),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    cancelledAt: optionalMs(row.cancelled_at),
    error: row.error == null ? undefined : String(row.error),
  };
}

function taskFromRow(row: Row): DurableTask {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    kind: String(row.kind),
    pool: String(row.pool) as TaskPool,
    priority: Number(row.priority) as TaskPriority,
    status: String(row.status) as DurableTaskStatus,
    payload: json(row.payload),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: ms(row.available_at),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    leaseOwner: row.lease_owner == null ? undefined : String(row.lease_owner),
    leaseExpiresAt: optionalMs(row.lease_expires_at),
    heartbeatAt: optionalMs(row.heartbeat_at),
    cancelledAt: optionalMs(row.cancelled_at),
    inputArtifactHashes: json<string[]>(row.input_artifact_hashes ?? []),
    outputArtifactHash: row.output_artifact_hash == null ? undefined : String(row.output_artifact_hash),
    degradation: row.degradation == null ? undefined : json<DegradationRecord>(row.degradation),
    lastError: row.last_error == null ? undefined : String(row.last_error),
  };
}

function eventFromRow(row: Row): DurableEvent {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    sequence: Number(row.sequence),
    type: String(row.type),
    at: ms(row.created_at),
    payload: json(row.payload),
    artifacts: json<ArtifactReference[]>(row.artifacts),
  };
}

function usageFromRow(row: Row): UsageReservation {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    taskId: row.task_id == null ? undefined : String(row.task_id),
    provider: String(row.provider),
    providerRequestId: row.provider_request_id == null ? undefined : String(row.provider_request_id),
    amountUsd: Number(row.reserved_usd),
    actualAmountUsd: row.actual_usd == null ? undefined : Number(row.actual_usd),
    status: String(row.status) as UsageReservation['status'],
    createdAt: ms(row.created_at),
    settledAt: optionalMs(row.settled_at),
  };
}

export class PostgresRuntimeRepository implements RuntimeRepository {
  constructor(private readonly sql: SqlClient) {}

  async createJob(input: CreateJobInput): Promise<DurableJob> {
    const now = new Date(input.now ?? Date.now());
    if (input.idempotencyKey) {
      const token = await this.sql.query<{resource_id: string; request_hash: string}>(`
        INSERT INTO idempotency_keys(namespace,idempotency_key,request_hash,resource_id,created_at,last_seen_at)
        VALUES ('job',$1,$2,$3,$4,$4)
        ON CONFLICT (namespace,idempotency_key) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at
        RETURNING resource_id,request_hash
      `, [input.idempotencyKey, input.requestHash ?? '', input.id, now]);
      const claimed = token.rows[0];
      if (!claimed || claimed.request_hash !== (input.requestHash ?? '')) throw new Error('Idempotency key reused with a different request');
      if (claimed.resource_id !== input.id) {
        const existing = await this.getJob(claimed.resource_id);
        if (!existing) throw new Error('Idempotency record points to a missing job');
        return existing;
      }
    }
    await this.sql.query(`
      INSERT INTO jobs(id,status,schema_version,request,budget_limit_usd,created_at,updated_at)
      VALUES ($1,'queued',$2,$3::jsonb,$4,$5,$5)
      ON CONFLICT (id) DO NOTHING
    `, [input.id, input.schemaVersion, JSON.stringify(input.request), input.budgetLimitUsd ?? 2, now]);
    const job = await this.getJob(input.id);
    if (!job) throw new Error('Failed to create job');
    return job;
  }

  async getJob(id: string): Promise<DurableJob | undefined> {
    const result = await this.sql.query(`SELECT * FROM jobs WHERE id=$1`, [id]);
    return result.rows[0] && jobFromRow(result.rows[0]);
  }

  async listJobs(limit = 50): Promise<DurableJob[]> {
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const result = await this.sql.query(`SELECT * FROM jobs ORDER BY created_at DESC,id DESC LIMIT $1`, [bounded]);
    return result.rows.map(jobFromRow);
  }

  async setJobStatus(id: string, status: DurableJobStatus, error?: string, now = Date.now()): Promise<boolean> {
    const result = await this.sql.query(`
      UPDATE jobs SET status=$2,error=$3,updated_at=$4,
        cancelled_at=CASE WHEN $2='cancelled' THEN $4 ELSE cancelled_at END
      WHERE id=$1
    `, [id, status, error ?? null, new Date(now)]);
    return (result.rowCount ?? 0) > 0;
  }

  async cancelJob(id: string, now = Date.now()): Promise<boolean> {
    const result = await this.sql.query<{changed: boolean}>(`
      WITH cancelled_job AS (
        UPDATE jobs SET status='cancelled',cancelled_at=$2,updated_at=$2
        WHERE id=$1 AND status NOT IN ('complete','failed','cancelled') RETURNING id
      ), cancelled_tasks AS (
        UPDATE tasks SET status='cancelled',cancelled_at=$2,updated_at=$2,
          lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL
        WHERE job_id=$1 AND status NOT IN ('succeeded','failed','cancelled')
      )
      SELECT EXISTS(SELECT 1 FROM cancelled_job) AS changed
    `, [id, new Date(now)]);
    return Boolean(result.rows[0]?.changed);
  }

  async enqueueTask(input: EnqueueTaskInput): Promise<DurableTask> {
    const now = new Date(input.now ?? Date.now());
    const dependencies = [...new Set(input.dependencyIds ?? [])];
    const result = await this.sql.query(`
      WITH valid_dependencies AS (
        SELECT count(*)::int AS count,
          count(*) FILTER (WHERE status <> 'succeeded')::int AS unfinished
        FROM tasks WHERE id=ANY($10::uuid[]) AND job_id=$2
      ), inserted AS (
        INSERT INTO tasks(id,job_id,kind,pool,priority,status,payload,max_attempts,available_at,input_artifact_hashes,created_at,updated_at)
        SELECT $1,$2,$3,$4,$5,
          CASE WHEN valid_dependencies.unfinished=0 THEN 'queued' ELSE 'blocked' END,
          $6::jsonb,$7,$8,$9::text[],$11,$11
        FROM valid_dependencies WHERE valid_dependencies.count=cardinality($10::uuid[])
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      ), dependency_rows AS (
        INSERT INTO task_dependencies(task_id,depends_on_task_id)
        SELECT $1,dependency_id FROM unnest($10::uuid[]) AS dependency_id
        ON CONFLICT DO NOTHING
      )
      SELECT * FROM inserted
    `, [
      input.id,
      input.jobId,
      input.kind,
      input.pool,
      input.priority,
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      new Date(input.availableAt ?? now.getTime()),
      [...(input.inputArtifactHashes ?? [])],
      dependencies,
      now,
    ]);
    if (result.rows[0]) return taskFromRow(result.rows[0]);
    const existing = await this.getTask(input.id);
    if (existing) return existing;
    throw new Error('Task dependencies must exist and belong to the same job');
  }

  async getTask(id: string): Promise<DurableTask | undefined> {
    const result = await this.sql.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    return result.rows[0] && taskFromRow(result.rows[0]);
  }

  async listTasks(jobId: string): Promise<DurableTask[]> {
    const result = await this.sql.query(`SELECT * FROM tasks WHERE job_id=$1 ORDER BY created_at,id`, [jobId]);
    return result.rows.map(taskFromRow);
  }

  async claimTask(input: TaskClaim): Promise<DurableTask | undefined> {
    if (!input.workerId || !Number.isFinite(input.leaseMs) || input.leaseMs <= 0) throw new Error('A worker and positive lease are required');
    if (!input.pools.length) return undefined;
    const now = new Date(input.now ?? Date.now());
    const result = await this.sql.query(`
      WITH candidate AS (
        SELECT task.id
        FROM tasks task
        JOIN jobs job ON job.id=task.job_id
        WHERE task.status='queued'
          AND task.pool=ANY($1::text[])
          AND task.available_at <= $2
          AND (job.status NOT IN ('cancelled','complete','failed')
            OR (job.status='complete' AND task.kind='export.render'))
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies dependency
            JOIN tasks parent ON parent.id=dependency.depends_on_task_id
            WHERE dependency.task_id=task.id AND parent.status <> 'succeeded'
          )
        ORDER BY task.priority,task.available_at,task.created_at,task.id
        FOR UPDATE OF task SKIP LOCKED
        LIMIT 1
      )
      UPDATE tasks task SET status='leased',lease_owner=$3,
        lease_expires_at=$2 + ($4 * interval '1 millisecond'),heartbeat_at=$2,
        attempts=task.attempts+1,updated_at=$2
      FROM candidate WHERE task.id=candidate.id
      RETURNING task.*
    `, [[...input.pools], now, input.workerId, input.leaseMs]);
    const task = result.rows[0] && taskFromRow(result.rows[0]);
    if (task) await this.sql.query(`UPDATE jobs SET status='running',updated_at=$2 WHERE id=$1 AND status='queued'`, [task.jobId, now]);
    return task;
  }

  async heartbeatTask(taskId: string, workerId: string, leaseMs: number, now = Date.now()): Promise<boolean> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');
    const at = new Date(now);
    const result = await this.sql.query(`
      UPDATE tasks SET heartbeat_at=$3,lease_expires_at=$3 + ($4 * interval '1 millisecond'),updated_at=$3
      WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_expires_at>$3
    `, [taskId, workerId, at, leaseMs]);
    return (result.rowCount ?? 0) > 0;
  }

  async completeTask(input: CompleteTaskInput): Promise<boolean> {
    const now = new Date(input.now ?? Date.now());
    const result = await this.sql.query<{completed: boolean}>(`
      WITH completed AS (
        UPDATE tasks SET status='succeeded',output_artifact_hash=$3,degradation=$4::jsonb,
          lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=$5
        WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_expires_at>$5
        RETURNING job_id
      ), released AS (
        UPDATE tasks child SET status='queued',updated_at=$5
        WHERE child.job_id IN (SELECT job_id FROM completed) AND child.status='blocked'
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies dependency
            JOIN tasks parent ON parent.id=dependency.depends_on_task_id
            WHERE dependency.task_id=child.id AND parent.status <> 'succeeded'
              AND dependency.depends_on_task_id <> $1
          )
      )
      SELECT EXISTS(SELECT 1 FROM completed) AS completed
    `, [input.taskId, input.workerId, input.outputArtifactHash ?? null, input.degradation ? JSON.stringify(input.degradation) : null, now]);
    return Boolean(result.rows[0]?.completed);
  }

  async failTask(input: FailTaskInput): Promise<DurableTaskStatus | undefined> {
    const now = new Date(input.now ?? Date.now());
    const result = await this.sql.query(`
      UPDATE tasks SET
        status=CASE WHEN attempts<max_attempts THEN 'queued' ELSE 'failed' END,
        available_at=$4,last_error=$3,degradation=$5::jsonb,
        lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=$6
      WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_expires_at>$6
      RETURNING status
    `, [input.taskId, input.workerId, input.error, new Date(input.retryAt ?? now.getTime()), input.degradation ? JSON.stringify(input.degradation) : null, now]);
    return result.rows[0]?.status as DurableTaskStatus | undefined;
  }

  async reapExpiredLeases(now = Date.now()): Promise<number> {
    const result = await this.sql.query(`
      UPDATE tasks task SET
        status=CASE WHEN job.status='cancelled' THEN 'cancelled' WHEN task.attempts<task.max_attempts THEN 'queued' ELSE 'failed' END,
        last_error=COALESCE(task.last_error,'Worker lease expired'),
        lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=$1
      FROM jobs job
      WHERE task.job_id=job.id AND task.status='leased' AND task.lease_expires_at<=$1
      RETURNING task.id
    `, [new Date(now)]);
    return result.rowCount ?? result.rows.length;
  }

  async appendEvent(input: AppendEventInput): Promise<DurableEvent> {
    const result = await this.sql.query(`
      WITH existing AS (
        SELECT * FROM job_events WHERE id=$1
      ), next_sequence AS (
        UPDATE jobs SET event_sequence=event_sequence+1,updated_at=$6
        WHERE id=$2 AND NOT EXISTS (SELECT 1 FROM existing)
        RETURNING event_sequence
      ), inserted AS (
        INSERT INTO job_events(id,job_id,sequence,type,payload,artifacts,created_at)
        SELECT $1,$2,event_sequence,$3,$4::jsonb,$5::jsonb,$6 FROM next_sequence
        ON CONFLICT (id) DO NOTHING RETURNING *
      )
      SELECT * FROM inserted UNION ALL SELECT * FROM existing LIMIT 1
    `, [input.id, input.jobId, input.type, JSON.stringify(input.payload ?? {}), JSON.stringify(input.artifacts ?? []), new Date(input.now ?? Date.now())]);
    if (!result.rows[0]) throw new Error(`Unknown job ${input.jobId}`);
    return eventFromRow(result.rows[0]);
  }

  async listEvents(jobId: string, afterSequence = 0, limit = 100): Promise<DurableEvent[]> {
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const result = await this.sql.query(`
      SELECT * FROM job_events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3
    `, [jobId, afterSequence, bounded]);
    return result.rows.map(eventFromRow);
  }

  async reserveUsage(input: ReserveUsageInput): Promise<UsageReservation> {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0) throw new Error('Reservation amount must be non-negative');
    const result = await this.sql.query(`
      WITH locked_job AS (
        SELECT id,budget_limit_usd FROM jobs WHERE id=$2 FOR UPDATE
      ), current_usage AS (
        SELECT COALESCE(sum(CASE WHEN status='reserved' THEN reserved_usd ELSE actual_usd END),0) AS committed_usd
        FROM usage_reservations WHERE job_id=$2 AND status IN ('reserved','settled')
      ), inserted AS (
        INSERT INTO usage_reservations(id,job_id,task_id,provider,provider_request_id,reserved_usd,status,created_at)
        SELECT $1,$2,$3,$4,$5,$6,'reserved',$7 FROM locked_job,current_usage
        WHERE current_usage.committed_usd+$6 <= locked_job.budget_limit_usd
        ON CONFLICT DO NOTHING RETURNING *
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM usage_reservations
      WHERE id=$1 OR ($5::text IS NOT NULL AND provider=$4 AND provider_request_id=$5)
      LIMIT 1
    `, [input.id, input.jobId, input.taskId ?? null, input.provider, input.providerRequestId ?? null, input.amountUsd, new Date(input.now ?? Date.now())]);
    if (!result.rows[0]) throw new Error('Paid API budget would be exceeded');
    return usageFromRow(result.rows[0]);
  }

  async settleUsage(id: string, actualAmountUsd: number, providerRequestId?: string, now = Date.now()): Promise<UsageReservation | undefined> {
    if (!Number.isFinite(actualAmountUsd) || actualAmountUsd < 0) throw new Error('Actual amount must be non-negative');
    const result = await this.sql.query(`
      UPDATE usage_reservations SET status='settled',actual_usd=$2,
        provider_request_id=COALESCE(provider_request_id,$3),settled_at=$4
      WHERE id=$1 AND status='reserved' RETURNING *
    `, [id, actualAmountUsd, providerRequestId ?? null, new Date(now)]);
    if (result.rows[0]) return usageFromRow(result.rows[0]);
    const existing = await this.sql.query(`SELECT * FROM usage_reservations WHERE id=$1`, [id]);
    return existing.rows[0] && usageFromRow(existing.rows[0]);
  }

  async refundUsage(id: string, now = Date.now()): Promise<UsageReservation | undefined> {
    const result = await this.sql.query(`
      UPDATE usage_reservations SET status='refunded',actual_usd=0,settled_at=$2
      WHERE id=$1 AND status='reserved' RETURNING *
    `, [id, new Date(now)]);
    if (result.rows[0]) return usageFromRow(result.rows[0]);
    const existing = await this.sql.query(`SELECT * FROM usage_reservations WHERE id=$1`, [id]);
    return existing.rows[0] && usageFromRow(existing.rows[0]);
  }

  async putArtifact(reference: ArtifactReference, createdAt = Date.now()): Promise<void> {
    const result = await this.sql.query(`
      INSERT INTO artifacts(hash,uri,kind,byte_size,media_type,artifact_version,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (hash) DO NOTHING
    `, [reference.hash, reference.storeKey, reference.kind, reference.sizeBytes, reference.mediaType, reference.version, new Date(createdAt)]);
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.getArtifact(reference.hash);
      const same = existing
        && existing.storeKey === reference.storeKey
        && existing.kind === reference.kind
        && existing.sizeBytes === reference.sizeBytes
        && existing.mediaType === reference.mediaType
        && existing.version === reference.version;
      if (!same) throw new Error('Artifact hash metadata conflict');
    }
  }

  async getArtifact(hash: string): Promise<ArtifactReference | undefined> {
    const result = await this.sql.query(`SELECT * FROM artifacts WHERE hash=$1`, [hash]);
    const row = result.rows[0];
    return row && {
      hash: String(row.hash).trim(),
      storeKey: String(row.uri),
      kind: String(row.kind),
      sizeBytes: Number(row.byte_size),
      mediaType: String(row.media_type),
      version: String(row.artifact_version),
    };
  }

  async putCacheEntry(entry: CacheEntry): Promise<void> {
    await this.sql.query(`
      INSERT INTO cache_entries(namespace,cache_key,version,artifact_hash,created_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (namespace,cache_key,version) DO UPDATE SET
        artifact_hash=EXCLUDED.artifact_hash,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at
    `, [entry.namespace, entry.key, entry.version, entry.artifactHash, new Date(entry.createdAt), entry.expiresAt === undefined ? null : new Date(entry.expiresAt)]);
  }

  async getCacheEntry(namespace: string, key: string, version: string, now = Date.now()): Promise<CacheEntry | undefined> {
    const result = await this.sql.query(`
      SELECT * FROM cache_entries
      WHERE namespace=$1 AND cache_key=$2 AND version=$3 AND (expires_at IS NULL OR expires_at>$4)
    `, [namespace, key, version, new Date(now)]);
    const row = result.rows[0];
    return row && {
      namespace: String(row.namespace),
      key: String(row.cache_key),
      version: String(row.version),
      artifactHash: String(row.artifact_hash).trim(),
      createdAt: ms(row.created_at),
      expiresAt: optionalMs(row.expires_at),
    };
  }

  async acquireSingleFlight(key: string, owner: string, leaseMs: number, now = Date.now()): Promise<boolean> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');
    const at = new Date(now);
    const result = await this.sql.query(`
      INSERT INTO single_flight_locks(flight_key,owner,lease_expires_at,created_at,updated_at)
      VALUES ($1,$2,$3 + ($4 * interval '1 millisecond'),$3,$3)
      ON CONFLICT (flight_key) DO UPDATE SET owner=EXCLUDED.owner,
        lease_expires_at=EXCLUDED.lease_expires_at,updated_at=EXCLUDED.updated_at
      WHERE single_flight_locks.lease_expires_at<=$3 OR single_flight_locks.owner=$2
      RETURNING flight_key
    `, [key, owner, at, leaseMs]);
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async releaseSingleFlight(key: string, owner: string): Promise<boolean> {
    const result = await this.sql.query(`DELETE FROM single_flight_locks WHERE flight_key=$1 AND owner=$2`, [key, owner]);
    return (result.rowCount ?? 0) > 0;
  }
}

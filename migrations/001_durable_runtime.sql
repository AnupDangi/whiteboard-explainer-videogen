BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('queued','running','partial','complete','failed','cancelled')),
  schema_version text NOT NULL,
  request jsonb NOT NULL,
  budget_limit_usd numeric(14,8) NOT NULL CHECK (budget_limit_usd > 0),
  event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
  error text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  pool text NOT NULL CHECK (pool IN ('ingest','llm','tts','compile','render')),
  priority smallint NOT NULL CHECK (priority BETWEEN 0 AND 4),
  status text NOT NULL CHECK (status IN ('blocked','queued','leased','succeeded','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancelled_at timestamptz,
  input_artifact_hashes text[] NOT NULL DEFAULT '{}',
  output_artifact_hash text,
  degradation jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS job_events (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  id uuid NOT NULL UNIQUE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS usage_reservations (
  id text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_request_id text,
  reserved_usd numeric(14,8) NOT NULL CHECK (reserved_usd >= 0),
  actual_usd numeric(14,8) CHECK (actual_usd >= 0),
  status text NOT NULL CHECK (status IN ('reserved','settled','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS artifacts (
  hash char(64) PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  uri text NOT NULL,
  kind text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  media_type text NOT NULL,
  artifact_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cache_entries (
  namespace text NOT NULL,
  cache_key text NOT NULL,
  version text NOT NULL,
  artifact_hash char(64) NOT NULL REFERENCES artifacts(hash),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (namespace, cache_key, version)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  namespace text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, idempotency_key)
);

CREATE TABLE IF NOT EXISTS single_flight_locks (
  flight_key text PRIMARY KEY,
  owner text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_claim_idx
  ON tasks (pool, priority, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS tasks_expired_lease_idx
  ON tasks (lease_expires_at)
  WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS tasks_job_idx ON tasks (job_id, created_at);
CREATE INDEX IF NOT EXISTS task_dependencies_parent_idx ON task_dependencies (depends_on_task_id);
CREATE INDEX IF NOT EXISTS job_events_replay_idx ON job_events (job_id, sequence);
CREATE INDEX IF NOT EXISTS cache_entries_expiry_idx ON cache_entries (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_job_idx ON usage_reservations (job_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS usage_provider_request_idx
  ON usage_reservations (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

COMMIT;

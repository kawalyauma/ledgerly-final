CREATE TABLE IF NOT EXISTS backend_jobs (
  id uuid PRIMARY KEY,
  queue text NOT NULL DEFAULT 'default',
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS backend_jobs_claim_idx
  ON backend_jobs (status, available_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS backend_jobs_kind_idx ON backend_jobs (kind, status, created_at);
CREATE INDEX IF NOT EXISTS backend_jobs_locked_idx ON backend_jobs (locked_at) WHERE status = 'running';

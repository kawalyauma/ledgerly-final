CREATE OR REPLACE FUNCTION ledgerly_datetime(base_ts timestamptz, modifier text)
RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
  IF modifier IS NULL OR btrim(modifier) = '' THEN RETURN base_ts; END IF;
  IF lower(btrim(modifier)) = 'start of day' THEN RETURN date_trunc('day', base_ts); END IF;
  RETURN base_ts + modifier::interval;
EXCEPTION WHEN others THEN
  RAISE EXCEPTION 'Unsupported SQLite datetime modifier: %', modifier;
END;
$$;

CREATE TABLE IF NOT EXISTS selfhost_jobs (
  id text PRIMARY KEY, queue_name text NOT NULL, payload jsonb NOT NULL, content_type text NOT NULL DEFAULT 'json',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','dead')),
  attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, locked_at timestamptz, locked_by text, last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_selfhost_jobs_ready ON selfhost_jobs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_selfhost_jobs_queue ON selfhost_jobs (queue_name, status, available_at);

CREATE TABLE IF NOT EXISTS selfhost_scheduled_runs (
  cron text NOT NULL, run_key text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  error text, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at timestamptz,
  PRIMARY KEY (cron, run_key)
);

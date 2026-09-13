CREATE TABLE schoolpay_reconciliation_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  fetched_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  posted_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  ignored_count integer NOT NULL DEFAULT 0,
  return_code integer,
  return_message text,
  error text,
  created_by text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(to_date>=from_date),
  CHECK(to_date-from_date<=30)
);
CREATE INDEX schoolpay_reconciliation_org_started_idx ON schoolpay_reconciliation_runs(organization_id,started_at DESC);

ALTER TABLE schoolpay_events
  ADD COLUMN capture_source text NOT NULL DEFAULT 'webhook' CHECK(capture_source IN ('webhook','sync','adhoc')),
  ADD COLUMN reconciliation_run_id text REFERENCES schoolpay_reconciliation_runs(id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX schoolpay_events_reconciliation_idx ON schoolpay_events(reconciliation_run_id) WHERE reconciliation_run_id IS NOT NULL;

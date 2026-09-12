CREATE TABLE report_jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  report_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('json','csv','xlsx','pdf')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters)='object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  queue_job_id text,
  object_key text,
  content_type text,
  size_bytes bigint,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX report_jobs_org_created_idx ON report_jobs (organization_id,created_at DESC);
CREATE INDEX report_jobs_pending_idx ON report_jobs (status,created_at) WHERE status IN ('queued','running');

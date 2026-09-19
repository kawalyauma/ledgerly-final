ALTER TABLE lai_incidents
  ADD COLUMN IF NOT EXISTS signal_type TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS http_status INTEGER,
  ADD COLUMN IF NOT EXISTS module_key TEXT,
  ADD COLUMN IF NOT EXISTS assigned_agent_key TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS latest_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_name TEXT,
  ADD COLUMN IF NOT EXISTS workspace_path TEXT,
  ADD COLUMN IF NOT EXISTS base_sha TEXT,
  ADD COLUMN IF NOT EXISTS fix_sha TEXT,
  ADD COLUMN IF NOT EXISTS change_risk TEXT CHECK(change_risk IS NULL OR change_risk IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS production_approval_id TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lai_incidents_active_fingerprint
  ON lai_incidents(fingerprint,last_seen_at DESC)
  WHERE status NOT IN ('closed','failed');
CREATE INDEX IF NOT EXISTS idx_lai_incidents_assignment
  ON lai_incidents(assigned_agent_key,status,severity,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS lai_incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  organization_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('system','user','agent')),
  actor_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_incident_events_timeline
  ON lai_incident_events(incident_id,created_at,id);

CREATE TABLE IF NOT EXISTS lai_incident_checks (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  organization_id TEXT,
  check_type TEXT NOT NULL CHECK(check_type IN ('reproduction','test','typecheck','build','qa','smoke','health')),
  command_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','passed','failed','skipped')),
  duration_ms INTEGER,
  output_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lai_incident_checks
  ON lai_incident_checks(incident_id,created_at);

CREATE TABLE IF NOT EXISTS lai_incident_deployments (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  organization_id TEXT,
  environment TEXT NOT NULL CHECK(environment IN ('staging','production')),
  status TEXT NOT NULL CHECK(status IN ('preparing','deployed','verified','failed','rolled_back')),
  project_key TEXT,
  image_tag TEXT,
  previous_ref TEXT,
  deployed_ref TEXT,
  smoke_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lai_incident_deployments
  ON lai_incident_deployments(incident_id,environment,created_at DESC);

ALTER TABLE lai_approvals
  ADD COLUMN IF NOT EXISTS incident_id TEXT;
CREATE INDEX IF NOT EXISTS idx_lai_approvals_incident
  ON lai_approvals(organization_id,incident_id,status,created_at DESC)
  WHERE incident_id IS NOT NULL;

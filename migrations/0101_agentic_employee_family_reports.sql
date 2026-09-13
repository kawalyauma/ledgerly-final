CREATE TABLE IF NOT EXISTS ae_family_reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT,
  created_by TEXT NOT NULL,
  requested_agent_key TEXT NOT NULL,
  guardian_id TEXT,
  guardian_query TEXT NOT NULL,
  student_filter_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ae_family_reports_org_created
  ON ae_family_reports(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ae_family_reports_guardian
  ON ae_family_reports(organization_id, guardian_id, created_at);

CREATE TABLE IF NOT EXISTS ae_delegations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  parent_conversation_id TEXT,
  child_conversation_id TEXT,
  from_agent_key TEXT NOT NULL,
  to_agent_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  response_text TEXT,
  model TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ae_delegations_parent
  ON ae_delegations(organization_id, parent_conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ae_delegations_recent
  ON ae_delegations(organization_id, created_at);

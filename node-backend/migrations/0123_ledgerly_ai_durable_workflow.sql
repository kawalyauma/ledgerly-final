CREATE TABLE IF NOT EXISTS lai_incident_workflow_steps (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES lai_incidents(id) ON DELETE CASCADE,
  organization_id text,
  step_key text NOT NULL,
  agent_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  attempt integer NOT NULL DEFAULT 1,
  operation_key text NOT NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(incident_id,step_key,attempt),
  UNIQUE(operation_key)
);

CREATE INDEX IF NOT EXISTS lai_incident_workflow_steps_recovery_idx
  ON lai_incident_workflow_steps(status,heartbeat_at)
  WHERE status='running';

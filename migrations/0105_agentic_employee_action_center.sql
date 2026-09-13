CREATE TABLE IF NOT EXISTS ae_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_id TEXT,
  reaction_id TEXT,
  agent_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  required_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','prepared','awaiting_approval','approved','executed','failed','dismissed')),
  approval_id TEXT,
  result_entity_type TEXT,
  result_entity_id TEXT,
  failure_text TEXT,
  prepared_by TEXT,
  prepared_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  executed_by TEXT,
  executed_at TEXT,
  dismissed_by TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ae_actions_org_status ON ae_actions(organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_actions_event ON ae_actions(organization_id,event_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_actions_approval ON ae_actions(organization_id,approval_id) WHERE approval_id IS NOT NULL;

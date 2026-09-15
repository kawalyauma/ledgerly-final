-- AI Workforce v2.0: governed dynamic intelligence, clarification state and query auditing.
CREATE TABLE IF NOT EXISTS ae_query_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '{}',
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
  error_text TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ae_query_audit_org_created_idx
  ON ae_query_audit(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ae_query_audit_conversation_idx
  ON ae_query_audit(organization_id,conversation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS ae_pending_intents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_information' CHECK(status IN ('awaiting_information','ready','action_prepared','completed','cancelled')),
  draft_json TEXT NOT NULL DEFAULT '{}',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  candidates_json TEXT NOT NULL DEFAULT '{}',
  clarification_prompt TEXT,
  action_id TEXT REFERENCES ae_actions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ae_pending_intents_conversation_idx
  ON ae_pending_intents(organization_id,conversation_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS ae_pending_intents_action_idx
  ON ae_pending_intents(organization_id,action_id);

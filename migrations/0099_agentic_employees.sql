-- Agentic Employees: tenant-scoped AI workforce state, audit and approvals.
CREATE TABLE IF NOT EXISTS ae_agent_settings (
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  model_tier TEXT NOT NULL DEFAULT 'luna' CHECK(model_tier IN ('luna','terra','sol')),
  system_prompt TEXT,
  tool_allowlist_json TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, agent_key)
);

CREATE TABLE IF NOT EXISTS ae_conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','archived')),
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ae_conversations_org_recent ON ae_conversations(organization_id,last_message_at,created_at);

CREATE TABLE IF NOT EXISTS ae_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  user_id TEXT,
  model TEXT,
  provider_response_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ae_messages_conversation ON ae_messages(organization_id,conversation_id,created_at);

CREATE TABLE IF NOT EXISTS ae_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  conversation_id TEXT,
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','waiting_approval','completed','failed','cancelled')),
  result_text TEXT,
  error_text TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ae_tasks_org_status ON ae_tasks(organization_id,status,created_at);

CREATE TABLE IF NOT EXISTS ae_tool_calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','denied')),
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ae_tool_calls_org_recent ON ae_tool_calls(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_tool_calls_conversation ON ae_tool_calls(organization_id,conversation_id,created_at);

CREATE TABLE IF NOT EXISTS ae_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT,
  task_id TEXT,
  agent_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  action_type TEXT NOT NULL,
  required_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','executed','failed','cancelled')),
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  executed_at TEXT,
  execution_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ae_approvals_org_status ON ae_approvals(organization_id,status,created_at);

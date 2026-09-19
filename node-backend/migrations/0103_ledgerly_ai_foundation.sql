CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lai_settings (
  organization_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_agent_id TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lai_agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('built-in','custom','engineering')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','active','paused','disabled')),
  capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_allowlist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_scope TEXT NOT NULL DEFAULT 'agent' CHECK (memory_scope IN ('chat','user','agent','organization','project')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_lai_agents_org_status ON lai_agents(organization_id,status,agent_key);

CREATE TABLE IF NOT EXISTS lai_chats (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  agent_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_chats_org_recent ON lai_chats(organization_id,status,last_message_at DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS lai_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  user_id TEXT,
  agent_id TEXT,
  correlation_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_messages_chat ON lai_messages(organization_id,chat_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_lai_messages_correlation ON lai_messages(correlation_id);

CREATE TABLE IF NOT EXISTS lai_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  agent_id TEXT,
  chat_id TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','completed','failed','cancelled')),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  correlation_id TEXT NOT NULL,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  error_text TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_jobs_org_status ON lai_jobs(organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_jobs_correlation ON lai_jobs(correlation_id);

CREATE TABLE IF NOT EXISTS lai_provider_executions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  job_id TEXT,
  provider_internal TEXT NOT NULL CHECK (provider_internal IN ('codex','claude-code')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
  correlation_id TEXT NOT NULL,
  exit_code INTEGER,
  error_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_provider_exec_job ON lai_provider_executions(organization_id,job_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_provider_exec_correlation ON lai_provider_executions(correlation_id);

CREATE TABLE IF NOT EXISTS lai_memories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('chat','user','agent','organization','project')),
  scope_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  source_type TEXT NOT NULL DEFAULT 'conversation',
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','deleted')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_memory_scope ON lai_memories(organization_id,scope_type,scope_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS lai_tool_calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  job_id TEXT,
  chat_id TEXT,
  agent_id TEXT,
  tool_name TEXT NOT NULL,
  arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','denied','waiting_approval')),
  correlation_id TEXT NOT NULL,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lai_tool_calls_org_recent ON lai_tool_calls(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_tool_calls_correlation ON lai_tool_calls(correlation_id);

CREATE TABLE IF NOT EXISTS lai_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','fixing','testing','staging','awaiting_approval','deployed','verified','closed','failed')),
  assigned_agent_id TEXT,
  correlation_id TEXT,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_json JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_incidents_status ON lai_incidents(status,severity,detected_at);
CREATE INDEX IF NOT EXISTS idx_lai_incidents_fingerprint ON lai_incidents(fingerprint,detected_at);

CREATE TABLE IF NOT EXISTS lai_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  agent_id TEXT,
  job_id TEXT,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','executed')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_approvals_org_status ON lai_approvals(organization_id,status,created_at);

CREATE TABLE IF NOT EXISTS lai_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  correlation_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_audit_org_recent ON lai_audit_events(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_audit_correlation ON lai_audit_events(correlation_id);

CREATE TABLE IF NOT EXISTS lai_agent_builder_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  forge_chat_id TEXT,
  operation TEXT NOT NULL DEFAULT 'create' CHECK(operation IN ('create','clone','revise')),
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK(status IN ('collecting','review','testing','ready','activated','closed')),
  spec_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  readiness_score INTEGER NOT NULL DEFAULT 0 CHECK(readiness_score BETWEEN 0 AND 100),
  proposed_agent_id TEXT,
  source_agent_id TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_builder_sessions_owner
  ON lai_agent_builder_sessions(organization_id,created_by,updated_at DESC);

CREATE TABLE IF NOT EXISTS lai_agent_builder_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_builder_messages_session
  ON lai_agent_builder_messages(organization_id,session_id,created_at,id);

CREATE TABLE IF NOT EXISTS lai_agent_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  spec_json JSONB NOT NULL,
  change_note TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,agent_id,version)
);
CREATE INDEX IF NOT EXISTS idx_lai_agent_versions_recent
  ON lai_agent_versions(organization_id,agent_id,version DESC);

CREATE TABLE IF NOT EXISTS lai_agent_sandbox_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response_text TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','completed','failed')),
  error_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lai_agent_sandbox_session
  ON lai_agent_sandbox_runs(organization_id,session_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lai_custom_agents_owner
  ON lai_agents(organization_id,created_by,status,updated_at DESC)
  WHERE kind='custom';

UPDATE lai_agent_templates
SET permissions_json='["school:read","work:read","admin:read"]'::jsonb,
    capabilities_json='["agent-design","requirements-discovery","permission-guidance","capability-design","sandbox-planning","agent-preview","agent-versioning"]'::jsonb,
    tool_allowlist_json='["agent.spec","tool.catalog","permission.inspect","agent.test"]'::jsonb,
    updated_at=CURRENT_TIMESTAMP
WHERE agent_key='forge';

UPDATE lai_agents a SET
  permissions_json=t.permissions_json,
  capabilities_json=t.capabilities_json,
  tool_allowlist_json=t.tool_allowlist_json,
  updated_at=CURRENT_TIMESTAMP
FROM lai_agent_templates t
WHERE a.kind='built-in' AND a.agent_key='forge' AND t.agent_key='forge';

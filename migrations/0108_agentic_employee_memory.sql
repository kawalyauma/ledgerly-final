CREATE TABLE IF NOT EXISTS ae_memories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK(memory_type IN ('working','institutional')),
  visibility TEXT NOT NULL DEFAULT 'agent' CHECK(visibility IN ('agent','organization')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  due_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_conversation_id TEXT,
  source_message_id TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  completed_at TEXT,
  archived_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((memory_type='working' AND status IN ('open','in_progress','waiting','done','cancelled')) OR (memory_type='institutional' AND status IN ('active','archived')))
);
CREATE INDEX IF NOT EXISTS idx_ae_memory_agent ON ae_memories(organization_id,agent_key,memory_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_memory_due ON ae_memories(organization_id,memory_type,status,due_at);
CREATE INDEX IF NOT EXISTS idx_ae_memory_org_shared ON ae_memories(organization_id,visibility,memory_type,status,updated_at DESC);

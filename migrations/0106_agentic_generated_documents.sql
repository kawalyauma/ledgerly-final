CREATE TABLE IF NOT EXISTS ae_generated_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  conversation_id TEXT,
  action_id TEXT,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('docx','xlsx','pptx')),
  source_object_key TEXT NOT NULL,
  pdf_object_key TEXT NOT NULL,
  source_mime_type TEXT NOT NULL,
  source_size_bytes INTEGER NOT NULL DEFAULT 0,
  pdf_size_bytes INTEGER NOT NULL DEFAULT 0,
  pdf_page_count INTEGER NOT NULL DEFAULT 1,
  checksum_sha256 TEXT,
  spec_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'saved' CHECK(status IN ('saved','archived','deleted')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_org_recent
  ON ae_generated_documents(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_agent_recent
  ON ae_generated_documents(organization_id,agent_key,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_action
  ON ae_generated_documents(organization_id,action_id);

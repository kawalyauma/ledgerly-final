CREATE TABLE IF NOT EXISTS lai_chat_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chat_id TEXT REFERENCES lai_chats(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES lai_messages(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('input','output')),
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, object_key)
);
CREATE INDEX IF NOT EXISTS idx_lai_chat_files_chat ON lai_chat_files(organization_id,chat_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_chat_files_owner ON lai_chat_files(organization_id,uploaded_by,created_at);

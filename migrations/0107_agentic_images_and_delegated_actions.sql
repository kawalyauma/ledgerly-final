CREATE TABLE IF NOT EXISTS ae_image_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  ocr_text TEXT,
  vision_summary TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('processing','ready','failed','deleted')),
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ae_image_attachments_org_recent ON ae_image_attachments(organization_id,created_at);

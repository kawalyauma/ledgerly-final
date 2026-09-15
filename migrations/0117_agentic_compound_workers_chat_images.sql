-- AI Workforce final phase: compound workflows, always-on Workers AI sidecar configuration,
-- and images attached directly to AI conversations.

CREATE TABLE IF NOT EXISTS ae_workers_ai_settings (
  organization_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  api_token_ciphertext TEXT,
  api_token_hint TEXT,
  model TEXT NOT NULL DEFAULT '@cf/google/gemma-4-26b-a4b-it',
  max_output_tokens INTEGER NOT NULL DEFAULT 768,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ae_image_attachments ADD COLUMN conversation_id TEXT;
ALTER TABLE ae_image_attachments ADD COLUMN message_id TEXT;
ALTER TABLE ae_image_attachments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'vision';

CREATE INDEX IF NOT EXISTS idx_ae_images_conversation
  ON ae_image_attachments(organization_id,conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_images_message
  ON ae_image_attachments(organization_id,message_id,created_at);

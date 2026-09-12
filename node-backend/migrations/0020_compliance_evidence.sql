CREATE TABLE attachments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  retention_until date,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX attachments_entity_idx ON attachments (organization_id,entity_type,entity_id,created_at DESC);
CREATE UNIQUE INDEX attachments_object_key_uq ON attachments (organization_id,object_key);
CREATE INDEX compliance_approvals_pending_idx ON compliance_approvals (organization_id,status,created_at) WHERE status='pending';

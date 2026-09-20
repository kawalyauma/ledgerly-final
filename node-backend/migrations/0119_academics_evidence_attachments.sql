CREATE TABLE school_academic_attachments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('scheme_lesson_plan','scheme_lesson_delivery','observation','record_inspection')),
  entity_id text NOT NULL,
  file_id text NOT NULL REFERENCES school_files(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'evidence' CHECK (role IN ('evidence','source_scan')),
  caption text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX school_academic_attachments_entity_idx
  ON school_academic_attachments(organization_id, entity_type, entity_id);

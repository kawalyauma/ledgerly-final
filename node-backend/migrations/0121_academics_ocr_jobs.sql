CREATE TABLE school_academic_ocr_jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES school_scheme_lessons(id) ON DELETE CASCADE,
  file_id text NOT NULL REFERENCES school_files(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done','failed')),
  result_json jsonb,
  error_text text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz
);

CREATE INDEX school_academic_ocr_jobs_lookup_idx ON school_academic_ocr_jobs(organization_id, id);

ALTER TABLE school_scheme_lesson_plans
  ADD COLUMN IF NOT EXISTS source_file_id text REFERENCES school_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_fill_status text CHECK (ai_fill_status IS NULL OR ai_fill_status IN ('processing','done','failed')),
  ADD COLUMN IF NOT EXISTS ai_fill_error text;

ALTER TABLE school_academic_ocr_jobs
  ADD COLUMN IF NOT EXISTS plan_id text REFERENCES school_scheme_lesson_plans(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS school_academic_ocr_jobs_plan_idx
  ON school_academic_ocr_jobs(organization_id,plan_id,created_at DESC)
  WHERE plan_id IS NOT NULL;

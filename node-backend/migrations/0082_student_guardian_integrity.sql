ALTER TABLE school_student_guardians
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE school_student_guardians
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS school_student_guardians_active_student_idx
  ON school_student_guardians(organization_id,student_id,primary_guardian DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS school_student_guardians_active_guardian_idx
  ON school_student_guardians(organization_id,guardian_id,student_id)
  WHERE deleted_at IS NULL;

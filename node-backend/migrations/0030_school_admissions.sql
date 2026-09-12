CREATE TABLE school_admission_applications (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id text REFERENCES school_branches(id) ON DELETE RESTRICT,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  application_number text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','screening','waitlisted','approved','rejected','enrolled','withdrawn')),
  desired_class_level_id text REFERENCES school_class_levels(id) ON DELETE RESTRICT,
  applicant jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardian jsonb NOT NULL DEFAULT '{}'::jsonb,
  screening jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_notes text,
  decided_by text,
  decided_at timestamptz,
  enrolled_student_id text REFERENCES school_students(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,application_number)
);
CREATE INDEX school_admissions_status_idx ON school_admission_applications(organization_id,status,academic_year_id,created_at DESC);
CREATE UNIQUE INDEX school_admissions_student_uq ON school_admission_applications(organization_id,enrolled_student_id) WHERE enrolled_student_id IS NOT NULL;

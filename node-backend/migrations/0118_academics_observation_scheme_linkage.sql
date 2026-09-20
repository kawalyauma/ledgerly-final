ALTER TABLE school_academic_observations
  ADD COLUMN scheme_lesson_id text REFERENCES school_scheme_lessons(id) ON DELETE SET NULL,
  ADD COLUMN scheme_lesson_plan_id text REFERENCES school_scheme_lesson_plans(id) ON DELETE SET NULL;

CREATE INDEX school_academic_observations_scheme_lesson_idx
  ON school_academic_observations(organization_id, scheme_lesson_id)
  WHERE scheme_lesson_id IS NOT NULL;

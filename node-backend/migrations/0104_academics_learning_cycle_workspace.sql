CREATE TABLE school_scheme_topics (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id text NOT NULL REFERENCES school_schemes_of_work(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  week_from integer CHECK (week_from IS NULL OR week_from > 0),
  week_to integer CHECK (week_to IS NULL OR week_to > 0),
  planned_start_on date,
  planned_end_on date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','covered','deferred')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (week_from IS NULL OR week_to IS NULL OR week_to >= week_from),
  CHECK (planned_start_on IS NULL OR planned_end_on IS NULL OR planned_end_on >= planned_start_on)
);
CREATE INDEX school_scheme_topics_scope_idx ON school_scheme_topics(organization_id,scheme_id,week_from,week_to);

CREATE TABLE school_scheme_lessons (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES school_scheme_topics(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  title text NOT NULL,
  subtopic text,
  planned_date date,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  learning_outcomes text,
  teaching_methods text,
  learning_resources text,
  learner_activities text,
  assessment_strategy text,
  values_and_cross_cutting text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','plan_drafted','delivered','assessed')),
  lesson_plan_id text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,topic_id,sequence_no)
);
CREATE INDEX school_scheme_lessons_scope_idx ON school_scheme_lessons(organization_id,topic_id,status,planned_date);

CREATE TABLE school_scheme_lesson_competencies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES school_scheme_lessons(id) ON DELETE CASCADE,
  competency_type text NOT NULL,
  code text,
  title text NOT NULL,
  description text,
  success_criteria text
);
CREATE INDEX school_scheme_lesson_competencies_scope_idx ON school_scheme_lesson_competencies(organization_id,lesson_id);

CREATE TABLE school_scheme_lesson_plans (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES school_scheme_lessons(id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  prior_knowledge text,
  introduction_text text,
  lesson_development text,
  teacher_activities text,
  learner_activities text,
  differentiated_instruction text,
  special_needs_accommodations text,
  lesson_conclusion text,
  homework text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,lesson_id)
);
CREATE INDEX school_scheme_lesson_plans_scope_idx ON school_scheme_lesson_plans(organization_id,lesson_id,status,lesson_date);

ALTER TABLE school_scheme_lessons
  ADD CONSTRAINT school_scheme_lessons_lesson_plan_fk
  FOREIGN KEY (lesson_plan_id) REFERENCES school_scheme_lesson_plans(id) ON DELETE SET NULL;

CREATE TABLE school_scheme_lesson_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES school_scheme_lessons(id) ON DELETE CASCADE,
  taught_on date NOT NULL,
  actual_starts_at time,
  actual_ends_at time,
  lesson_notes text,
  teacher_reflection text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,lesson_id)
);
CREATE INDEX school_scheme_lesson_deliveries_scope_idx ON school_scheme_lesson_deliveries(organization_id,lesson_id,taught_on);

CREATE TABLE school_scheme_lesson_assessments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES school_scheme_lessons(id) ON DELETE CASCADE,
  title text NOT NULL,
  assessment_type text NOT NULL,
  max_score numeric NOT NULL CHECK (max_score > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,lesson_id)
);
CREATE INDEX school_scheme_lesson_assessments_scope_idx ON school_scheme_lesson_assessments(organization_id,lesson_id,status);

CREATE TABLE school_scheme_lesson_marks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_id text NOT NULL REFERENCES school_scheme_lesson_assessments(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  score numeric CHECK (score IS NULL OR score >= 0),
  absent boolean NOT NULL DEFAULT false,
  competency_level text,
  remark text,
  UNIQUE (organization_id,assessment_id,student_id)
);
CREATE INDEX school_scheme_lesson_marks_scope_idx ON school_scheme_lesson_marks(organization_id,assessment_id,student_id);

ALTER TABLE school_schemes_of_work DROP CONSTRAINT IF EXISTS school_schemes_of_work_status_check;
ALTER TABLE school_schemes_of_work
  ADD CONSTRAINT school_schemes_of_work_status_check
  CHECK (status IN ('draft','submitted','submitted_hod','hod_approved','submitted_dos','approved','rejected','archived'));

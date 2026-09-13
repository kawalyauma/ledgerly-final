CREATE TABLE school_curricula (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  authority text,
  version text,
  starts_on date,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_syllabus_units (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  curriculum_id text NOT NULL REFERENCES school_curricula(id) ON DELETE CASCADE,
  class_level_id text REFERENCES school_class_levels(id) ON DELETE SET NULL,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  competencies text,
  learning_outcomes text,
  suggested_periods integer CHECK (suggested_periods IS NULL OR suggested_periods > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,curriculum_id,subject_id,code)
);

CREATE TABLE school_syllabus_topics (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES school_syllabus_units(id) ON DELETE CASCADE,
  code text,
  title text NOT NULL,
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  learning_outcomes text,
  content_notes text,
  suggested_periods integer CHECK (suggested_periods IS NULL OR suggested_periods > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,unit_id,sequence)
);

CREATE TABLE school_schemes_of_work (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  curriculum_id text REFERENCES school_curricula(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','archived')),
  submitted_at timestamptz,
  submitted_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  review_notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_schemes_scope_idx ON school_schemes_of_work(organization_id,academic_year_id,term_id,class_id,subject_id,status);

CREATE TABLE school_scheme_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id text NOT NULL REFERENCES school_schemes_of_work(id) ON DELETE CASCADE,
  syllabus_topic_id text REFERENCES school_syllabus_topics(id) ON DELETE SET NULL,
  week_number integer NOT NULL CHECK (week_number > 0),
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  topic text NOT NULL,
  subtopic text,
  learning_outcomes text,
  teaching_methods text,
  learning_resources text,
  assessment_strategy text,
  planned_periods integer NOT NULL DEFAULT 1 CHECK (planned_periods > 0),
  actual_periods integer NOT NULL DEFAULT 0 CHECK (actual_periods >= 0),
  completion_status text NOT NULL DEFAULT 'planned' CHECK (completion_status IN ('planned','in_progress','completed','deferred')),
  teacher_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,scheme_id,week_number,sequence)
);

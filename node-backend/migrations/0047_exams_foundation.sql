CREATE TABLE exm_grading_scales (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE exm_grade_bands (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grading_scale_id text NOT NULL REFERENCES exm_grading_scales(id) ON DELETE CASCADE,
  grade text NOT NULL,
  label text,
  min_mark numeric(6,2) NOT NULL,
  max_mark numeric(6,2) NOT NULL,
  points integer,
  sort_order integer NOT NULL DEFAULT 0,
  CHECK (min_mark <= max_mark),
  UNIQUE (organization_id, grading_scale_id, grade)
);

CREATE TABLE exm_exams (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  name text NOT NULL,
  exam_type text NOT NULL DEFAULT 'end_of_term',
  start_date date,
  end_date date,
  grading_scale_id text REFERENCES exm_grading_scales(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  remarks text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exm_exam_classes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX exm_exam_classes_unique_idx ON exm_exam_classes(organization_id,exam_id,class_id,COALESCE(stream_id,''));

CREATE TABLE exm_exam_subjects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  max_mark numeric(6,2) NOT NULL DEFAULT 100,
  compulsory boolean NOT NULL DEFAULT true,
  aggregate_subject boolean NOT NULL DEFAULT true,
  weight numeric(8,4) NOT NULL DEFAULT 1,
  UNIQUE (organization_id, exam_id, class_id, subject_id)
);

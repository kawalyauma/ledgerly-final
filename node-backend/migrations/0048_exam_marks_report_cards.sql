CREATE TABLE exm_marks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  raw_mark numeric(7,2),
  max_mark numeric(7,2) NOT NULL DEFAULT 100,
  percentage numeric(7,2),
  grade text,
  grade_points integer,
  absent boolean NOT NULL DEFAULT false,
  exempt boolean NOT NULL DEFAULT false,
  remarks text,
  entered_by text REFERENCES users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, exam_id, student_id, subject_id)
);
CREATE INDEX exm_marks_exam_class_idx ON exm_marks(organization_id,exam_id,class_id,subject_id);

CREATE TABLE exm_report_cards (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  total_marks numeric(10,2) NOT NULL DEFAULT 0,
  max_possible_marks numeric(10,2) NOT NULL DEFAULT 0,
  subjects_sat integer NOT NULL DEFAULT 0,
  aggregate integer,
  division text,
  grade_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  position_in_class integer,
  total_students_in_class integer,
  class_teacher_comment text,
  head_teacher_comment text,
  attendance_present integer,
  attendance_absent integer,
  attendance_late integer,
  computed_at timestamptz,
  computed_by text REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,exam_id,student_id)
);
CREATE INDEX exm_report_cards_class_idx ON exm_report_cards(organization_id,exam_id,class_id,position_in_class);

CREATE TABLE exm_report_subjects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_card_id text NOT NULL REFERENCES exm_report_cards(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  subject_name text NOT NULL,
  mark numeric(7,2),
  max_mark numeric(7,2) NOT NULL,
  percentage numeric(7,2),
  grade text,
  points integer,
  counted_for_aggregate boolean NOT NULL DEFAULT false,
  remarks text,
  UNIQUE (organization_id,report_card_id,subject_id)
);

CREATE TABLE exm_mark_audit (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  old_mark numeric(7,2),
  new_mark numeric(7,2),
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

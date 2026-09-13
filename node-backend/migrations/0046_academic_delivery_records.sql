CREATE TABLE school_academic_delivery_logs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE RESTRICT,
  scheme_item_id text REFERENCES school_scheme_items(id) ON DELETE SET NULL,
  lesson_plan_id text REFERENCES school_lesson_plans(id) ON DELETE SET NULL,
  delivered_on date NOT NULL,
  periods_delivered integer NOT NULL DEFAULT 1 CHECK (periods_delivered > 0),
  topic text NOT NULL,
  subtopic text,
  learning_outcomes_covered text,
  learner_response text,
  homework_given text,
  challenges text,
  next_steps text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_delivery_scope_idx ON school_academic_delivery_logs(organization_id,academic_year_id,term_id,class_id,subject_id,delivered_on DESC);

CREATE TABLE school_teacher_academic_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  teacher_staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text REFERENCES school_subjects(id) ON DELETE SET NULL,
  record_type text NOT NULL CHECK (record_type IN ('lesson_notes','attendance_register','mark_book','scheme_file','lesson_plan_file','learners_work','other')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_teacher_records_scope_idx ON school_teacher_academic_records(organization_id,teacher_staff_id,term_id,record_type,status);

CREATE TABLE school_academic_record_inspections (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id text NOT NULL REFERENCES school_teacher_academic_records(id) ON DELETE CASCADE,
  inspected_on date NOT NULL DEFAULT CURRENT_DATE,
  inspector_user_id text REFERENCES users(id) ON DELETE SET NULL,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  completeness_status text NOT NULL DEFAULT 'complete' CHECK (completeness_status IN ('complete','partial','missing','not_applicable')),
  findings text,
  corrective_action text,
  follow_up_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','closed')),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_record_inspections_due_idx ON school_academic_record_inspections(organization_id,status,follow_up_on);

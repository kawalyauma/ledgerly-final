CREATE TABLE school_parent_portal_threads (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guardian_id text NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  student_id text REFERENCES school_students(id) ON DELETE SET NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_parent_threads_guardian_idx ON school_parent_portal_threads(organization_id,guardian_id,status,last_message_at DESC);

CREATE TABLE school_parent_portal_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES school_parent_portal_threads(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  sender_kind text NOT NULL CHECK (sender_kind IN ('guardian','school')),
  body text NOT NULL,
  read_by_guardian_at timestamptz,
  read_by_school_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_parent_messages_thread_idx ON school_parent_portal_messages(organization_id,thread_id,created_at);

CREATE TABLE school_homework_assignments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  assigned_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','closed','cancelled')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_homework_scope_idx ON school_homework_assignments(organization_id,class_id,stream_id,status,due_on);

CREATE TABLE school_student_attendance_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  attendance_date date NOT NULL,
  session_type text NOT NULL DEFAULT 'daily' CHECK (session_type IN ('daily','period','assembly','event','other')),
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text REFERENCES school_subjects(id) ON DELETE SET NULL,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  expected_count integer NOT NULL DEFAULT 0,
  marked_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','api','device')),
  notes text,
  marked_by text REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_student_attendance_sessions_idx ON school_student_attendance_sessions(organization_id,attendance_date DESC,class_id,stream_id);
CREATE UNIQUE INDEX school_student_attendance_session_unique_idx ON school_student_attendance_sessions(organization_id,attendance_date,session_type,class_id,COALESCE(stream_id,''),COALESCE(subject_id,'')) WHERE status<>'cancelled';

CREATE TABLE school_student_attendance_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES school_student_attendance_sessions(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('present','absent','late','excused','sick','permission')),
  check_in_at timestamptz,
  check_out_at timestamptz,
  minutes_late integer NOT NULL DEFAULT 0 CHECK (minutes_late>=0),
  notes text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','api','device')),
  recorded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,session_id,student_id)
);
CREATE INDEX school_student_attendance_student_idx ON school_student_attendance_records(organization_id,student_id,created_at DESC);

CREATE TABLE school_staff_attendance_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','late','on_leave','sick','official_duty','remote','half_day')),
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes>=0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','clock','import','api','device')),
  notes text,
  recorded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,staff_id,attendance_date)
);
CREATE INDEX school_staff_attendance_date_idx ON school_staff_attendance_records(organization_id,attendance_date DESC,status);

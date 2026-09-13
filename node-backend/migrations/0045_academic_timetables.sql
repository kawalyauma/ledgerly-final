CREATE TABLE school_academic_rooms (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_teacher_availability (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  teacher_staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  available boolean NOT NULL DEFAULT true,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);
CREATE INDEX school_teacher_availability_idx ON school_teacher_availability(organization_id,teacher_staff_id,weekday,starts_at,ends_at);

CREATE TABLE school_academic_timetables (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','published','archived')),
  submitted_at timestamptz,
  submitted_by text REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by text REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by text REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_academic_timetables_scope_idx ON school_academic_timetables(organization_id,academic_year_id,term_id,status);

CREATE TABLE school_academic_timetable_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id text NOT NULL REFERENCES school_academic_timetables(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE RESTRICT,
  room_id text REFERENCES school_academic_rooms(id) ON DELETE SET NULL,
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  lesson_period_id text,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);
CREATE INDEX school_timetable_entries_teacher_idx ON school_academic_timetable_entries(organization_id,timetable_id,teacher_staff_id,weekday,starts_at,ends_at);
CREATE INDEX school_timetable_entries_class_idx ON school_academic_timetable_entries(organization_id,timetable_id,class_id,stream_id,weekday,starts_at,ends_at);
CREATE INDEX school_timetable_entries_room_idx ON school_academic_timetable_entries(organization_id,timetable_id,room_id,weekday,starts_at,ends_at) WHERE room_id IS NOT NULL;

CREATE TABLE school_hostels (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  gender text NOT NULL DEFAULT 'mixed' CHECK (gender IN ('male','female','mixed')),
  warden_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_hostel_rooms (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hostel_id text NOT NULL REFERENCES school_hostels(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  floor text,
  capacity integer NOT NULL CHECK (capacity > 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,hostel_id,code)
);

CREATE TABLE school_hostel_beds (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id text NOT NULL REFERENCES school_hostel_rooms(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance','retired')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,room_id,code)
);

CREATE TABLE school_hostel_allocations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  hostel_id text NOT NULL REFERENCES school_hostels(id) ON DELETE RESTRICT,
  room_id text NOT NULL REFERENCES school_hostel_rooms(id) ON DELETE RESTRICT,
  bed_id text NOT NULL REFERENCES school_hostel_beds(id) ON DELETE RESTRICT,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  allocated_on date NOT NULL DEFAULT CURRENT_DATE,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','checked_in','checked_out','cancelled')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX school_hostel_active_student_uq ON school_hostel_allocations(organization_id,student_id) WHERE status IN ('allocated','checked_in');
CREATE UNIQUE INDEX school_hostel_active_bed_uq ON school_hostel_allocations(organization_id,bed_id) WHERE status IN ('allocated','checked_in');
CREATE INDEX school_hostel_allocations_idx ON school_hostel_allocations(organization_id,hostel_id,room_id,status);

CREATE TABLE school_hostel_roll_calls (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hostel_id text NOT NULL REFERENCES school_hostels(id) ON DELETE CASCADE,
  roll_call_date date NOT NULL,
  session text NOT NULL DEFAULT 'evening' CHECK (session IN ('morning','evening','night','custom')),
  taken_by text REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,hostel_id,roll_call_date,session)
);

CREATE TABLE school_hostel_roll_call_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  roll_call_id text NOT NULL REFERENCES school_hostel_roll_calls(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('present','absent','excused','sick','away')),
  remarks text,
  UNIQUE (organization_id,roll_call_id,student_id)
);

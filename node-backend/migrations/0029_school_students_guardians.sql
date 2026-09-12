CREATE TABLE school_guardians (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  phone_primary text,
  phone_secondary text,
  email text,
  relationship_default text NOT NULL DEFAULT 'guardian',
  occupation text,
  physical_address text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_guardians_lookup_idx ON school_guardians(organization_id,active,phone_primary,email);

CREATE TABLE school_students (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE RESTRICT,
  admission_number text NOT NULL,
  student_number text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  gender text,
  date_of_birth date,
  nationality text,
  place_of_birth text,
  religion text,
  home_language text,
  phone text,
  email text,
  physical_address text,
  previous_school text,
  previous_class text,
  admission_date date NOT NULL,
  admission_class_level_id text REFERENCES school_class_levels(id) ON DELETE RESTRICT,
  current_academic_year_id text REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  current_class_id text REFERENCES school_classes(id) ON DELETE RESTRICT,
  current_stream_id text REFERENCES school_streams(id) ON DELETE RESTRICT,
  student_category text,
  residency_status text NOT NULL DEFAULT 'day' CHECK (residency_status IN ('day','boarding','hybrid')),
  house text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('applicant','active','inactive','graduated','transferred','withdrawn','suspended','deceased','alumni')),
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,admission_number),
  UNIQUE (organization_id,student_number)
);
CREATE INDEX school_students_current_idx ON school_students(organization_id,status,current_academic_year_id,current_class_id,current_stream_id) WHERE deleted_at IS NULL;
CREATE INDEX school_students_name_idx ON school_students(organization_id,last_name,first_name) WHERE deleted_at IS NULL;

CREATE TABLE school_student_guardians (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  guardian_id text NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'guardian',
  primary_guardian boolean NOT NULL DEFAULT false,
  authorized_pickup boolean NOT NULL DEFAULT true,
  financial_responsibility boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,student_id,guardian_id)
);
CREATE UNIQUE INDEX school_student_primary_guardian_uq ON school_student_guardians(organization_id,student_id) WHERE primary_guardian=true;

CREATE TABLE school_enrollments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE RESTRICT,
  enrolled_on date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','promoted','transferred','completed','withdrawn')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,student_id,academic_year_id)
);
CREATE INDEX school_enrollments_class_idx ON school_enrollments(organization_id,academic_year_id,class_id,stream_id,status);

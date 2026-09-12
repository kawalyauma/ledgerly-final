CREATE TABLE school_staff_positions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  job_grade text,
  is_teaching boolean NOT NULL DEFAULT false,
  is_management boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,code)
);

CREATE TABLE school_staff_profiles (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  staff_number text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  gender text,
  date_of_birth date,
  nationality text,
  national_id text,
  tax_identifier text,
  phone text,
  alternate_phone text,
  email text,
  physical_address text,
  postal_address text,
  department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
  position_id text REFERENCES school_staff_positions(id) ON DELETE SET NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent','contract','part_time','casual','intern','volunteer')),
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','suspended','terminated','resigned','retired','inactive')),
  is_teacher boolean NOT NULL DEFAULT false,
  hire_date date NOT NULL,
  pay_type text NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary','hourly')),
  base_pay_minor bigint NOT NULL DEFAULT 0 CHECK (base_pay_minor>=0),
  currency text NOT NULL DEFAULT 'UGX' CHECK (char_length(currency)=3),
  notes text,
  created_by text,
  updated_by text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,staff_number)
);
CREATE INDEX school_staff_lookup_idx ON school_staff_profiles(organization_id,employment_status,department_id,position_id,campus_id,is_teacher) WHERE deleted_at IS NULL;

CREATE TABLE school_staff_emergency_contacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text,
  phone text NOT NULL,
  alternate_phone text,
  email text,
  physical_address text,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_staff_qualifications (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  qualification_type text NOT NULL,
  title text NOT NULL,
  institution text,
  awarded_on date,
  expires_on date,
  certificate_number text,
  verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_staff_subjects (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,staff_id,subject_id)
);

CREATE TABLE school_staff_teaching_assignments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE CASCADE,
  term_id text REFERENCES school_terms(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stream_id text REFERENCES school_streams(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  periods_per_week integer CHECK (periods_per_week IS NULL OR periods_per_week BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,staff_id,academic_year_id,term_id,class_id,stream_id,subject_id)
);

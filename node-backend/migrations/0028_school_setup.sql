CREATE TABLE school_profiles (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  school_code text NOT NULL,
  registration_number text,
  motto text,
  school_type text NOT NULL DEFAULT 'day',
  ownership_type text,
  education_level text,
  curriculum text,
  phone_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  email_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  website text,
  physical_address text,
  postal_address text,
  country text NOT NULL DEFAULT 'Uganda',
  district_region text,
  location_text text,
  head_teacher_name text,
  head_teacher_phone text,
  head_teacher_email text,
  language text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'Africa/Kampala',
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
  time_format text NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h','24h')),
  default_currency text NOT NULL DEFAULT 'UGX' CHECK (char_length(default_currency)=3),
  multi_campus_enabled boolean NOT NULL DEFAULT false,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  system_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_branches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  registration_number text,
  phone text,
  email text,
  physical_address text,
  postal_address text,
  district_region text,
  location_text text,
  principal_name text,
  is_main boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE UNIQUE INDEX school_branches_main_uq ON school_branches(organization_id) WHERE is_main=true;

CREATE TABLE school_academic_years (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed','archived')),
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code),
  CHECK (ends_on>=starts_on)
);
CREATE UNIQUE INDEX school_academic_year_current_uq ON school_academic_years(organization_id) WHERE is_current=true;

CREATE TABLE school_terms (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 20),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed','archived')),
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,academic_year_id,sequence_no),
  UNIQUE (organization_id,academic_year_id,code),
  CHECK (ends_on>=starts_on)
);
CREATE UNIQUE INDEX school_term_current_uq ON school_terms(organization_id) WHERE is_current=true;

CREATE TABLE school_departments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id text REFERENCES school_branches(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  head_user_id text REFERENCES users(id) ON DELETE SET NULL,
  parent_id text REFERENCES school_departments(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_class_levels (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 100),
  education_level text,
  promotion_level_id text REFERENCES school_class_levels(id) ON DELETE SET NULL,
  terminal boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code),
  UNIQUE (organization_id,sequence_no)
);

CREATE TABLE school_classes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  campus_id text REFERENCES school_branches(id) ON DELETE RESTRICT,
  class_level_id text NOT NULL REFERENCES school_class_levels(id) ON DELETE RESTRICT,
  department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  capacity integer CHECK (capacity IS NULL OR capacity>0),
  class_teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,academic_year_id,code)
);

CREATE TABLE school_streams (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  campus_id text REFERENCES school_branches(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  capacity integer CHECK (capacity IS NULL OR capacity>0),
  class_teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,class_id,code)
);

CREATE TABLE school_subjects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  short_name text,
  subject_type text NOT NULL DEFAULT 'compulsory' CHECK (subject_type IN ('compulsory','optional','elective')),
  curriculum_code text,
  pass_mark numeric,
  max_mark numeric NOT NULL DEFAULT 100 CHECK (max_mark>0),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_class_subjects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_level_id text NOT NULL REFERENCES school_class_levels(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE CASCADE,
  compulsory boolean NOT NULL DEFAULT true,
  periods_per_week integer CHECK (periods_per_week IS NULL OR periods_per_week BETWEEN 0 AND 100),
  teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,class_level_id,subject_id,academic_year_id)
);

CREATE TABLE school_settings (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  setting_group text NOT NULL,
  setting_key text NOT NULL,
  value_json jsonb NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,setting_group,setting_key)
);

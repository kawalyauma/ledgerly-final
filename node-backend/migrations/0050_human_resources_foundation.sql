CREATE TABLE hr_departments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE hr_employees (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  school_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  department_id text REFERENCES hr_departments(id) ON DELETE SET NULL,
  employee_number text NOT NULL,
  job_title text,
  employment_type text NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent','contract','part_time','casual','intern','volunteer')),
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','suspended','terminated','resigned','retired','inactive')),
  hire_date date NOT NULL,
  termination_date date,
  manager_employee_id text REFERENCES hr_employees(id) ON DELETE SET NULL,
  work_email text,
  work_phone text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,employee_number)
);
CREATE UNIQUE INDEX hr_employee_user_unique_idx ON hr_employees(organization_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX hr_employee_contact_unique_idx ON hr_employees(organization_id,contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX hr_employee_school_staff_unique_idx ON hr_employees(organization_id,school_staff_id) WHERE school_staff_id IS NOT NULL;

ALTER TABLE hr_departments ADD COLUMN manager_employee_id text REFERENCES hr_employees(id) ON DELETE SET NULL;

CREATE TABLE hr_leave_types (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  annual_days numeric(7,2) NOT NULL DEFAULT 0 CHECK (annual_days>=0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE hr_leave_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id text NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days numeric(7,2) NOT NULL CHECK (days>0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on<=ends_on)
);
CREATE INDEX hr_leave_requests_status_idx ON hr_leave_requests(organization_id,status,starts_on);

CREATE TABLE hr_onboarding_tasks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date,
  assigned_user_id text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX hr_onboarding_employee_idx ON hr_onboarding_tasks(organization_id,employee_id,status,due_date);

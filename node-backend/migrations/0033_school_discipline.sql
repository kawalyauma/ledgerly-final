CREATE TABLE school_discipline_offence_types (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text,
  default_severity text NOT NULL DEFAULT 'medium' CHECK (default_severity IN ('low','medium','high','critical')),
  default_points integer NOT NULL DEFAULT 0,
  default_action text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_discipline_incidents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_number text NOT NULL,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
  offence_type_id text REFERENCES school_discipline_offence_types(id) ON DELETE SET NULL,
  record_type text NOT NULL DEFAULT 'incident' CHECK (record_type IN ('incident','merit','demerit')),
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  points integer NOT NULL DEFAULT 0,
  incident_at timestamptz NOT NULL,
  location text,
  witness_notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','actioned','resolved','closed')),
  follow_up_on date,
  confidential boolean NOT NULL DEFAULT false,
  reported_by text REFERENCES users(id) ON DELETE SET NULL,
  assigned_to text REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes text,
  resolved_by text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,incident_number)
);
CREATE INDEX school_discipline_student_idx ON school_discipline_incidents(organization_id,student_id,incident_at DESC);
CREATE INDEX school_discipline_status_idx ON school_discipline_incidents(organization_id,status,severity);

CREATE TABLE school_discipline_actions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id text NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  description text NOT NULL,
  starts_on date,
  ends_on date,
  issued_by text REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_discipline_followups (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id text NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  assigned_to text REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

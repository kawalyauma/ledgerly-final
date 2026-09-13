CREATE TABLE school_parent_consent_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','cancelled')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_parent_consents_student_idx ON school_parent_consent_requests(organization_id,student_id,status,due_on);

CREATE TABLE school_parent_consent_responses (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id text NOT NULL REFERENCES school_parent_consent_requests(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  guardian_id text NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('accepted','declined')),
  notes text,
  responded_by text REFERENCES users(id) ON DELETE SET NULL,
  responded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,request_id,guardian_id)
);
CREATE INDEX school_parent_consent_responses_request_idx ON school_parent_consent_responses(organization_id,request_id,student_id);

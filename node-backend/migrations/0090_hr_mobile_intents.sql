CREATE TABLE hr_mobile_leave_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id text NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days numeric(7,2) NOT NULL CHECK (days>0 AND days<=366),
  reason text,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  client_created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  applied_at timestamptz,
  server_leave_request_id text REFERENCES hr_leave_requests(id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on<=ends_on)
);
CREATE INDEX hr_mobile_leave_pending_idx ON hr_mobile_leave_intents(status,next_attempt_at,created_at);
CREATE INDEX hr_mobile_leave_org_idx ON hr_mobile_leave_intents(organization_id,created_at DESC);

CREATE TABLE hr_mobile_onboarding_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  task_id text NOT NULL REFERENCES hr_onboarding_tasks(id) ON DELETE CASCADE,
  completed_by text REFERENCES users(id) ON DELETE SET NULL,
  client_completed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  applied_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX hr_mobile_onboarding_pending_idx ON hr_mobile_onboarding_intents(status,next_attempt_at,created_at);
CREATE INDEX hr_mobile_onboarding_org_idx ON hr_mobile_onboarding_intents(organization_id,created_at DESC);

ALTER TABLE prn_documents ADD COLUMN IF NOT EXISTS retention_purged_at timestamptz;
ALTER TABLE prn_documents ADD COLUMN IF NOT EXISTS retention_purge_reason text;

CREATE TABLE prn_retention_policies (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  staged_hours integer NOT NULL DEFAULT 24 CHECK (staged_hours BETWEEN 1 AND 720),
  completed_print_days integer NOT NULL DEFAULT 7 CHECK (completed_print_days BETWEEN 0 AND 3650),
  failed_print_days integer NOT NULL DEFAULT 7 CHECK (failed_print_days BETWEEN 0 AND 3650),
  secure_print_minutes integer NOT NULL DEFAULT 10 CHECK (secure_print_minutes BETWEEN 0 AND 10080),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prn_retention_holds (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('print_job','print_document')),
  entity_id text NOT NULL,
  reason text NOT NULL,
  held_by text REFERENCES users(id) ON DELETE SET NULL,
  held_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by text REFERENCES users(id) ON DELETE SET NULL,
  released_at timestamptz
);
CREATE UNIQUE INDEX prn_retention_holds_active_uq ON prn_retention_holds(organization_id,entity_type,entity_id) WHERE released_at IS NULL;

CREATE TABLE prn_retention_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  object_key text,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_retention_events_org_idx ON prn_retention_events(organization_id,created_at DESC);

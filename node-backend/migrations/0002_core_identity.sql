CREATE TABLE organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  legal_name text,
  base_currency text NOT NULL DEFAULT 'UGX' CHECK (char_length(base_currency)=3),
  timezone text NOT NULL DEFAULT 'Africa/Kampala',
  fiscal_year_start_month integer NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_registration_number text,
  document_numbering jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','locked')),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE memberships (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','accountant','manager','viewer','integration')),
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes)='array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id,created_at);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_user_idx ON sessions (user_id,expires_at);
CREATE INDEX sessions_active_idx ON sessions (refresh_token_hash,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE api_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes)='array'),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX api_keys_org_idx ON api_keys (organization_id,created_at DESC);

CREATE TABLE identity_aliases (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_type text NOT NULL CHECK (alias_type IN ('username','phone','employee_number','student_number','other')),
  alias text NOT NULL,
  alias_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,alias_normalized)
);
CREATE INDEX identity_aliases_user_idx ON identity_aliases (organization_id,user_id);

CREATE TABLE identity_mfa (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'totp' CHECK (method='totp'),
  secret_encrypted text NOT NULL,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recovery_code_hashes)='array'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,user_id,method)
);

CREATE TABLE identity_login_events (
  id text PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  identifier text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('success','failure')),
  ip_address text,
  user_agent text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX identity_login_events_org_created_idx ON identity_login_events (organization_id,created_at DESC);

CREATE TABLE audit_logs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs (organization_id,created_at DESC);

CREATE TABLE organization_membership_invites (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  invited_by text NOT NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX organization_invites_org_email_idx ON organization_membership_invites (organization_id,lower(email));

CREATE TABLE backend_outbox_events (
  id text PRIMARY KEY,
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX backend_outbox_pending_idx ON backend_outbox_events (status,available_at,created_at) WHERE status='pending';

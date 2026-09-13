CREATE TABLE prn_release_credentials (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  issued_by text REFERENCES users(id) ON DELETE SET NULL,
  pin_digest text NOT NULL,
  token_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts>0),
  locked_at timestamptz,
  used_at timestamptz,
  used_node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
  used_printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_release_credentials_job_idx ON prn_release_credentials(organization_id,job_id,created_at DESC);
CREATE INDEX prn_release_credentials_pin_idx ON prn_release_credentials(organization_id,pin_digest) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX prn_release_credentials_token_idx ON prn_release_credentials(organization_id,token_digest) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE prn_release_attempt_log (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE,
  credential_id text REFERENCES prn_release_credentials(id) ON DELETE SET NULL,
  success boolean NOT NULL DEFAULT false,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_release_attempt_log_node_idx ON prn_release_attempt_log(organization_id,node_id,created_at DESC);

CREATE TABLE prn_nodes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  status text NOT NULL DEFAULT 'pairing' CHECK (status IN ('pairing','online','offline','revoked')),
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  token_hash text,
  last_seen_at timestamptz,
  version text,
  revoked_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_nodes_org_idx ON prn_nodes(organization_id,status,last_seen_at DESC);

CREATE TABLE prn_printers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE,
  name text NOT NULL,
  system_name text NOT NULL,
  location text,
  status text NOT NULL DEFAULT 'offline',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,node_id,system_name)
);
CREATE INDEX prn_printers_org_idx ON prn_printers(organization_id,status,name);

CREATE TABLE prn_documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes>0),
  checksum_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','attached','deleted','expired')),
  job_id text,
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  attached_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,object_key)
);

CREATE TABLE prn_jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_number text NOT NULL,
  title text NOT NULL,
  document_id text NOT NULL REFERENCES prn_documents(id) ON DELETE RESTRICT,
  printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
  node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('approval_pending','held','queued','claimed','downloading','spooling','printing','completed','failed','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','bulk')),
  copies integer NOT NULL DEFAULT 1 CHECK (copies>0),
  page_size text NOT NULL DEFAULT 'A4',
  color_mode text NOT NULL DEFAULT 'monochrome',
  duplex boolean NOT NULL DEFAULT false,
  secure_release boolean NOT NULL DEFAULT false,
  total_sheets integer NOT NULL DEFAULT 0,
  error_message text,
  released_at timestamptz,
  completed_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,job_number)
);
CREATE INDEX prn_jobs_org_status_idx ON prn_jobs(organization_id,status,created_at DESC);
ALTER TABLE prn_documents ADD CONSTRAINT prn_documents_job_fk FOREIGN KEY(job_id) REFERENCES prn_jobs(id) ON DELETE SET NULL;

CREATE TABLE prn_job_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_job_events_job_idx ON prn_job_events(organization_id,job_id,created_at);

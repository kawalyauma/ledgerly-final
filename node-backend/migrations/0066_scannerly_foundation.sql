CREATE TABLE prn_scanners (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE,
  name text NOT NULL,
  system_name text NOT NULL,
  status text NOT NULL DEFAULT 'offline',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,node_id,system_name)
);
CREATE INDEX prn_scanners_org_idx ON prn_scanners(organization_id,status,name);

CREATE TABLE prn_scan_jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_number text NOT NULL,
  title text NOT NULL,
  scanner_id text NOT NULL REFERENCES prn_scanners(id) ON DELETE RESTRICT,
  node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','scanning','uploading','completed','failed','cancelled')),
  source text NOT NULL DEFAULT 'flatbed' CHECK (source IN ('flatbed','adf')),
  color_mode text NOT NULL DEFAULT 'color' CHECK (color_mode IN ('color','gray','lineart')),
  resolution_dpi integer NOT NULL DEFAULT 300 CHECK (resolution_dpi BETWEEN 75 AND 1200),
  page_size text NOT NULL DEFAULT 'A4',
  output_format text NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf','png','jpeg')),
  target_type text NOT NULL DEFAULT 'inbox' CHECK (target_type IN ('inbox','student','staff','module')),
  target_module text,
  target_id text,
  notes text,
  error_message text,
  document_id text,
  claim_token_hash text,
  claim_expires_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,scan_number)
);
CREATE INDEX prn_scan_jobs_org_status_idx ON prn_scan_jobs(organization_id,status,created_at DESC);

CREATE TABLE prn_scan_documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_job_id text NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes>0),
  checksum_sha256 text NOT NULL,
  target_type text NOT NULL,
  target_module text,
  target_id text,
  retention_purged_at timestamptz,
  retention_purge_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,object_key),
  UNIQUE (organization_id,scan_job_id)
);
ALTER TABLE prn_scan_jobs ADD CONSTRAINT prn_scan_jobs_document_fk FOREIGN KEY(document_id) REFERENCES prn_scan_documents(id) ON DELETE SET NULL;

CREATE TABLE prn_scan_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_job_id text NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_scan_events_job_idx ON prn_scan_events(organization_id,scan_job_id,created_at);

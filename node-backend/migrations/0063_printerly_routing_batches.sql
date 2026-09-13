ALTER TABLE prn_jobs ADD COLUMN IF NOT EXISTS route_pool_id text;
ALTER TABLE prn_jobs ADD COLUMN IF NOT EXISTS route_reason text;
ALTER TABLE prn_jobs ADD COLUMN IF NOT EXISTS routed_at timestamptz;
ALTER TABLE prn_jobs ADD COLUMN IF NOT EXISTS batch_id text;

CREATE TABLE prn_printer_pools (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  routing_mode text NOT NULL DEFAULT 'priority' CHECK (routing_mode IN ('priority','least_loaded')),
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,name)
);

CREATE TABLE prn_printer_pool_members (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pool_id text NOT NULL REFERENCES prn_printer_pools(id) ON DELETE CASCADE,
  printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100 CHECK (priority>0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,pool_id,printer_id)
);
CREATE INDEX prn_printer_pool_members_pool_idx ON prn_printer_pool_members(organization_id,pool_id,enabled,priority);

CREATE TABLE prn_batches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','processing','completed','failed','cancelled')),
  scheduled_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_batches_org_idx ON prn_batches(organization_id,status,created_at DESC);

CREATE TABLE prn_batch_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id text NOT NULL REFERENCES prn_batches(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,batch_id,job_id)
);
CREATE INDEX prn_batch_items_batch_idx ON prn_batch_items(organization_id,batch_id,sequence);

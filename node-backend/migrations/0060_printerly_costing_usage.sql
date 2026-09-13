CREATE TABLE prn_cost_profiles (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'UGX',
  paper_cost_minor integer NOT NULL DEFAULT 0 CHECK (paper_cost_minor>=0),
  bw_toner_cost_minor integer NOT NULL DEFAULT 0 CHECK (bw_toner_cost_minor>=0),
  color_toner_cost_minor integer NOT NULL DEFAULT 0 CHECK (color_toner_cost_minor>=0),
  maintenance_cost_minor integer NOT NULL DEFAULT 0 CHECK (maintenance_cost_minor>=0),
  electricity_cost_minor integer NOT NULL DEFAULT 0 CHECK (electricity_cost_minor>=0),
  expense_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  offset_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  auto_post_accounting boolean NOT NULL DEFAULT false,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE prn_jobs ADD COLUMN estimated_pages integer;
ALTER TABLE prn_jobs ADD COLUMN estimated_impressions integer;
ALTER TABLE prn_jobs ADD COLUMN estimated_sheets integer;
ALTER TABLE prn_jobs ADD COLUMN estimated_cost_minor bigint;
ALTER TABLE prn_jobs ADD COLUMN actual_impressions integer;
ALTER TABLE prn_jobs ADD COLUMN actual_sheets integer;
ALTER TABLE prn_jobs ADD COLUMN actual_cost_minor bigint;
ALTER TABLE prn_jobs ADD COLUMN charge_project_id text REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE prn_jobs ADD COLUMN charge_department_type text CHECK (charge_department_type IN ('finance','school'));
ALTER TABLE prn_jobs ADD COLUMN charge_department_id text;
ALTER TABLE prn_jobs ADD COLUMN source_module text;
ALTER TABLE prn_jobs ADD COLUMN source_reference text;

CREATE TABLE prn_cost_ledger (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  department_type text CHECK (department_type IN ('finance','school')),
  department_id text,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions>=0),
  sheets integer NOT NULL DEFAULT 0 CHECK (sheets>=0),
  paper_cost_minor bigint NOT NULL DEFAULT 0,
  toner_cost_minor bigint NOT NULL DEFAULT 0,
  maintenance_cost_minor bigint NOT NULL DEFAULT 0,
  electricity_cost_minor bigint NOT NULL DEFAULT 0,
  total_cost_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL,
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,job_id)
);
CREATE INDEX prn_cost_ledger_org_idx ON prn_cost_ledger(organization_id,created_at DESC);

CREATE TABLE prn_cost_postings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  cost_ledger_id text NOT NULL REFERENCES prn_cost_ledger(id) ON DELETE CASCADE,
  journal_entry_id text NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_by text REFERENCES users(id) ON DELETE SET NULL,
  posted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,job_id),
  UNIQUE (organization_id,journal_entry_id)
);

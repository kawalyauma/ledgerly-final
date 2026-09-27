CREATE TABLE IF NOT EXISTS school_fee_billing_batches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  structure_id text REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  billing_date date NOT NULL,
  total_students integer NOT NULL DEFAULT 0,
  billed_students integer NOT NULL DEFAULT 0,
  skipped_students integer NOT NULL DEFAULT 0,
  failed_students integer NOT NULL DEFAULT 0,
  total_amount_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  results_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,batch_number)
);

CREATE INDEX IF NOT EXISTS school_fee_billing_batches_org_date_idx
  ON school_fee_billing_batches(organization_id,billing_date DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS school_fee_billing_schedules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  structure_id text REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  run_on date NOT NULL,
  due_date date,
  criteria_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_post boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','cancelled','failed')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS school_fee_billing_schedules_org_run_idx
  ON school_fee_billing_schedules(organization_id,status,run_on);

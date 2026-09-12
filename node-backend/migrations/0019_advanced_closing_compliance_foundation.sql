CREATE TABLE close_checklist_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','waived')),
  evidence text,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,period_id,code)
);
CREATE INDEX close_checklist_period_idx ON close_checklist_items (organization_id,period_id,status);

CREATE TABLE adjustment_schedules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('accrual','deferral','prepayment','recurring_adjustment')),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  debit_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  next_posting_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date IS NULL OR start_date <= end_date),
  CHECK (debit_account_id <> credit_account_id)
);
CREATE INDEX adjustment_schedules_due_idx ON adjustment_schedules (organization_id,status,next_posting_date);

CREATE TABLE close_signoffs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by text NOT NULL,
  approved_by text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,period_id,stage)
);
CREATE INDEX close_signoffs_period_idx ON close_signoffs (organization_id,period_id,status);

CREATE TABLE compliance_approvals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by text NOT NULL,
  reviewed_by text,
  reason text,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at timestamptz
);
CREATE INDEX compliance_approvals_entity_idx ON compliance_approvals (organization_id,entity_type,entity_id,status);

CREATE TABLE segregation_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL,
  action text NOT NULL,
  requester_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  approver_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX segregation_rules_lookup_idx ON segregation_rules (organization_id,entity_type,action,active);

CREATE OR REPLACE FUNCTION ledgerly_validate_adjustment_schedule_tenant() RETURNS trigger AS $$
DECLARE d_org text; DECLARE c_org text;
BEGIN
 SELECT organization_id INTO d_org FROM accounts WHERE id=NEW.debit_account_id;
 SELECT organization_id INTO c_org FROM accounts WHERE id=NEW.credit_account_id;
 IF d_org IS DISTINCT FROM NEW.organization_id OR c_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'ADJUSTMENT_ACCOUNT_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER adjustment_schedule_tenant_guard BEFORE INSERT OR UPDATE ON adjustment_schedules FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_adjustment_schedule_tenant();

-- PostgreSQL parity for D1 migrations 0000_first_northstar through 0003_*.
-- Tables are reordered so referenced relations exist before foreign keys are declared.

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  legal_name text,
  base_currency text NOT NULL DEFAULT 'UGX',
  timezone text NOT NULL DEFAULT 'Africa/Kampala',
  fiscal_year_start_month integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

CREATE TABLE IF NOT EXISTS memberships (
  organization_id text NOT NULL REFERENCES organizations(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  scopes text NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  subtype text,
  normal_balance text NOT NULL,
  currency text,
  allow_posting integer NOT NULL DEFAULT 1 CHECK (allow_posting IN (0,1)),
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_org_code_uq ON accounts (organization_id, code);
CREATE INDEX IF NOT EXISTS accounts_org_type_idx ON accounts (organization_id, type);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  code text,
  name text NOT NULL,
  email text,
  tax_number text,
  payment_terms_days integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  custom_fields text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contacts_org_type_idx ON contacts (organization_id, type);

CREATE TABLE IF NOT EXISTS dimensions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS dimensions_org_type_code_uq ON dimensions (organization_id, type, code);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  customer_id text REFERENCES contacts(id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  budget_amount_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_code_uq ON projects (organization_id, code);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  sku text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  income_account_id text REFERENCES accounts(id),
  expense_account_id text REFERENCES accounts(id),
  inventory_account_id text REFERENCES accounts(id),
  quantity_on_hand_micros bigint NOT NULL DEFAULT 0,
  average_cost_minor bigint NOT NULL DEFAULT 0,
  reorder_point_micros bigint NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS products_org_sku_uq ON products (organization_id, sku);

CREATE TABLE IF NOT EXISTS journal_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  entry_number text NOT NULL,
  transaction_date date NOT NULL,
  posting_date date NOT NULL,
  description text NOT NULL,
  reference text,
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL,
  exchange_rate_micros bigint NOT NULL DEFAULT 1000000,
  reversal_of_id text,
  posted_at timestamptz,
  posted_by text,
  idempotency_key text,
  metadata text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS journals_org_number_uq ON journal_entries (organization_id, entry_number);
CREATE UNIQUE INDEX IF NOT EXISTS journals_org_idempotency_uq ON journal_entries (organization_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS journals_org_reversal_uq ON journal_entries (organization_id, reversal_of_id);
CREATE INDEX IF NOT EXISTS journals_org_posting_idx ON journal_entries (organization_id, posting_date, status);

CREATE TABLE IF NOT EXISTS journal_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  journal_entry_id text NOT NULL REFERENCES journal_entries(id),
  account_id text NOT NULL REFERENCES accounts(id),
  description text,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  base_debit_minor bigint NOT NULL DEFAULT 0,
  base_credit_minor bigint NOT NULL DEFAULT 0,
  contact_id text REFERENCES contacts(id),
  project_id text REFERENCES projects(id),
  class_id text REFERENCES dimensions(id),
  department_id text REFERENCES dimensions(id),
  location_id text REFERENCES dimensions(id),
  tax_code text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (organization_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (organization_id, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_contact_idx ON journal_lines (organization_id, contact_id);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  number text NOT NULL,
  contact_id text REFERENCES contacts(id),
  issue_date date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL,
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  paid_minor bigint NOT NULL DEFAULT 0,
  journal_entry_id text REFERENCES journal_entries(id),
  custom_fields text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_org_type_number_uq ON documents (organization_id, type, number);
CREATE INDEX IF NOT EXISTS documents_ageing_idx ON documents (organization_id, type, status, due_date);

CREATE TABLE IF NOT EXISTS document_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  document_id text NOT NULL REFERENCES documents(id),
  product_id text REFERENCES products(id),
  account_id text NOT NULL REFERENCES accounts(id),
  tax_account_id text REFERENCES accounts(id),
  description text NOT NULL,
  quantity_micros bigint NOT NULL DEFAULT 1000000,
  unit_price_minor bigint NOT NULL,
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  project_id text REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS document_lines_doc_idx ON document_lines (organization_id, document_id);

CREATE TABLE IF NOT EXISTS budgets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  fiscal_year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  budget_id text NOT NULL REFERENCES budgets(id),
  account_id text NOT NULL REFERENCES accounts(id),
  period text NOT NULL,
  amount_minor bigint NOT NULL,
  class_id text REFERENCES dimensions(id),
  department_id text REFERENCES dimensions(id),
  location_id text REFERENCES dimensions(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS budget_lines_budget_idx ON budget_lines (organization_id, budget_id, period);

CREATE TABLE IF NOT EXISTS report_jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  requested_by text NOT NULL,
  report_type text NOT NULL,
  format text NOT NULL,
  filters text NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  object_key text,
  error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS report_jobs_org_idx ON report_jobs (organization_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text,
  before text,
  after text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_org_created_idx ON audit_logs (organization_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  number text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id),
  bank_account_id text NOT NULL REFERENCES accounts(id),
  control_account_id text NOT NULL REFERENCES accounts(id),
  payment_date date NOT NULL,
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'draft',
  journal_entry_id text REFERENCES journal_entries(id),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_number_uq ON payments (organization_id, type, number);
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_idempotency_uq ON payments (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS payments_org_date_idx ON payments (organization_id, payment_date, status);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  payment_id text NOT NULL REFERENCES payments(id),
  document_id text NOT NULL REFERENCES documents(id),
  amount_minor bigint NOT NULL,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_payment_document_uq ON payment_allocations (organization_id, payment_id, document_id);
CREATE INDEX IF NOT EXISTS payment_allocations_document_idx ON payment_allocations (organization_id, document_id);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_org_dates_uq ON fiscal_periods (organization_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS fiscal_periods_org_range_idx ON fiscal_periods (organization_id, starts_on, ends_on);

CREATE OR REPLACE FUNCTION payment_allocation_validate_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor <= 0 THEN RAISE EXCEPTION 'allocation amount must be positive'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM payments p JOIN documents d ON d.id = NEW.document_id
    WHERE p.id = NEW.payment_id
      AND p.organization_id = NEW.organization_id
      AND d.organization_id = NEW.organization_id
      AND p.contact_id = d.contact_id
      AND p.currency = d.currency
      AND p.status = 'posted'
      AND d.status IN ('open', 'partially_paid')
      AND ((p.type = 'receipt' AND d.type = 'invoice') OR (p.type = 'payment' AND d.type = 'bill'))
  ) THEN RAISE EXCEPTION 'allocation document does not match payment'; END IF;
  IF (SELECT COALESCE(SUM(pa.amount_minor), 0) + NEW.amount_minor FROM payment_allocations pa WHERE pa.payment_id = NEW.payment_id)
     > (SELECT amount_minor FROM payments WHERE id = NEW.payment_id)
  THEN RAISE EXCEPTION 'allocations exceed payment amount'; END IF;
  IF NEW.amount_minor > (SELECT total_minor - paid_minor FROM documents WHERE id = NEW.document_id)
  THEN RAISE EXCEPTION 'allocation exceeds document balance'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION payment_allocation_apply_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents
  SET paid_minor = paid_minor + NEW.amount_minor,
      status = CASE WHEN paid_minor + NEW.amount_minor = total_minor THEN 'paid' ELSE 'partially_paid' END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.document_id AND organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION payment_allocation_reverse_validate_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL THEN RAISE EXCEPTION 'allocation reversal is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION payment_allocation_reverse_apply_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL THEN
    UPDATE documents
    SET paid_minor = paid_minor - OLD.amount_minor,
        status = CASE WHEN paid_minor - OLD.amount_minor = 0 THEN 'open' ELSE 'partially_paid' END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.document_id AND organization_id = OLD.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_allocation_validate ON payment_allocations;
CREATE TRIGGER payment_allocation_validate BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_validate_fn();
DROP TRIGGER IF EXISTS payment_allocation_apply ON payment_allocations;
CREATE TRIGGER payment_allocation_apply AFTER INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_apply_fn();
DROP TRIGGER IF EXISTS payment_allocation_reverse_validate ON payment_allocations;
CREATE TRIGGER payment_allocation_reverse_validate BEFORE UPDATE OF reversed_at ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_reverse_validate_fn();
DROP TRIGGER IF EXISTS payment_allocation_reverse_apply ON payment_allocations;
CREATE TRIGGER payment_allocation_reverse_apply AFTER UPDATE OF reversed_at ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_reverse_apply_fn();

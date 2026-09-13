CREATE TABLE payroll_salary_payments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id text NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  payroll_line_id text NOT NULL REFERENCES payroll_lines(id) ON DELETE RESTRICT,
  employee_id text NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor>0),
  payment_date date NOT NULL,
  reference text,
  payable_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  cash_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payroll_salary_payments_line_idx ON payroll_salary_payments(organization_id,payroll_line_id,created_at DESC);

CREATE TABLE payroll_statutory_liabilities (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id text NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code IN ('PAYE','NSSF_EMPLOYEE','NSSF_EMPLOYER')),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor>=0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor>=0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partially_paid','paid')),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,payroll_run_id,code),
  CHECK (paid_minor<=amount_minor)
);

CREATE TABLE payroll_statutory_payments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  liability_id text NOT NULL REFERENCES payroll_statutory_liabilities(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor>0),
  payment_date date NOT NULL,
  liability_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  cash_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  reference text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

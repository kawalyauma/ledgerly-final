CREATE TABLE payroll_employees (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hr_employee_id text REFERENCES hr_employees(id) ON DELETE SET NULL,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  employee_number text NOT NULL,
  pay_type text NOT NULL CHECK (pay_type IN ('salary','hourly')),
  base_pay_minor bigint NOT NULL DEFAULT 0 CHECK (base_pay_minor>=0),
  currency text NOT NULL,
  tax_identifier text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,employee_number)
);
CREATE UNIQUE INDEX payroll_employee_hr_unique_idx ON payroll_employees(organization_id,hr_employee_id) WHERE hr_employee_id IS NOT NULL;

CREATE TABLE payroll_components (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('earning','deduction','employer_cost')),
  calculation_type text NOT NULL DEFAULT 'fixed' CHECK (calculation_type IN ('fixed','percentage','input')),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor>=0),
  rate_micros bigint NOT NULL DEFAULT 0 CHECK (rate_micros>=0),
  taxable boolean NOT NULL DEFAULT false,
  pensionable boolean NOT NULL DEFAULT false,
  statutory boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id,code)
);

CREATE TABLE payroll_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','partially_paid','paid','reversed','cancelled')),
  gross_minor bigint NOT NULL DEFAULT 0,
  deductions_minor bigint NOT NULL DEFAULT 0,
  employer_costs_minor bigint NOT NULL DEFAULT 0,
  net_minor bigint NOT NULL DEFAULT 0,
  approved_by text REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_start<=period_end),
  UNIQUE (organization_id,number)
);

CREATE TABLE payroll_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id text NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  gross_minor bigint NOT NULL DEFAULT 0 CHECK (gross_minor>=0),
  deductions_minor bigint NOT NULL DEFAULT 0 CHECK (deductions_minor>=0),
  employer_costs_minor bigint NOT NULL DEFAULT 0 CHECK (employer_costs_minor>=0),
  net_minor bigint NOT NULL DEFAULT 0 CHECK (net_minor>=0),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor>=0),
  balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor>=0),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,payroll_run_id,employee_id)
);
CREATE INDEX payroll_lines_run_idx ON payroll_lines(organization_id,payroll_run_id,payment_status);

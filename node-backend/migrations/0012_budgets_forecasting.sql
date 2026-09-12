CREATE TABLE cost_centers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id text REFERENCES cost_centers(id) ON DELETE RESTRICT,
  manager_user_id text REFERENCES users(id) ON DELETE SET NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE INDEX cost_centers_org_parent_idx ON cost_centers (organization_id,parent_id,code);

CREATE TABLE revenue_sources (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  revenue_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE INDEX revenue_sources_org_account_idx ON revenue_sources (organization_id,revenue_account_id,active);

CREATE TABLE budgets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
  fiscal_year_id text REFERENCES fiscal_years(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','active','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  scenario text NOT NULL DEFAULT 'base',
  kind text NOT NULL DEFAULT 'annual' CHECK (kind IN ('annual','rolling_forecast','cash_flow','departmental')),
  enforcement text NOT NULL DEFAULT 'warning' CHECK (enforcement IN ('none','warning','block')),
  parent_id text REFERENCES budgets(id) ON DELETE RESTRICT,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  activated_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budgets_org_year_idx ON budgets (organization_id,fiscal_year DESC,status,scenario,kind);
CREATE INDEX budgets_parent_idx ON budgets (organization_id,parent_id,version);
CREATE UNIQUE INDEX budgets_one_active_scenario_uq ON budgets (organization_id,fiscal_year,scenario,kind) WHERE status='active';

CREATE TABLE budget_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  cost_center_id text REFERENCES cost_centers(id) ON DELETE RESTRICT,
  revenue_source_id text REFERENCES revenue_sources(id) ON DELETE RESTRICT,
  project_id text,
  class_id text,
  department_id text,
  location_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budget_lines_budget_idx ON budget_lines (organization_id,budget_id,period,account_id);
CREATE INDEX budget_lines_cost_center_idx ON budget_lines (organization_id,cost_center_id,period) WHERE cost_center_id IS NOT NULL;
CREATE INDEX budget_lines_revenue_source_idx ON budget_lines (organization_id,revenue_source_id,period) WHERE revenue_source_id IS NOT NULL;

CREATE TABLE budget_actuals (
  budget_line_id text PRIMARY KEY REFERENCES budget_lines(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  actual_minor bigint NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budget_actuals_budget_idx ON budget_actuals (organization_id,budget_id,calculated_at DESC);

CREATE TABLE budget_forecasts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name text NOT NULL,
  scenario text NOT NULL DEFAULT 'base',
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','actuals_plus_plan','run_rate','percentage')),
  as_of_month text CHECK (as_of_month IS NULL OR as_of_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  adjustment_percent numeric(12,4),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  parent_id text REFERENCES budget_forecasts(id) ON DELETE RESTRICT,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budget_forecasts_budget_idx ON budget_forecasts (organization_id,budget_id,scenario,version DESC);

CREATE TABLE budget_forecast_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  forecast_id text NOT NULL REFERENCES budget_forecasts(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_minor bigint NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','actual','budget','run_rate','percentage')),
  cost_center_id text REFERENCES cost_centers(id) ON DELETE RESTRICT,
  revenue_source_id text REFERENCES revenue_sources(id) ON DELETE RESTRICT,
  project_id text,
  class_id text,
  department_id text,
  location_id text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budget_forecast_lines_idx ON budget_forecast_lines (organization_id,forecast_id,period,account_id);

CREATE TABLE budget_variance_notes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  budget_line_id text REFERENCES budget_lines(id) ON DELETE CASCADE,
  period text CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  note text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX budget_variance_notes_idx ON budget_variance_notes (organization_id,budget_id,period);

CREATE OR REPLACE FUNCTION ledgerly_guard_budget_line_edit() RETURNS trigger AS $$
DECLARE current_status text;
DECLARE current_locked timestamptz;
BEGIN
  SELECT status,locked_at INTO current_status,current_locked FROM budgets WHERE id=COALESCE(NEW.budget_id,OLD.budget_id);
  IF current_locked IS NOT NULL OR current_status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'BUDGET_LOCKED:%', COALESCE(NEW.budget_id,OLD.budget_id) USING ERRCODE='P0001';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER budget_line_edit_guard
BEFORE INSERT OR UPDATE OR DELETE ON budget_lines
FOR EACH ROW EXECUTE FUNCTION ledgerly_guard_budget_line_edit();

CREATE OR REPLACE FUNCTION ledgerly_guard_forecast_line_edit() RETURNS trigger AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM budget_forecasts WHERE id=COALESCE(NEW.forecast_id,OLD.forecast_id);
  IF current_status <> 'draft' THEN
    RAISE EXCEPTION 'FORECAST_LOCKED:%', COALESCE(NEW.forecast_id,OLD.forecast_id) USING ERRCODE='P0001';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER forecast_line_edit_guard
BEFORE INSERT OR UPDATE OR DELETE ON budget_forecast_lines
FOR EACH ROW EXECUTE FUNCTION ledgerly_guard_forecast_line_edit();
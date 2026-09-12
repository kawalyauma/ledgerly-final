CREATE TABLE fixed_asset_categories (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  asset_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  depreciation_expense_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  disposal_gain_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  disposal_loss_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  default_method text NOT NULL DEFAULT 'straight_line' CHECK (default_method IN ('straight_line','declining_balance')),
  default_useful_life_months integer NOT NULL CHECK (default_useful_life_months > 0),
  default_residual_percent numeric(8,4) NOT NULL DEFAULT 0 CHECK (default_residual_percent BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE fixed_assets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES fixed_asset_categories(id) ON DELETE RESTRICT,
  asset_number text NOT NULL,
  name text NOT NULL,
  description text,
  acquisition_date date NOT NULL,
  in_service_date date,
  acquisition_cost_minor bigint NOT NULL CHECK (acquisition_cost_minor >= 0),
  residual_value_minor bigint NOT NULL DEFAULT 0 CHECK (residual_value_minor >= 0),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  depreciation_method text NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line','declining_balance')),
  declining_rate_percent numeric(8,4),
  accumulated_depreciation_minor bigint NOT NULL DEFAULT 0 CHECK (accumulated_depreciation_minor >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','fully_depreciated','disposed','retired')),
  location text,
  custodian text,
  serial_number text,
  reference text,
  acquisition_journal_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  disposal_journal_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  disposal_date date,
  disposal_proceeds_minor bigint,
  disposed_by text,
  last_depreciation_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (residual_value_minor <= acquisition_cost_minor),
  UNIQUE (organization_id,asset_number)
);
CREATE INDEX fixed_assets_org_status_idx ON fixed_assets (organization_id,status,category_id,asset_number);
CREATE INDEX fixed_assets_dates_idx ON fixed_assets (organization_id,in_service_date,disposal_date);

CREATE TABLE fixed_asset_depreciation_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  posting_date date NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  asset_count integer NOT NULL DEFAULT 0 CHECK (asset_count >= 0),
  created_by text NOT NULL,
  posted_by text,
  posted_at timestamptz,
  reversed_by text,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,idempotency_key)
);
CREATE INDEX fixed_asset_runs_org_date_idx ON fixed_asset_depreciation_runs (organization_id,posting_date DESC,status);

CREATE TABLE fixed_asset_depreciation_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES fixed_asset_depreciation_runs(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
  opening_accumulated_minor bigint NOT NULL,
  depreciation_minor bigint NOT NULL CHECK (depreciation_minor > 0),
  closing_accumulated_minor bigint NOT NULL,
  closing_book_value_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,run_id,asset_id)
);
CREATE INDEX fixed_asset_dep_lines_asset_idx ON fixed_asset_depreciation_lines (organization_id,asset_id,run_id);

CREATE TABLE fixed_asset_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','activated','depreciated','depreciation_reversed','disposed','disposal_reversed','retired','transferred')),
  event_date date NOT NULL,
  amount_minor bigint,
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  actor_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fixed_asset_events_asset_date_idx ON fixed_asset_events (organization_id,asset_id,event_date,created_at);

CREATE OR REPLACE FUNCTION ledgerly_validate_fixed_asset_category_accounts() RETURNS trigger AS $$
DECLARE org text;
DECLARE typ text;
BEGIN
  SELECT organization_id,type INTO org,typ FROM accounts WHERE id=NEW.asset_account_id;
  IF org IS DISTINCT FROM NEW.organization_id OR typ IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'FIXED_ASSET_ACCOUNT_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF;
  SELECT organization_id,type INTO org,typ FROM accounts WHERE id=NEW.accumulated_depreciation_account_id;
  IF org IS DISTINCT FROM NEW.organization_id OR typ IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'FIXED_ASSET_ACCUM_ACCOUNT_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF;
  SELECT organization_id,type INTO org,typ FROM accounts WHERE id=NEW.depreciation_expense_account_id;
  IF org IS DISTINCT FROM NEW.organization_id OR typ IS DISTINCT FROM 'expense' THEN RAISE EXCEPTION 'FIXED_ASSET_DEP_EXPENSE_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF;
  IF NEW.disposal_gain_account_id IS NOT NULL THEN SELECT organization_id,type INTO org,typ FROM accounts WHERE id=NEW.disposal_gain_account_id; IF org IS DISTINCT FROM NEW.organization_id OR typ IS DISTINCT FROM 'revenue' THEN RAISE EXCEPTION 'FIXED_ASSET_GAIN_ACCOUNT_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
  IF NEW.disposal_loss_account_id IS NOT NULL THEN SELECT organization_id,type INTO org,typ FROM accounts WHERE id=NEW.disposal_loss_account_id; IF org IS DISTINCT FROM NEW.organization_id OR typ IS DISTINCT FROM 'expense' THEN RAISE EXCEPTION 'FIXED_ASSET_LOSS_ACCOUNT_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fixed_asset_category_account_guard BEFORE INSERT OR UPDATE ON fixed_asset_categories FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_fixed_asset_category_accounts();

CREATE OR REPLACE FUNCTION ledgerly_validate_fixed_asset_tenant() RETURNS trigger AS $$
DECLARE category_org text;
BEGIN
  SELECT organization_id INTO category_org FROM fixed_asset_categories WHERE id=NEW.category_id;
  IF category_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'FIXED_ASSET_CATEGORY_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF;
  IF NEW.accumulated_depreciation_minor > NEW.acquisition_cost_minor-NEW.residual_value_minor THEN RAISE EXCEPTION 'FIXED_ASSET_OVER_DEPRECIATED:%',NEW.id USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fixed_asset_tenant_guard BEFORE INSERT OR UPDATE OF organization_id,category_id,acquisition_cost_minor,residual_value_minor,accumulated_depreciation_minor ON fixed_assets FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_fixed_asset_tenant();

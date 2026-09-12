CREATE TABLE fiscal_years (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  status_reason text,
  closed_at timestamptz,
  closed_by text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on <= ends_on),
  UNIQUE (organization_id,starts_on,ends_on)
);
CREATE INDEX fiscal_years_org_range_idx ON fiscal_years (organization_id,starts_on,ends_on);
CREATE INDEX fiscal_years_org_status_idx ON fiscal_years (organization_id,status,starts_on DESC);

CREATE TABLE fiscal_periods (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year_id text REFERENCES fiscal_years(id) ON DELETE RESTRICT,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  status_reason text,
  closed_at timestamptz,
  closed_by text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on <= ends_on),
  UNIQUE (organization_id,starts_on,ends_on)
);
CREATE INDEX fiscal_periods_org_range_idx ON fiscal_periods (organization_id,starts_on,ends_on);
CREATE INDEX fiscal_periods_year_idx ON fiscal_periods (organization_id,fiscal_year_id,starts_on);
CREATE INDEX fiscal_periods_org_status_idx ON fiscal_periods (organization_id,status,starts_on DESC);

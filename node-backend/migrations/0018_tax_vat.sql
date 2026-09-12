CREATE TABLE tax_jurisdictions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  country text NOT NULL CHECK (char_length(country)=2),
  authority_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE tax_codes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction_id text REFERENCES tax_jurisdictions(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  rate_micros bigint NOT NULL CHECK (rate_micros BETWEEN 0 AND 10000000),
  calculation text NOT NULL CHECK (calculation IN ('inclusive','exclusive')),
  tax_type text NOT NULL CHECK (tax_type IN ('sales','purchase','withholding')),
  recoverable_percent_micros bigint NOT NULL DEFAULT 1000000 CHECK (recoverable_percent_micros BETWEEN 0 AND 1000000),
  sales_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  purchase_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE INDEX tax_codes_jurisdiction_idx ON tax_codes (organization_id,jurisdiction_id,tax_type,active);

CREATE TABLE tax_exemptions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE RESTRICT,
  tax_code_id text REFERENCES tax_codes(id) ON DELETE RESTRICT,
  certificate_number text,
  reason text NOT NULL,
  starts_on date,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);
CREATE INDEX tax_exemptions_lookup_idx ON tax_exemptions (organization_id,contact_id,tax_code_id,active,starts_on,ends_on);

CREATE TABLE tax_returns (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction_id text NOT NULL REFERENCES tax_jurisdictions(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked','filed','amended','void')),
  output_tax_minor bigint NOT NULL DEFAULT 0,
  input_tax_minor bigint NOT NULL DEFAULT 0,
  withholding_minor bigint NOT NULL DEFAULT 0,
  net_tax_minor bigint NOT NULL DEFAULT 0,
  prepared_by text NOT NULL,
  locked_at timestamptz,
  locked_by text,
  filed_at timestamptz,
  filing_reference text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_start <= period_end)
);
CREATE INDEX tax_returns_org_period_idx ON tax_returns (organization_id,jurisdiction_id,period_end DESC,status);
CREATE UNIQUE INDEX tax_returns_one_open_period_uq ON tax_returns (organization_id,jurisdiction_id,period_start,period_end) WHERE status IN ('draft','locked','filed');

CREATE OR REPLACE FUNCTION ledgerly_validate_tax_tenant() RETURNS trigger AS $$
DECLARE ref_org text;
BEGIN
  IF TG_TABLE_NAME='tax_codes' THEN
    IF NEW.jurisdiction_id IS NOT NULL THEN SELECT organization_id INTO ref_org FROM tax_jurisdictions WHERE id=NEW.jurisdiction_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_JURISDICTION_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
    IF NEW.sales_account_id IS NOT NULL THEN SELECT organization_id INTO ref_org FROM accounts WHERE id=NEW.sales_account_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_ACCOUNT_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
    IF NEW.purchase_account_id IS NOT NULL THEN SELECT organization_id INTO ref_org FROM accounts WHERE id=NEW.purchase_account_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_ACCOUNT_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
  ELSIF TG_TABLE_NAME='tax_exemptions' THEN
    IF NEW.contact_id IS NOT NULL THEN SELECT organization_id INTO ref_org FROM contacts WHERE id=NEW.contact_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_EXEMPTION_CONTACT_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
    IF NEW.tax_code_id IS NOT NULL THEN SELECT organization_id INTO ref_org FROM tax_codes WHERE id=NEW.tax_code_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_EXEMPTION_CODE_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF; END IF;
  ELSIF TG_TABLE_NAME='tax_returns' THEN
    SELECT organization_id INTO ref_org FROM tax_jurisdictions WHERE id=NEW.jurisdiction_id; IF ref_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'TAX_RETURN_JURISDICTION_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tax_code_tenant_guard BEFORE INSERT OR UPDATE ON tax_codes FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_tax_tenant();
CREATE TRIGGER tax_exemption_tenant_guard BEFORE INSERT OR UPDATE ON tax_exemptions FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_tax_tenant();
CREATE TRIGGER tax_return_tenant_guard BEFORE INSERT OR UPDATE ON tax_returns FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_tax_tenant();

CREATE UNIQUE INDEX budget_lines_dimension_uq
ON budget_lines (organization_id,budget_id,account_id,period,cost_center_id,revenue_source_id,project_id,class_id,department_id,location_id)
NULLS NOT DISTINCT;

CREATE UNIQUE INDEX budget_forecast_lines_dimension_uq
ON budget_forecast_lines (organization_id,forecast_id,account_id,period,cost_center_id,revenue_source_id,project_id,class_id,department_id,location_id)
NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION ledgerly_validate_cost_center_tenant() RETURNS trigger AS $$
DECLARE parent_org text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT organization_id INTO parent_org FROM cost_centers WHERE id=NEW.parent_id;
    IF parent_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'COST_CENTER_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cost_center_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,parent_id ON cost_centers
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_cost_center_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_revenue_source_tenant() RETURNS trigger AS $$
DECLARE account_org text;
DECLARE account_type text;
BEGIN
  SELECT organization_id,type INTO account_org,account_type FROM accounts WHERE id=NEW.revenue_account_id;
  IF account_org IS DISTINCT FROM NEW.organization_id OR account_type IS DISTINCT FROM 'revenue' THEN
    RAISE EXCEPTION 'REVENUE_SOURCE_ACCOUNT_INVALID:%', NEW.id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER revenue_source_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,revenue_account_id ON revenue_sources
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_revenue_source_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_budget_tenant() RETURNS trigger AS $$
DECLARE parent_org text;
DECLARE year_org text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT organization_id INTO parent_org FROM budgets WHERE id=NEW.parent_id;
    IF parent_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'BUDGET_PARENT_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.fiscal_year_id IS NOT NULL THEN
    SELECT organization_id INTO year_org FROM fiscal_years WHERE id=NEW.fiscal_year_id;
    IF year_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'BUDGET_FISCAL_YEAR_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER budget_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,parent_id,fiscal_year_id ON budgets
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_budget_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_budget_line_tenant() RETURNS trigger AS $$
DECLARE budget_org text;
DECLARE account_org text;
DECLARE cost_org text;
DECLARE source_org text;
DECLARE source_account text;
BEGIN
  SELECT organization_id INTO budget_org FROM budgets WHERE id=NEW.budget_id;
  SELECT organization_id INTO account_org FROM accounts WHERE id=NEW.account_id;
  IF budget_org IS DISTINCT FROM NEW.organization_id OR account_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'BUDGET_LINE_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
  END IF;
  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT organization_id INTO cost_org FROM cost_centers WHERE id=NEW.cost_center_id;
    IF cost_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'BUDGET_COST_CENTER_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.revenue_source_id IS NOT NULL THEN
    SELECT organization_id,revenue_account_id INTO source_org,source_account FROM revenue_sources WHERE id=NEW.revenue_source_id;
    IF source_org IS DISTINCT FROM NEW.organization_id OR source_account IS DISTINCT FROM NEW.account_id THEN
      RAISE EXCEPTION 'BUDGET_REVENUE_SOURCE_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER budget_line_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,budget_id,account_id,cost_center_id,revenue_source_id ON budget_lines
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_budget_line_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_forecast_line_tenant() RETURNS trigger AS $$
DECLARE forecast_org text;
DECLARE account_org text;
DECLARE cost_org text;
DECLARE source_org text;
DECLARE source_account text;
BEGIN
  SELECT organization_id INTO forecast_org FROM budget_forecasts WHERE id=NEW.forecast_id;
  SELECT organization_id INTO account_org FROM accounts WHERE id=NEW.account_id;
  IF forecast_org IS DISTINCT FROM NEW.organization_id OR account_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'FORECAST_LINE_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
  END IF;
  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT organization_id INTO cost_org FROM cost_centers WHERE id=NEW.cost_center_id;
    IF cost_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'FORECAST_COST_CENTER_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.revenue_source_id IS NOT NULL THEN
    SELECT organization_id,revenue_account_id INTO source_org,source_account FROM revenue_sources WHERE id=NEW.revenue_source_id;
    IF source_org IS DISTINCT FROM NEW.organization_id OR source_account IS DISTINCT FROM NEW.account_id THEN
      RAISE EXCEPTION 'FORECAST_REVENUE_SOURCE_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER forecast_line_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,forecast_id,account_id,cost_center_id,revenue_source_id ON budget_forecast_lines
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_forecast_line_tenant();
CREATE TABLE dimensions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('class','department','location')),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,type,code)
);
CREATE INDEX dimensions_org_type_idx ON dimensions (organization_id,type,active,code);

CREATE TABLE projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id text REFERENCES contacts(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','archived')),
  budget_amount_minor bigint NOT NULL DEFAULT 0 CHECK (budget_amount_minor >= 0),
  start_date date,
  end_date date,
  manager_user_id text REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  UNIQUE (organization_id,code)
);
CREATE INDEX projects_org_status_idx ON projects (organization_id,status,code);
CREATE INDEX projects_customer_idx ON projects (organization_id,customer_id,status) WHERE customer_id IS NOT NULL;

CREATE TABLE project_time_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description text,
  billable boolean NOT NULL DEFAULT false,
  billed boolean NOT NULL DEFAULT false,
  cost_rate_minor bigint NOT NULL DEFAULT 0 CHECK (cost_rate_minor >= 0),
  billing_rate_minor bigint NOT NULL DEFAULT 0 CHECK (billing_rate_minor >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX project_time_entries_project_date_idx ON project_time_entries (organization_id,project_id,entry_date,status);
CREATE INDEX project_time_entries_user_date_idx ON project_time_entries (organization_id,user_id,entry_date);

CREATE OR REPLACE FUNCTION ledgerly_validate_project_tenant() RETURNS trigger AS $$
DECLARE contact_org text;
DECLARE contact_type text;
DECLARE manager_org text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT organization_id,type INTO contact_org,contact_type FROM contacts WHERE id=NEW.customer_id;
    IF contact_org IS DISTINCT FROM NEW.organization_id OR contact_type IS DISTINCT FROM 'customer' THEN
      RAISE EXCEPTION 'PROJECT_CUSTOMER_INVALID:%',NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.manager_user_id IS NOT NULL THEN
    SELECT organization_id INTO manager_org FROM memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.manager_user_id;
    IF manager_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'PROJECT_MANAGER_INVALID:%',NEW.id USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_tenant_guard BEFORE INSERT OR UPDATE OF organization_id,customer_id,manager_user_id ON projects FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_project_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_project_time_tenant() RETURNS trigger AS $$
DECLARE project_org text;
BEGIN
  SELECT organization_id INTO project_org FROM projects WHERE id=NEW.project_id;
  IF project_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'PROJECT_TIME_TENANT_MISMATCH:%',NEW.id USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_time_tenant_guard BEFORE INSERT OR UPDATE OF organization_id,project_id ON project_time_entries FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_project_time_tenant();

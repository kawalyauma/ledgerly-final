CREATE TABLE prn_quotas (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope_type text NOT NULL DEFAULT 'organization' CHECK (scope_type IN ('organization','user','project')),
  scope_id text,
  mode text NOT NULL DEFAULT 'soft' CHECK (mode IN ('soft','hard')),
  max_impressions bigint NOT NULL DEFAULT 0 CHECK (max_impressions>=0),
  max_sheets bigint NOT NULL DEFAULT 0 CHECK (max_sheets>=0),
  max_cost_minor bigint NOT NULL DEFAULT 0 CHECK (max_cost_minor>=0),
  warning_percent integer NOT NULL DEFAULT 80 CHECK (warning_percent BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_quotas_org_idx ON prn_quotas(organization_id,active,scope_type,scope_id);
CREATE UNIQUE INDEX prn_quotas_active_scope_uq ON prn_quotas(organization_id,scope_type,COALESCE(scope_id,'')) WHERE active=true;

CREATE TABLE prn_print_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  match_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_print_rules_org_idx ON prn_print_rules(organization_id,active,priority,created_at);

CREATE TABLE prn_approvals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  rule_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approver_roles jsonb NOT NULL DEFAULT '["owner","admin"]'::jsonb,
  approver_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_self_approval boolean NOT NULL DEFAULT false,
  decided_by text REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  UNIQUE (organization_id,job_id)
);
CREATE INDEX prn_approvals_org_idx ON prn_approvals(organization_id,status,requested_at DESC);

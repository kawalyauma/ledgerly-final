ALTER TABLE lai_approvals
  ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'single'
    CHECK(approval_mode IN ('single','two_step')),
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 1 CHECK(required_approvals BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS approval_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS lai_approval_reviews (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  note TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(approval_id,reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_lai_approval_reviews_approval
  ON lai_approval_reviews(organization_id,approval_id,created_at);

CREATE TABLE IF NOT EXISTS lai_policy_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  action_pattern TEXT NOT NULL,
  agent_key TEXT,
  min_risk TEXT CHECK(min_risk IN ('low','medium','high','critical')),
  mutating_only BOOLEAN NOT NULL DEFAULT FALSE,
  production_only BOOLEAN NOT NULL DEFAULT FALSE,
  effect TEXT NOT NULL CHECK(effect IN ('auto','single','two_step','deny')),
  reviewer_role TEXT CHECK(reviewer_role IN ('admin','owner')),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_policy_rules_org
  ON lai_policy_rules(organization_id,enabled,priority,id);

CREATE TABLE IF NOT EXISTS lai_ai_controls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('organization','agent')),
  scope_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('active','paused','stopped')),
  reason TEXT,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,scope_type,scope_id)
);
CREATE INDEX IF NOT EXISTS idx_lai_ai_controls_org
  ON lai_ai_controls(organization_id,scope_type,state);

CREATE TABLE IF NOT EXISTS lai_privileged_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','agent','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  correlation_id TEXT NOT NULL,
  risk_level TEXT CHECK(risk_level IN ('low','medium','high','critical')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_privileged_audit_org_recent
  ON lai_privileged_audit(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_privileged_audit_entity
  ON lai_privileged_audit(organization_id,entity_type,entity_id,created_at DESC);

CREATE OR REPLACE FUNCTION lai_forbid_immutable_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledgerly AI immutable audit records cannot be modified';
END;
$$;

DROP TRIGGER IF EXISTS lai_privileged_audit_immutable ON lai_privileged_audit;
CREATE TRIGGER lai_privileged_audit_immutable
BEFORE UPDATE OR DELETE ON lai_privileged_audit
FOR EACH ROW EXECUTE FUNCTION lai_forbid_immutable_change();

DROP TRIGGER IF EXISTS lai_approval_reviews_immutable ON lai_approval_reviews;
CREATE TRIGGER lai_approval_reviews_immutable
BEFORE UPDATE OR DELETE ON lai_approval_reviews
FOR EACH ROW EXECUTE FUNCTION lai_forbid_immutable_change();

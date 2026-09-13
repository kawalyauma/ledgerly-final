CREATE TABLE nvr_event_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  camera_id text REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  event_type text,
  min_severity text NOT NULL DEFAULT 'warning' CHECK (min_severity IN ('info','warning','critical')),
  recipient_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipient_user_ids)='array'),
  cooldown_seconds integer NOT NULL DEFAULT 300 CHECK (cooldown_seconds BETWEEN 0 AND 86400),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nvr_event_rules_org_idx ON nvr_event_rules(organization_id,active,camera_id,event_type);

CREATE TABLE nvr_rule_evaluations (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES nvr_events(id) ON DELETE CASCADE,
  rule_id text NOT NULL REFERENCES nvr_event_rules(id) ON DELETE CASCADE,
  matched boolean NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,event_id,rule_id)
);

CREATE TABLE nvr_alert_notifications (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES nvr_events(id) ON DELETE CASCADE,
  rule_id text REFERENCES nvr_event_rules(id) ON DELETE SET NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,event_id,rule_id,user_id)
);
CREATE INDEX nvr_alert_notifications_user_idx ON nvr_alert_notifications(organization_id,user_id,created_at DESC);

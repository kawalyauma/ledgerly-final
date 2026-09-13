ALTER TABLE prn_printers ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE prn_printers ADD COLUMN IF NOT EXISTS health_message text;
ALTER TABLE prn_printers ADD COLUMN IF NOT EXISTS state_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE prn_printers ADD COLUMN IF NOT EXISTS marker_levels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE prn_printers ADD COLUMN IF NOT EXISTS last_health_at timestamptz;

CREATE TABLE prn_alerts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by text REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX prn_alerts_active_fingerprint_idx ON prn_alerts(organization_id,fingerprint) WHERE resolved_at IS NULL;

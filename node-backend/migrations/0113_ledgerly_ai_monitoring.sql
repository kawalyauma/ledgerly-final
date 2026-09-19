ALTER TABLE lai_incidents
  ADD COLUMN IF NOT EXISTS last_timeline_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suppressed_signal_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regression_of_incident_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lai_incidents_dispatch
  ON lai_incidents(status,last_dispatch_at,severity,last_seen_at)
  WHERE status='open';

CREATE TABLE IF NOT EXISTS lai_monitor_samples (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  monitor_type TEXT NOT NULL
    CHECK(monitor_type IN ('database','queue','docker','resources','deployment','ci','application')),
  sample_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','warning','critical','unknown')),
  message TEXT,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_monitor_samples_recent
  ON lai_monitor_samples(monitor_type,sample_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_monitor_samples_org_recent
  ON lai_monitor_samples(organization_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS lai_monitor_state (
  state_key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lai_monitor_summaries (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  period_type TEXT NOT NULL CHECK(period_type IN ('daily','weekly')),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy','attention','critical')),
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_monitor_summary_window
  ON lai_monitor_summaries(COALESCE(organization_id,''),period_type,window_start);
CREATE INDEX IF NOT EXISTS idx_lai_monitor_summary_recent
  ON lai_monitor_summaries(organization_id,period_type,window_end DESC);

CREATE TABLE nvr_storage_policies (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  max_bytes bigint NOT NULL DEFAULT 107374182400 CHECK (max_bytes>0),
  high_watermark_percent integer NOT NULL DEFAULT 85 CHECK (high_watermark_percent BETWEEN 50 AND 99),
  critical_watermark_percent integer NOT NULL DEFAULT 95 CHECK (critical_watermark_percent BETWEEN 60 AND 100),
  min_local_free_bytes bigint NOT NULL DEFAULT 5368709120 CHECK (min_local_free_bytes>=0),
  cleanup_target_percent integer NOT NULL DEFAULT 75 CHECK (cleanup_target_percent BETWEEN 10 AND 95),
  automatic_cleanup boolean NOT NULL DEFAULT true,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nvr_storage_pressure_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pressure_level text NOT NULL CHECK (pressure_level IN ('normal','high','critical')),
  used_bytes bigint NOT NULL DEFAULT 0,
  quota_bytes bigint NOT NULL,
  local_free_bytes bigint,
  deleted_recordings integer NOT NULL DEFAULT 0,
  reclaimed_bytes bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nvr_storage_pressure_events_org_idx ON nvr_storage_pressure_events(organization_id,created_at DESC);

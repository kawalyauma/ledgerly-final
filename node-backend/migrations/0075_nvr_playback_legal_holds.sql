CREATE TABLE nvr_recording_holds (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recording_id text NOT NULL REFERENCES nvr_recordings(id) ON DELETE CASCADE,
  reason text NOT NULL,
  held_by text REFERENCES users(id) ON DELETE SET NULL,
  held_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by text REFERENCES users(id) ON DELETE SET NULL,
  released_at timestamptz
);
CREATE INDEX nvr_recording_holds_org_idx ON nvr_recording_holds(organization_id,recording_id,held_at DESC);
CREATE UNIQUE INDEX nvr_recording_holds_active_uq ON nvr_recording_holds(organization_id,recording_id) WHERE released_at IS NULL;

CREATE TABLE nvr_recording_exports (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recording_id text NOT NULL REFERENCES nvr_recordings(id) ON DELETE CASCADE,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  export_type text NOT NULL DEFAULT 'manifest' CHECK (export_type IN ('manifest','download')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nvr_recording_exports_org_idx ON nvr_recording_exports(organization_id,recording_id,created_at DESC);

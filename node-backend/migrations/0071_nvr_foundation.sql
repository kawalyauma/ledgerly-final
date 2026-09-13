CREATE TABLE nvr_cameras (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  source_type text NOT NULL DEFAULT 'phone' CHECK (source_type IN ('phone','rtsp','onvif','usb','other')),
  source_uri text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','online','recording','disabled','error')),
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  last_error text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nvr_cameras_org_idx ON nvr_cameras(organization_id,enabled,status,name);

CREATE TABLE nvr_recordings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id text NOT NULL REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  mime_type text NOT NULL DEFAULT 'video/mp4',
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes>=0),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds>=0),
  status text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','ready','failed','deleted')),
  checksum_sha256 text,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,object_key)
);
CREATE INDEX nvr_recordings_org_camera_idx ON nvr_recordings(organization_id,camera_id,started_at DESC);
CREATE INDEX nvr_recordings_retention_idx ON nvr_recordings(status,retention_until) WHERE status='ready';

CREATE TABLE nvr_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id text REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by text REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz
);
CREATE INDEX nvr_events_org_idx ON nvr_events(organization_id,occurred_at DESC);

CREATE TABLE nvr_stream_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id text NOT NULL REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  transport text NOT NULL DEFAULT 'webrtc' CHECK (transport IN ('webrtc','hls','rtsp_proxy')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','closed','failed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at timestamptz
);
CREATE INDEX nvr_stream_sessions_org_idx ON nvr_stream_sessions(organization_id,camera_id,status,created_at DESC);

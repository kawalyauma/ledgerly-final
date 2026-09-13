CREATE TABLE nvr_stream_signals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES nvr_stream_sessions(id) ON DELETE CASCADE,
  camera_id text NOT NULL REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('viewer','camera')),
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('offer','answer','ice','ready','close','error')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nvr_stream_signals_session_idx ON nvr_stream_signals(organization_id,session_id,created_at,id);
CREATE INDEX nvr_stream_sessions_expiry_idx ON nvr_stream_sessions(status,expires_at) WHERE status IN ('requested','active');

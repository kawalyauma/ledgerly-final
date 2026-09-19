CREATE TABLE IF NOT EXISTS lai_idempotency_keys (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  response_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  PRIMARY KEY (organization_id, user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_lai_idempotency_expiry ON lai_idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS lai_rate_counters (
  organization_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization','user','agent')),
  scope_id TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope_type, scope_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_lai_rate_counters_recent ON lai_rate_counters(bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_lai_chats_creator_recent
  ON lai_chats(organization_id, created_by, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_messages_user_recent
  ON lai_messages(organization_id, user_id, created_at DESC);

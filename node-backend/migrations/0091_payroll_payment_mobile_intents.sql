CREATE TABLE pay_mobile_payment_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  payload_json jsonb NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  client_created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  server_payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  applied_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX pay_mobile_payment_pending_idx ON pay_mobile_payment_intents(status,next_attempt_at,created_at);
CREATE INDEX pay_mobile_payment_org_idx ON pay_mobile_payment_intents(organization_id,created_at DESC);

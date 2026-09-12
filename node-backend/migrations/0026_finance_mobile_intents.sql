CREATE TABLE ledgerly_mobile_document_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text,
  intent_type text NOT NULL CHECK (intent_type IN ('invoice','bill')),
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
  server_document_id text REFERENCES documents(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text,
  error_message text,
  next_attempt_at timestamptz,
  created_by text NOT NULL,
  client_created_at timestamptz NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mobile_document_intents_pending_idx ON ledgerly_mobile_document_intents(status,next_attempt_at,created_at) WHERE status IN ('pending','retry','processing');
CREATE INDEX mobile_document_intents_org_idx ON ledgerly_mobile_document_intents(organization_id,created_at DESC);

CREATE TABLE ledgerly_mobile_journal_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
  server_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text,
  error_message text,
  next_attempt_at timestamptz,
  created_by text NOT NULL,
  client_created_at timestamptz NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mobile_journal_intents_pending_idx ON ledgerly_mobile_journal_intents(status,next_attempt_at,created_at) WHERE status IN ('pending','retry','processing');
CREATE INDEX mobile_journal_intents_org_idx ON ledgerly_mobile_journal_intents(organization_id,created_at DESC);

CREATE TABLE webhook_endpoints (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url text NOT NULL,
  description text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events)='array'),
  secret_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX webhook_endpoints_org_idx ON webhook_endpoints(organization_id,active,created_at DESC);

CREATE TABLE webhook_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivering','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  response_status integer,
  response_body text,
  error text,
  queue_job_id text,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,endpoint_id,event_id)
);
CREATE INDEX webhook_deliveries_org_idx ON webhook_deliveries(organization_id,created_at DESC);
CREATE INDEX webhook_deliveries_pending_idx ON webhook_deliveries(status,created_at) WHERE status IN ('queued','failed');

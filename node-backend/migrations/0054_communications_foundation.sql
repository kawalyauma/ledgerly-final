CREATE TABLE communication_message_types (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  name text NOT NULL,
  module_key text NOT NULL DEFAULT 'custom',
  category text NOT NULL DEFAULT 'general',
  audience_kind text NOT NULL,
  subject_template text NOT NULL,
  message_template text NOT NULL,
  audience_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  system_type boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,type_key)
);

CREATE TABLE communication_campaigns (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_type_id text REFERENCES communication_message_types(id) ON DELETE SET NULL,
  type_key text NOT NULL,
  module_key text NOT NULL DEFAULT 'custom',
  name text NOT NULL,
  sender_name text,
  subject_template text NOT NULL,
  message_template text NOT NULL,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience_kind text NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','queued','sending','completed','failed','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  delivery_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX communication_campaigns_status_idx ON communication_campaigns(organization_id,status,scheduled_at,created_at DESC);

CREATE TABLE communication_recipients (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  recipient_type text NOT NULL,
  recipient_id text,
  related_entity_type text,
  related_entity_id text,
  recipient_name text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','skipped','queued','sent','failed')),
  skip_reason text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX communication_recipients_campaign_idx ON communication_recipients(organization_id,campaign_id,status);

CREATE TABLE communication_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  recipient_snapshot_id text NOT NULL REFERENCES communication_recipients(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  recipient_phone text,
  recipient_email text,
  provider text,
  rendered_subject text,
  rendered_message text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX communication_deliveries_queue_idx ON communication_deliveries(organization_id,status,channel,created_at);

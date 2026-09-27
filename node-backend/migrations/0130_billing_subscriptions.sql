-- Ledgerly subscription billing: one plan per organization, one invoice per school term,
-- and mobile-money (Ssentezo) or manually recorded payments against those invoices.
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','standard','premium')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  notes text,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  period_label text NOT NULL,
  starts_on date,
  ends_on date,
  plan text NOT NULL,
  rate_ugx integer NOT NULL,
  students integer NOT NULL DEFAULT 0,
  amount_ugx bigint NOT NULL DEFAULT 0,
  paid_ugx bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, period_key)
);

CREATE TABLE IF NOT EXISTS billing_payments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id text REFERENCES billing_invoices(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('ssentezo','manual')),
  external_reference text NOT NULL UNIQUE,
  msisdn text,
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','indeterminate')),
  provider_reference text,
  financial_transaction_id text,
  failure_reason text,
  note text,
  recorded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_org ON billing_payments (organization_id, created_at DESC);

-- Schools already using Ledgerly move to the Standard plan; new sign-ups start on Free.
INSERT INTO billing_subscriptions (organization_id, plan, notes)
SELECT id, 'standard', 'Existing school enrolled on Standard at billing launch' FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Payment-provider credentials entered by the platform admin in the admin portal.
-- The API key is stored encrypted (AES-256-GCM envelope) and never returned by the API.
CREATE TABLE IF NOT EXISTS billing_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  ssentezo_env text NOT NULL DEFAULT 'sandbox' CHECK (ssentezo_env IN ('sandbox','live')),
  ssentezo_api_user text,
  ssentezo_api_key_encrypted jsonb,
  public_url text,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schoolpay_configurations (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  school_code text NOT NULL UNIQUE,
  api_password_ciphertext text NOT NULL,
  api_password_iv text NOT NULL,
  api_password_tag text NOT NULL,
  webhook_key text NOT NULL UNIQUE,
  bank_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  control_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  auto_allocate boolean NOT NULL DEFAULT true,
  last_webhook_at timestamptz,
  last_reconciled_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schoolpay_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schoolpay_receipt_number text NOT NULL,
  source_transaction_id text,
  source_payment_channel text,
  student_payment_code text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  payment_date date NOT NULL,
  payment_timestamp text NOT NULL,
  event_type text NOT NULL DEFAULT 'SCHOOL_FEES',
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','posted','unmatched','failed','ignored')),
  payload jsonb NOT NULL,
  payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  school_fee_receipt_id text REFERENCES school_fee_receipts(id) ON DELETE SET NULL,
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,schoolpay_receipt_number)
);
CREATE INDEX schoolpay_events_status_idx ON schoolpay_events(organization_id,status,created_at DESC);
CREATE INDEX schoolpay_events_student_idx ON schoolpay_events(organization_id,student_payment_code,created_at DESC);

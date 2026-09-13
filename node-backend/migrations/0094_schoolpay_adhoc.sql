CREATE TABLE schoolpay_adhoc_intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_payment_code text NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK(method IN ('register','request')),
  event_type text NOT NULL DEFAULT 'SCHOOL_FEES' CHECK(event_type IN ('SCHOOL_FEES','OTHER_FEES')),
  external_reference text NOT NULL,
  payment_reference text,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  phone_number text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  reason text NOT NULL,
  callback_url text NOT NULL,
  status text NOT NULL DEFAULT 'initiating' CHECK(status IN ('initiating','pending','paid','posting_failed','failed')),
  provider_status text,
  return_code integer,
  return_message text,
  receipt_number text,
  transaction_id text,
  channel_name text,
  schoolpay_event_id text REFERENCES schoolpay_events(id) ON DELETE SET NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_response jsonb,
  last_callback_payload jsonb,
  last_check_payload jsonb,
  error text,
  created_by text,
  callback_received_at timestamptz,
  last_checked_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,external_reference)
);

CREATE UNIQUE INDEX schoolpay_adhoc_payment_reference_uq
  ON schoolpay_adhoc_intents(organization_id,payment_reference)
  WHERE payment_reference IS NOT NULL;
CREATE INDEX schoolpay_adhoc_org_status_idx
  ON schoolpay_adhoc_intents(organization_id,status,created_at DESC);
CREATE INDEX schoolpay_adhoc_student_idx
  ON schoolpay_adhoc_intents(organization_id,student_payment_code,created_at DESC);

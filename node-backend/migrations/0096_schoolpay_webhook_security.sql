CREATE TABLE schoolpay_security_audit (
  id bigserial PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  webhook_key_fingerprint text NOT NULL,
  endpoint_type text NOT NULL CHECK(endpoint_type IN ('fees_webhook','adhoc_callback')),
  outcome text NOT NULL CHECK(outcome IN ('allowed','rejected_ip','invalid_payload','processed','failed')),
  source_ip text,
  direct_peer_ip text,
  forwarded_for text,
  identifier text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX schoolpay_security_audit_org_created_idx
  ON schoolpay_security_audit(organization_id,created_at DESC);
CREATE INDEX schoolpay_security_audit_outcome_created_idx
  ON schoolpay_security_audit(outcome,created_at DESC);

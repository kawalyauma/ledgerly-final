ALTER TABLE schoolpay_adhoc_intents
  ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0 CHECK(recovery_attempts>=0),
  ADD COLUMN next_recovery_at timestamptz,
  ADD COLUMN recovery_checked_at timestamptz,
  ADD COLUMN last_recovery_error text;

UPDATE schoolpay_adhoc_intents
SET next_recovery_at=CURRENT_TIMESTAMP
WHERE status IN ('pending','posting_failed')
  AND payment_reference IS NOT NULL;

CREATE INDEX schoolpay_adhoc_recovery_due_idx
  ON schoolpay_adhoc_intents(next_recovery_at,created_at)
  WHERE status IN ('pending','posting_failed') AND payment_reference IS NOT NULL;

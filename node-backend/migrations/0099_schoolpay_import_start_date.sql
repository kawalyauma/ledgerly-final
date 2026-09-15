-- Protect schools that have already migrated historical SchoolPay transactions.
-- Existing configurations default to the migration date so historical imports are blocked
-- until an administrator explicitly chooses the school's intended go-live/import start date.
ALTER TABLE schoolpay_configurations
  ADD COLUMN IF NOT EXISTS import_start_date date;

UPDATE schoolpay_configurations
SET import_start_date = CURRENT_DATE
WHERE import_start_date IS NULL;

ALTER TABLE schoolpay_configurations
  ALTER COLUMN import_start_date SET NOT NULL;

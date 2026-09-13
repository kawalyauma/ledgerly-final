ALTER TABLE nvr_cameras ADD COLUMN IF NOT EXISTS device_identifier text;
ALTER TABLE nvr_cameras ADD COLUMN IF NOT EXISTS device_secret_digest text;
ALTER TABLE nvr_cameras ADD COLUMN IF NOT EXISTS paired_at timestamptz;
ALTER TABLE nvr_cameras ADD COLUMN IF NOT EXISTS pairing_code_digest text;
ALTER TABLE nvr_cameras ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz;

ALTER TABLE school_staff_profiles
  ADD COLUMN IF NOT EXISTS active boolean
  GENERATED ALWAYS AS (employment_status = 'active' AND deleted_at IS NULL) STORED;

CREATE INDEX IF NOT EXISTS school_staff_profiles_active_idx
  ON school_staff_profiles(organization_id, active)
  WHERE active = true;

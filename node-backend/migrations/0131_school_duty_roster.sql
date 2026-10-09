-- Teacher-on-duty roster: who covers duty for a date range, shown on school displays.
CREATE TABLE IF NOT EXISTS school_duty_rosters (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  duty_role TEXT NOT NULL DEFAULT 'Teacher on duty',
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS school_duty_rosters_org_dates_idx ON school_duty_rosters(organization_id, starts_on, ends_on);

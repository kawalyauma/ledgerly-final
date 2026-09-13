CREATE TABLE school_guardian_portal_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guardian_id text NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,guardian_id),
  UNIQUE (organization_id,user_id)
);
CREATE INDEX school_guardian_portal_user_idx ON school_guardian_portal_accounts(organization_id,user_id) WHERE active=true;

CREATE TABLE school_parent_portal_preferences (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guardian_id text NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  email_notifications boolean NOT NULL DEFAULT true,
  sms_notifications boolean NOT NULL DEFAULT true,
  whatsapp_notifications boolean NOT NULL DEFAULT true,
  attendance_alerts boolean NOT NULL DEFAULT true,
  fee_alerts boolean NOT NULL DEFAULT true,
  clinic_alerts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,guardian_id)
);

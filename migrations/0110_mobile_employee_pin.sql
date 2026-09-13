CREATE TABLE IF NOT EXISTS school_mobile_pins (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_fingerprint TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id),
  UNIQUE (organization_id, pin_fingerprint),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_school_mobile_pins_org
  ON school_mobile_pins (organization_id);

CREATE TABLE IF NOT EXISTS school_mobile_pin_rate_limits (
  organization_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, client_key)
);

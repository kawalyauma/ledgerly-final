CREATE TABLE app_modules (
  module_key text PRIMARY KEY,
  name text NOT NULL,
  version text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  core boolean NOT NULL DEFAULT false,
  manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_modules (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  configuration_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_by text,
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,module_key)
);
CREATE INDEX organization_modules_enabled_idx ON organization_modules(organization_id,enabled,module_key);

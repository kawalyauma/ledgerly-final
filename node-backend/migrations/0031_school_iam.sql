CREATE TABLE school_roles (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  role_category text NOT NULL DEFAULT 'custom',
  system_role boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE TABLE school_role_permissions (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES school_roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  PRIMARY KEY (organization_id,role_id,permission)
);
CREATE TABLE school_user_profiles (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username text,
  phone text,
  staff_number text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','locked')),
  force_password_change boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,user_id),
  UNIQUE (organization_id,username),
  UNIQUE (organization_id,staff_number)
);
CREATE TABLE school_login_aliases (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_type text NOT NULL CHECK (alias_type IN ('username','phone','staff_number')),
  alias_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,alias_type,alias_normalized)
);
CREATE TABLE school_user_roles (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES school_roles(id) ON DELETE CASCADE,
  assigned_by text,
  assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,user_id,role_id)
);
CREATE INDEX school_user_roles_user_idx ON school_user_roles(organization_id,user_id);

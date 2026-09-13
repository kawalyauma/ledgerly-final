CREATE TABLE nvr_camera_groups (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  zone text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,name)
);

CREATE TABLE nvr_camera_group_members (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES nvr_camera_groups(id) ON DELETE CASCADE,
  camera_id text NOT NULL REFERENCES nvr_cameras(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,group_id,camera_id)
);

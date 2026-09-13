CREATE TABLE nvr_camera_group_shares (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES nvr_camera_groups(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer','manager')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,group_id,user_id)
);
CREATE INDEX nvr_camera_group_shares_user_idx ON nvr_camera_group_shares(organization_id,user_id,role);

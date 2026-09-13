CREATE UNIQUE INDEX IF NOT EXISTS nvr_cameras_org_id_uq ON nvr_cameras(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS nvr_camera_groups_org_id_uq ON nvr_camera_groups(organization_id,id);

ALTER TABLE nvr_camera_group_members
  ADD CONSTRAINT nvr_camera_group_members_group_tenant_fk
  FOREIGN KEY (organization_id,group_id)
  REFERENCES nvr_camera_groups(organization_id,id)
  ON DELETE CASCADE;

ALTER TABLE nvr_camera_group_members
  ADD CONSTRAINT nvr_camera_group_members_camera_tenant_fk
  FOREIGN KEY (organization_id,camera_id)
  REFERENCES nvr_cameras(organization_id,id)
  ON DELETE CASCADE;

ALTER TABLE nvr_camera_group_shares
  ADD CONSTRAINT nvr_camera_group_shares_group_tenant_fk
  FOREIGN KEY (organization_id,group_id)
  REFERENCES nvr_camera_groups(organization_id,id)
  ON DELETE CASCADE;

ALTER TABLE nvr_camera_group_shares
  ADD CONSTRAINT nvr_camera_group_shares_membership_fk
  FOREIGN KEY (organization_id,user_id)
  REFERENCES memberships(organization_id,user_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS nvr_camera_group_members_camera_access_idx
  ON nvr_camera_group_members(organization_id,camera_id,group_id);
CREATE INDEX IF NOT EXISTS nvr_camera_group_shares_access_idx
  ON nvr_camera_group_shares(organization_id,user_id,group_id);

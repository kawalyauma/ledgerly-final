CREATE OR REPLACE FUNCTION ledgerly_sync_school_membership_scopes(p_org text,p_user text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  role_scopes jsonb := '[]'::jsonb;
  preserved jsonb := '[]'::jsonb;
  derived jsonb := '[]'::jsonb;
  has_read boolean := false;
  has_write boolean := false;
  has_exam_read boolean := false;
  has_exam_write boolean := false;
  has_comms_read boolean := false;
  has_comms_write boolean := false;
  has_payroll_read boolean := false;
  has_payroll_write boolean := false;
BEGIN
  SELECT COALESCE(jsonb_agg(permission ORDER BY permission),'[]'::jsonb)
  INTO role_scopes
  FROM (
    SELECT DISTINCT rp.permission
    FROM school_user_roles ur
    JOIN school_roles r ON r.id=ur.role_id AND r.organization_id=ur.organization_id AND r.active=true
    JOIN school_role_permissions rp ON rp.role_id=ur.role_id AND rp.organization_id=ur.organization_id AND rp.effect='allow'
    WHERE ur.organization_id=p_org AND ur.user_id=p_user
  ) x;

  SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb)
  INTO preserved
  FROM (
    SELECT DISTINCT value
    FROM memberships m, jsonb_array_elements_text(COALESCE(m.scopes,'[]'::jsonb)) value
    WHERE m.organization_id=p_org AND m.user_id=p_user
      AND value NOT LIKE 'school.%'
      AND value NOT IN ('school:read','school:write','exams:read','exams:write','communications:read','communications:write','payroll:read','payroll:write')
      AND value NOT LIKE 'attendance:%'
  ) keep;

  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s LIKE 'school.%') INTO has_read;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s ~ ':(write|approve|manage|publish|send)$') INTO has_write;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s LIKE 'school.exams:%') INTO has_exam_read;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s ~ '^school\.exams:(write|manage|publish)$') INTO has_exam_write;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s LIKE 'school.communications:%') INTO has_comms_read;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s ~ '^school\.communications:(send|manage)$') INTO has_comms_write;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s='school.staff.payroll:read') INTO has_payroll_read;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(role_scopes) s WHERE s='school.staff.payroll:write') INTO has_payroll_write;

  derived := role_scopes;
  IF has_read THEN derived := derived || '["school:read"]'::jsonb; END IF;
  IF has_write THEN derived := derived || '["school:write"]'::jsonb; END IF;
  IF has_exam_read THEN derived := derived || '["exams:read"]'::jsonb; END IF;
  IF has_exam_write THEN derived := derived || '["exams:write"]'::jsonb; END IF;
  IF has_comms_read THEN derived := derived || '["communications:read"]'::jsonb; END IF;
  IF has_comms_write THEN derived := derived || '["communications:write"]'::jsonb; END IF;
  IF has_payroll_read THEN derived := derived || '["payroll:read"]'::jsonb; END IF;
  IF has_payroll_write THEN derived := derived || '["payroll:write"]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb)
  INTO derived
  FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(preserved || derived) value) merged;

  UPDATE memberships SET scopes=derived,updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=p_org AND user_id=p_user;
END $$;

CREATE OR REPLACE FUNCTION ledgerly_school_user_role_scope_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledgerly_sync_school_membership_scopes(COALESCE(NEW.organization_id,OLD.organization_id),COALESCE(NEW.user_id,OLD.user_id));
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS school_user_roles_scope_sync ON school_user_roles;
CREATE TRIGGER school_user_roles_scope_sync
AFTER INSERT OR UPDATE OR DELETE ON school_user_roles
FOR EACH ROW EXECUTE FUNCTION ledgerly_school_user_role_scope_trigger();

CREATE OR REPLACE FUNCTION ledgerly_school_role_permission_scope_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u record;
DECLARE v_org text := COALESCE(NEW.organization_id,OLD.organization_id);
DECLARE v_role text := COALESCE(NEW.role_id,OLD.role_id);
BEGIN
  FOR u IN SELECT user_id FROM school_user_roles WHERE organization_id=v_org AND role_id=v_role LOOP
    PERFORM ledgerly_sync_school_membership_scopes(v_org,u.user_id);
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS school_role_permissions_scope_sync ON school_role_permissions;
CREATE TRIGGER school_role_permissions_scope_sync
AFTER INSERT OR UPDATE OR DELETE ON school_role_permissions
FOR EACH ROW EXECUTE FUNCTION ledgerly_school_role_permission_scope_trigger();

CREATE OR REPLACE FUNCTION ledgerly_school_role_state_scope_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u record;
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    FOR u IN SELECT user_id FROM school_user_roles WHERE organization_id=NEW.organization_id AND role_id=NEW.id LOOP
      PERFORM ledgerly_sync_school_membership_scopes(NEW.organization_id,u.user_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS school_roles_state_scope_sync ON school_roles;
CREATE TRIGGER school_roles_state_scope_sync
AFTER UPDATE OF active ON school_roles
FOR EACH ROW EXECUTE FUNCTION ledgerly_school_role_state_scope_trigger();

DO $$ DECLARE x record; BEGIN
  FOR x IN SELECT DISTINCT organization_id,user_id FROM school_user_roles LOOP
    PERFORM ledgerly_sync_school_membership_scopes(x.organization_id,x.user_id);
  END LOOP;
END $$;

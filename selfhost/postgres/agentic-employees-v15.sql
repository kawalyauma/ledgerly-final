-- Agentic Employees v1.5 PostgreSQL patch.
-- Apply after selfhost/postgres/agentic-employees.sql.

ALTER TABLE ae_generated_documents
  ADD COLUMN IF NOT EXISTS pdf_page_count INTEGER NOT NULL DEFAULT 1;

-- Avoid referring to OLD during INSERT triggers. PostgreSQL does not define OLD
-- for INSERT operations, so handle inserts and updates as separate branches.
CREATE OR REPLACE FUNCTION ae_enqueue_absence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent' THEN
      INSERT INTO ae_event_inbox(
        id,organization_id,event_type,source_module,source_record_id,
        subject_type,subject_id,payload_json,occurred_at
      ) VALUES(
        'aev_'||replace(gen_random_uuid()::text,'-',''),
        NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
        'student',NEW.person_id,
        jsonb_build_object('attendanceDate',NEW.attendance_date,'status',NEW.status)::text,
        now()
      ) ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent'
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO ae_event_inbox(
        id,organization_id,event_type,source_module,source_record_id,
        subject_type,subject_id,payload_json,occurred_at
      ) VALUES(
        'aev_'||replace(gen_random_uuid()::text,'-',''),
        NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
        'student',NEW.person_id,
        jsonb_build_object(
          'attendanceDate',NEW.attendance_date,
          'status',NEW.status,
          'previousStatus',OLD.status
        )::text,
        now()
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Reinstall the triggers in case the base migration was applied before this patch.
DO $$
BEGIN
  IF to_regclass('public.att_records') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ae_evt_attendance_absent_insert ON att_records;
    DROP TRIGGER IF EXISTS ae_evt_attendance_absent_update ON att_records;
    CREATE TRIGGER ae_evt_attendance_absent_insert
      AFTER INSERT ON att_records
      FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();
    CREATE TRIGGER ae_evt_attendance_absent_update
      AFTER UPDATE OF status ON att_records
      FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();
  END IF;
END $$;

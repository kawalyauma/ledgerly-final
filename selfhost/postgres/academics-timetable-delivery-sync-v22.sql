CREATE OR REPLACE FUNCTION academics_sync_occurrence_plan_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lesson_plan_id IS NOT NULL THEN
    UPDATE acad_lesson_plans
       SET timetable_entry_id=COALESCE(timetable_entry_id,NEW.timetable_entry_id),
           updated_at=now()
     WHERE id=NEW.lesson_plan_id
       AND organization_id=NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS acad_tt_occurrence_plan_link_ai ON acad_timetable_occurrences;
CREATE TRIGGER acad_tt_occurrence_plan_link_ai
AFTER INSERT ON acad_timetable_occurrences
FOR EACH ROW EXECUTE FUNCTION academics_sync_occurrence_plan_link();

CREATE OR REPLACE FUNCTION academics_sync_delivery_occurrence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lesson_plan_id IS NOT NULL THEN
    UPDATE acad_timetable_occurrences
       SET delivery_id=NEW.id,
           status=CASE
             WHEN NEW.delivery_status='taught' THEN 'taught'
             WHEN NEW.delivery_status='missed' THEN 'missed'
             WHEN NEW.delivery_status='postponed' THEN 'postponed'
             WHEN NEW.delivery_status='recovery' THEN 'recovery'
             WHEN NEW.delivery_status='scheduled' AND status IN ('taught','missed','postponed','recovery') THEN 'ready'
             ELSE status
           END,
           updated_at=now()
     WHERE organization_id=NEW.organization_id
       AND lesson_plan_id=NEW.lesson_plan_id
       AND occurrence_date=NEW.scheduled_date::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS acad_tt_delivery_occurrence_insert_ai ON acad_lesson_deliveries;
CREATE TRIGGER acad_tt_delivery_occurrence_insert_ai
AFTER INSERT ON acad_lesson_deliveries
FOR EACH ROW EXECUTE FUNCTION academics_sync_delivery_occurrence();

DROP TRIGGER IF EXISTS acad_tt_delivery_occurrence_update_au ON acad_lesson_deliveries;
CREATE TRIGGER acad_tt_delivery_occurrence_update_au
AFTER UPDATE OF delivery_status,lesson_plan_id,scheduled_date ON acad_lesson_deliveries
FOR EACH ROW EXECUTE FUNCTION academics_sync_delivery_occurrence();

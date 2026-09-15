PRAGMA foreign_keys=ON;

-- Bind a materialized timetable occurrence back to the lesson plan's recurring slot.
CREATE TRIGGER IF NOT EXISTS acad_tt_occurrence_plan_link_ai
AFTER INSERT ON acad_timetable_occurrences
WHEN NEW.lesson_plan_id IS NOT NULL
BEGIN
  UPDATE acad_lesson_plans
  SET timetable_entry_id=COALESCE(timetable_entry_id,NEW.timetable_entry_id),
      updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.lesson_plan_id
    AND organization_id=NEW.organization_id;
END;

-- When teaching is recorded through the canonical Academics delivery flow, reflect it
-- immediately in the dated timetable occurrence instead of leaving the period 'ready'.
CREATE TRIGGER IF NOT EXISTS acad_tt_delivery_occurrence_insert_ai
AFTER INSERT ON acad_lesson_deliveries
WHEN NEW.lesson_plan_id IS NOT NULL
BEGIN
  UPDATE acad_timetable_occurrences
  SET delivery_id=NEW.id,
      status=CASE
        WHEN NEW.delivery_status='taught' THEN 'taught'
        WHEN NEW.delivery_status='missed' THEN 'missed'
        WHEN NEW.delivery_status='postponed' THEN 'postponed'
        WHEN NEW.delivery_status='recovery' THEN 'recovery'
        ELSE status
      END,
      updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id
    AND lesson_plan_id=NEW.lesson_plan_id
    AND occurrence_date=NEW.scheduled_date;
END;

CREATE TRIGGER IF NOT EXISTS acad_tt_delivery_occurrence_update_au
AFTER UPDATE OF delivery_status,lesson_plan_id,scheduled_date ON acad_lesson_deliveries
WHEN NEW.lesson_plan_id IS NOT NULL
BEGIN
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
      updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id
    AND lesson_plan_id=NEW.lesson_plan_id
    AND occurrence_date=NEW.scheduled_date;
END;

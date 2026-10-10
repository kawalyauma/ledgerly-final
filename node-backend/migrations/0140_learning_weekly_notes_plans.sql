-- Notes and lesson plans are written separately and week by week, when the DOS asks for a week.
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS notes_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS plan_error TEXT;
DO $$ BEGIN
  ALTER TABLE lrn_lessons ADD CONSTRAINT lrn_lessons_plan_status_chk CHECK (plan_status IN ('none','requested','writing','written','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE lrn_lessons SET plan_status='written' WHERE lesson_plan IS NOT NULL AND plan_status='none';
UPDATE lrn_lessons SET notes_requested=true WHERE status<>'pending';
ALTER TABLE lrn_ai_tasks DROP CONSTRAINT IF EXISTS lrn_ai_tasks_kind_check;
ALTER TABLE lrn_ai_tasks ADD CONSTRAINT lrn_ai_tasks_kind_check
  CHECK (kind IN ('scheme.source','scheme.outline','lesson.write','lesson.plan','page.analyze','student.summary','figure.generate'));

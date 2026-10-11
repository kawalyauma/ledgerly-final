-- Bound automatic quality repairs per lesson while allowing a complete-term run to continue.
ALTER TABLE lrn_lessons
  ADD COLUMN IF NOT EXISTS generation_attempts smallint NOT NULL DEFAULT 0;

ALTER TABLE lrn_lessons DROP CONSTRAINT IF EXISTS lrn_lessons_generation_attempts_check;
ALTER TABLE lrn_lessons ADD CONSTRAINT lrn_lessons_generation_attempts_check
  CHECK (generation_attempts >= 0 AND generation_attempts <= 20);

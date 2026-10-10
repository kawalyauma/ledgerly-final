-- Lesson kinds (teach / practice / weekly review / revision / end of term assessment) and a note on how far the material reaches.
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS lesson_kind TEXT NOT NULL DEFAULT 'teach';
ALTER TABLE lrn_schemes ADD COLUMN IF NOT EXISTS coverage_note TEXT;

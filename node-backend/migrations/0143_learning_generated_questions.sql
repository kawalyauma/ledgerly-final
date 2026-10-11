-- Pedagogical examples generated for Mathematics/English/Reading are clearly distinguished
-- from source-verified e-library and captured questions.
ALTER TABLE lrn_questions DROP CONSTRAINT IF EXISTS lrn_questions_origin_check;
ALTER TABLE lrn_questions ADD CONSTRAINT lrn_questions_origin_check CHECK (origin IN ('elibrary','capture','generated'));

-- Learning engine: every scheme lesson also gets a sample lesson plan, a period count for the timetable planner,
-- and AI-drawn diagrams (sanitised SVG) referenced from the notes as [[diagram:key]].
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS periods SMALLINT NOT NULL DEFAULT 1 CHECK (periods BETWEEN 1 AND 10);
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS lesson_plan JSONB;

CREATE TABLE IF NOT EXISTS lrn_lesson_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lrn_lessons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'diagram' CHECK (kind IN ('diagram','table','illustration')),
  asset_key TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT,
  svg TEXT,
  source_chunk_id TEXT REFERENCES lrn_source_chunks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lesson_id, asset_key)
);
CREATE INDEX IF NOT EXISTS lrn_lesson_assets_lesson_idx ON lrn_lesson_assets(lesson_id);

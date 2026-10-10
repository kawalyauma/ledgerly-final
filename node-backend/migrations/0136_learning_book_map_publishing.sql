-- Learning engine: map big books (one PDF covering several classes or terms) so each passage knows its class,
-- term and topic; write schemes partially (e.g. only week 1 lessons for now); and record what was posted
-- to the public library (notesug.com).
ALTER TABLE lrn_source_chunks ADD COLUMN IF NOT EXISTS class_no SMALLINT;
ALTER TABLE lrn_source_chunks ADD COLUMN IF NOT EXISTS class_level TEXT;
ALTER TABLE lrn_source_chunks ADD COLUMN IF NOT EXISTS term_no SMALLINT;
ALTER TABLE lrn_source_chunks ADD COLUMN IF NOT EXISTS heading TEXT;
CREATE INDEX IF NOT EXISTS lrn_source_chunks_scope_idx ON lrn_source_chunks(source_id, class_level, class_no, term_no);

ALTER TABLE lrn_sources ADD COLUMN IF NOT EXISTS classes_covered TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE lrn_sources ADD COLUMN IF NOT EXISTS terms_covered SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE lrn_sources ADD COLUMN IF NOT EXISTS map_version SMALLINT NOT NULL DEFAULT 0;

-- Lessons are written up to this week; later weeks stay as outline until asked for (NULL = the whole term).
ALTER TABLE lrn_schemes ADD COLUMN IF NOT EXISTS write_until_week SMALLINT;

CREATE TABLE IF NOT EXISTS lrn_library_posts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES lrn_schemes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scheme','lesson_pack')),
  weeks TEXT,
  external_slug TEXT NOT NULL,
  page_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  posted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_library_posts_scheme_idx ON lrn_library_posts(scheme_id, created_at DESC);

-- Curricula are their own source role (the backbone of a scheme's order and coverage).
ALTER TABLE lrn_scheme_sources DROP CONSTRAINT IF EXISTS lrn_scheme_sources_role_check;
ALTER TABLE lrn_scheme_sources ADD CONSTRAINT lrn_scheme_sources_role_check CHECK (role IN ('curriculum','scheme','notes','lesson_plans','past_papers','reference'));

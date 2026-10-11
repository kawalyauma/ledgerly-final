-- NCDC (National Curriculum Development Centre) curricula, syllabi, teachers' guides and sample assessment items.
-- Shared by every school: each scheme copies the documents for its class into lrn_sources (provider 'ncdc') as its base.
CREATE TABLE IF NOT EXISTS lrn_base_documents (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('curriculum','teachers_guide','learners_book','sample_items','assessment_guidelines','other')),
  classes TEXT[] NOT NULL DEFAULT '{}',
  thematic BOOLEAN NOT NULL DEFAULT false,
  source_url TEXT,
  content TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_base_documents_classes_idx ON lrn_base_documents USING GIN (classes);

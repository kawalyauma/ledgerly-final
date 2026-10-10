-- Learning engine: a reusable figure library. A figure is stored once, unlabelled, with the position of each
-- named part ("anchor"). Labels are applied at render time — names for notes, letters A, B, C... for exams
-- (different per paper, with an answer key), or blank boxes — so the same drawing serves every lesson, paper
-- and school without calling the AI again. Code-drawn figures (shapes, fractions, number lines, clocks,
-- charts) never use the AI at all.
CREATE TABLE IF NOT EXISTS lrn_figures (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  shared BOOLEAN NOT NULL DEFAULT true,
  concept_key TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('generated','source_crop','coded','svg')),
  base_key TEXT,
  svg TEXT,
  width INTEGER,
  height INTEGER,
  anchors JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','ready','failed','retired')),
  qa JSONB,
  error TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_figures_key_idx ON lrn_figures(concept_key);
CREATE INDEX IF NOT EXISTS lrn_figures_key_trgm ON lrn_figures USING GIN (concept_key gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS lrn_figures_coded_uniq ON lrn_figures(concept_key) WHERE kind='coded';

-- One rendering of a figure with a given set of labels (cached image + answer key).
CREATE TABLE IF NOT EXISTS lrn_figure_labelings (
  id TEXT PRIMARY KEY,
  figure_id TEXT NOT NULL REFERENCES lrn_figures(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('names','letters','blank','custom')),
  spec_hash TEXT NOT NULL,
  spec JSONB NOT NULL,
  answer_key JSONB NOT NULL DEFAULT '{}'::jsonb,
  png_key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (figure_id, spec_hash)
);

ALTER TABLE lrn_lesson_assets ADD COLUMN IF NOT EXISTS figure_id TEXT REFERENCES lrn_figures(id) ON DELETE SET NULL;
ALTER TABLE lrn_lesson_assets ADD COLUMN IF NOT EXISTS labeling_id TEXT REFERENCES lrn_figure_labelings(id) ON DELETE SET NULL;
ALTER TABLE lrn_lesson_assets ADD COLUMN IF NOT EXISTS parts TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE lrn_questions ADD COLUMN IF NOT EXISTS figure_id TEXT REFERENCES lrn_figures(id) ON DELETE SET NULL;
ALTER TABLE lrn_questions ADD COLUMN IF NOT EXISTS labeling_id TEXT REFERENCES lrn_figure_labelings(id) ON DELETE SET NULL;

ALTER TABLE lrn_engine_settings ADD COLUMN IF NOT EXISTS image_generation BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lrn_engine_settings ADD COLUMN IF NOT EXISTS daily_image_limit INTEGER NOT NULL DEFAULT 40 CHECK (daily_image_limit BETWEEN 0 AND 1000);

ALTER TABLE lrn_ai_tasks DROP CONSTRAINT IF EXISTS lrn_ai_tasks_kind_check;
ALTER TABLE lrn_ai_tasks ADD CONSTRAINT lrn_ai_tasks_kind_check
  CHECK (kind IN ('scheme.source','scheme.outline','lesson.write','page.analyze','student.summary','figure.generate'));

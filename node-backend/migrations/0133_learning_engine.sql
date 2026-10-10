-- Learning engine: resource-grounded schemes of work and lesson notes generated step by step by Ledgerly AI,
-- scanned exercise books and lesson plan books, a grouped question bank per class and term, a teaching timeline,
-- and evidence-based learner profiles. Built alongside (not on top of) the older academics tables; it reuses only
-- the core school records (classes, streams, subjects, terms, students, staff).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Per-school engine controls shown on the Ledgerly AI dashboard.
CREATE TABLE IF NOT EXISTS lrn_engine_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'codex' CHECK (provider IN ('codex','claude-code')),
  vision_provider TEXT NOT NULL DEFAULT 'codex' CHECK (vision_provider IN ('codex')),
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','paused','stopped')),
  daily_task_limit INTEGER NOT NULL DEFAULT 200 CHECK (daily_task_limit BETWEEN 0 AND 5000),
  max_prompt_chars INTEGER NOT NULL DEFAULT 40000 CHECK (max_prompt_chars BETWEEN 8000 AND 200000),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- E-library resources pulled in for a school, and their text split into citeable chunks so the AI
-- reads a few relevant passages per step instead of whole PDFs.
CREATE TABLE IF NOT EXISTS lrn_sources (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'ulibtech',
  external_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  resource_type TEXT,
  class_name TEXT,
  subject_name TEXT,
  term_name TEXT,
  page_url TEXT,
  total_chars INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','no_text','failed')),
  error TEXT,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, provider, external_slug)
);

CREATE TABLE IF NOT EXISTS lrn_source_chunks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES lrn_sources(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  content TEXT NOT NULL,
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (source_id, seq)
);
CREATE INDEX IF NOT EXISTS lrn_source_chunks_search_idx ON lrn_source_chunks USING GIN (search);
CREATE INDEX IF NOT EXISTS lrn_source_chunks_org_idx ON lrn_source_chunks(organization_id, source_id);

-- A scheme of work for one class, subject and term. The AI fills it in stages: outline, then each lesson.
CREATE TABLE IF NOT EXISTS lrn_schemes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  library_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  weeks INTEGER NOT NULL DEFAULT 12 CHECK (weeks BETWEEN 1 AND 20),
  periods_per_week INTEGER NOT NULL DEFAULT 5 CHECK (periods_per_week BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sourcing','outlining','writing','review','published','archived','failed')),
  summary TEXT,
  error TEXT,
  published_at TIMESTAMPTZ,
  published_by TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_schemes_lookup_idx ON lrn_schemes(organization_id, term_id, class_id, subject_id);

CREATE TABLE IF NOT EXISTS lrn_scheme_sources (
  scheme_id TEXT NOT NULL REFERENCES lrn_schemes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES lrn_sources(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'reference' CHECK (role IN ('scheme','notes','lesson_plans','past_papers','reference')),
  PRIMARY KEY (scheme_id, source_id)
);

CREATE TABLE IF NOT EXISTS lrn_units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES lrn_schemes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  theme TEXT,
  week_from INTEGER,
  week_to INTEGER,
  competences TEXT,
  source_chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (scheme_id, seq)
);

CREATE TABLE IF NOT EXISTS lrn_lessons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES lrn_schemes(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES lrn_units(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  week INTEGER,
  period INTEGER,
  title TEXT NOT NULL,
  subtopic TEXT,
  objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Filled in by the per-lesson AI step.
  notes_markdown TEXT,
  methods TEXT,
  materials TEXT,
  life_skills TEXT,
  assessment TEXT,
  source_chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','writing','written','reviewed','failed','skipped')),
  error TEXT,
  written_at TIMESTAMPTZ,
  UNIQUE (scheme_id, seq)
);
CREATE INDEX IF NOT EXISTS lrn_lessons_unit_idx ON lrn_lessons(unit_id, seq);

-- AI work queue. One row is one bounded step (an outline, one lesson, one scanned page...) so usage stays
-- predictable and the engine can be paused, stopped or switched between providers at any step.
CREATE TABLE IF NOT EXISTS lrn_ai_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scheme.source','scheme.outline','lesson.write','page.analyze','student.summary')),
  subject_ref TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until TIMESTAMPTZ,
  provider TEXT,
  prompt_chars INTEGER,
  duration_ms INTEGER,
  usage JSONB,
  result JSONB,
  error TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lrn_ai_tasks_ready_idx ON lrn_ai_tasks(status, available_at, priority) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS lrn_ai_tasks_org_idx ON lrn_ai_tasks(organization_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lrn_ai_tasks_active_uniq ON lrn_ai_tasks(organization_id, kind, subject_ref) WHERE status IN ('queued','running');

-- Scanned books. A batch is one scanning session (e.g. all P4 science books after an exercise);
-- pages are uploaded one by one, idempotently, by the scanner app.
CREATE TABLE IF NOT EXISTS lrn_capture_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('student_books','lesson_plan_book','teacher_notes','exam_scripts')),
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  teacher_staff_id TEXT REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT,
  device_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','processing','done','needs_review','cancelled')),
  page_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lrn_capture_batches_org_idx ON lrn_capture_batches(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lrn_capture_pages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES lrn_capture_batches(id) ON DELETE CASCADE,
  client_page_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  -- The scanner may tag the learner; otherwise the AI reads the name on the page and it is matched to the class list.
  student_id TEXT REFERENCES school_students(id) ON DELETE SET NULL,
  student_match TEXT CHECK (student_match IN ('scanner','name_exact','name_fuzzy','manual')),
  written_name TEXT,
  page_type TEXT,
  transcript TEXT,
  analysis JSONB,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','queued','analyzing','analyzed','needs_review','failed','duplicate')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analyzed_at TIMESTAMPTZ,
  UNIQUE (batch_id, client_page_id)
);
CREATE INDEX IF NOT EXISTS lrn_capture_pages_batch_idx ON lrn_capture_pages(batch_id, seq);
CREATE INDEX IF NOT EXISTS lrn_capture_pages_student_idx ON lrn_capture_pages(organization_id, student_id);
CREATE INDEX IF NOT EXISTS lrn_capture_pages_sha_idx ON lrn_capture_pages(organization_id, sha256);

-- Question bank. Every question has an origin it can be traced to: an e-library passage or a scanned page.
-- Questions with the same structure (e.g. "1 + 2" and "2 + 4") share a group, which drives comparison and alternatives.
CREATE TABLE IF NOT EXISTS lrn_question_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  group_key TEXT NOT NULL,
  label TEXT NOT NULL,
  concept TEXT,
  skill TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE NULLS NOT DISTINCT (organization_id, subject_id, class_id, group_key)
);

CREATE TABLE IF NOT EXISTS lrn_questions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  scheme_id TEXT REFERENCES lrn_schemes(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lrn_lessons(id) ON DELETE SET NULL,
  group_id TEXT REFERENCES lrn_question_groups(id) ON DELETE SET NULL,
  stem TEXT NOT NULL,
  stem_normalized TEXT NOT NULL,
  answer TEXT,
  options JSONB,
  kind TEXT NOT NULL DEFAULT 'short_answer' CHECK (kind IN ('computation','short_answer','multiple_choice','fill_blank','true_false','matching','structured','essay','drawing')),
  structure_signature TEXT,
  difficulty SMALLINT CHECK (difficulty BETWEEN 1 AND 5),
  cognitive_level TEXT CHECK (cognitive_level IN ('remember','understand','apply','analyse','evaluate','create')),
  topic TEXT,
  subtopic TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('elibrary','capture')),
  source_chunk_id TEXT REFERENCES lrn_source_chunks(id) ON DELETE SET NULL,
  capture_page_id TEXT REFERENCES lrn_capture_pages(id) ON DELETE SET NULL,
  source_quote TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  times_given INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE NULLS NOT DISTINCT (organization_id, class_id, subject_id, stem_normalized)
);
CREATE INDEX IF NOT EXISTS lrn_questions_bank_idx ON lrn_questions(organization_id, class_id, term_id, subject_id, status);
CREATE INDEX IF NOT EXISTS lrn_questions_group_idx ON lrn_questions(group_id);
CREATE INDEX IF NOT EXISTS lrn_questions_trgm_idx ON lrn_questions USING GIN (stem_normalized gin_trgm_ops);

-- Teaching timeline: what each class was (or is being) taught, from lesson plan books, exercise books,
-- teacher entries or the published scheme.
CREATE TABLE IF NOT EXISTS lrn_teaching_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lrn_lessons(id) ON DELETE SET NULL,
  teacher_staff_id TEXT REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  taught_on DATE NOT NULL,
  starts_at TIME,
  ends_at TIME,
  topic TEXT NOT NULL,
  subtopic TEXT,
  evidence TEXT NOT NULL CHECK (evidence IN ('lesson_plan_book','exercise_book','teacher_entry')),
  capture_page_id TEXT REFERENCES lrn_capture_pages(id) ON DELETE SET NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_teaching_events_class_idx ON lrn_teaching_events(organization_id, class_id, taught_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lrn_teaching_events_dedupe ON lrn_teaching_events(organization_id, class_id, COALESCE(subject_id,''), taught_on, lower(topic), COALESCE(lower(subtopic),''));

-- Learner evidence: answers marked in their books, and observations (handwriting, spelling, language...) per page.
CREATE TABLE IF NOT EXISTS lrn_student_attempts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES lrn_questions(id) ON DELETE SET NULL,
  capture_page_id TEXT REFERENCES lrn_capture_pages(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  answer_text TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct','partial','incorrect','unmarked','blank')),
  score NUMERIC(6,2),
  max_score NUMERIC(6,2),
  error_type TEXT,
  attempted_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_student_attempts_student_idx ON lrn_student_attempts(organization_id, student_id, attempted_on DESC);
CREATE INDEX IF NOT EXISTS lrn_student_attempts_question_idx ON lrn_student_attempts(question_id);

CREATE TABLE IF NOT EXISTS lrn_student_observations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  capture_page_id TEXT REFERENCES lrn_capture_pages(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('handwriting','spelling','language','presentation','numeracy','reasoning','teacher_comment')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  label TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lrn_student_observations_idx ON lrn_student_observations(organization_id, student_id, dimension, observed_on DESC);

-- Cached AI write-up of a learner's overview, rebuilt from the evidence above on request.
CREATE TABLE IF NOT EXISTS lrn_student_summaries (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  evidence_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, student_id)
);

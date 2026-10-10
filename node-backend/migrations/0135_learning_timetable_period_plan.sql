-- Learning engine: timetable settings, bell schedule, subject loads, generated timetables, days off,
-- and the dated period plan that says which lesson (and subtopic) each class is taught in each period of the term.

CREATE TABLE IF NOT EXISTS lrn_timetable_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  period_minutes SMALLINT NOT NULL DEFAULT 40 CHECK (period_minutes BETWEEN 10 AND 180),
  day_starts_at TIME NOT NULL DEFAULT '08:00',
  periods_per_day SMALLINT NOT NULL DEFAULT 8 CHECK (periods_per_day BETWEEN 1 AND 16),
  school_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  -- e.g. [{"afterPeriod":2,"minutes":20,"label":"Break"},{"afterPeriod":5,"minutes":60,"label":"Lunch"}]
  breaks JSONB NOT NULL DEFAULT '[{"afterPeriod":2,"minutes":20,"label":"Break"},{"afterPeriod":5,"minutes":60,"label":"Lunch"}]'::jsonb,
  max_subject_periods_per_day SMALLINT NOT NULL DEFAULT 2 CHECK (max_subject_periods_per_day BETWEEN 1 AND 8),
  morning_subjects TEXT[] NOT NULL DEFAULT '{mathematics,english,science}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The school's bell: lesson periods and non-teaching blocks, the same for every school day.
CREATE TABLE IF NOT EXISTS lrn_bell_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seq SMALLINT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson','break','lunch','assembly','games','prep','other')),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL CHECK (ends_at > starts_at),
  UNIQUE (organization_id, seq)
);

-- Fixed activities in lesson periods (assembly on Monday period 1, games on Friday afternoon...); class NULL = whole school.
CREATE TABLE IF NOT EXISTS lrn_timetable_fixed (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id TEXT REFERENCES school_classes(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  bell_period_id TEXT NOT NULL REFERENCES lrn_bell_periods(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  UNIQUE NULLS NOT DISTINCT (organization_id, class_id, weekday, bell_period_id)
);

-- What has to be timetabled: periods per week of each subject in each class, and who teaches it.
CREATE TABLE IF NOT EXISTS lrn_subject_loads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  teacher_staff_id TEXT REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  periods_per_week SMALLINT NOT NULL CHECK (periods_per_week BETWEEN 1 AND 30),
  double_periods SMALLINT NOT NULL DEFAULT 0 CHECK (double_periods BETWEEN 0 AND 10),
  room TEXT,
  UNIQUE (organization_id, term_id, class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS lrn_timetables (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS lrn_timetables_one_published ON lrn_timetables(organization_id, term_id) WHERE status='published';

CREATE TABLE IF NOT EXISTS lrn_timetable_slots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT NOT NULL REFERENCES lrn_timetables(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  bell_period_id TEXT NOT NULL REFERENCES lrn_bell_periods(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE CASCADE,
  teacher_staff_id TEXT REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  room TEXT,
  label TEXT,
  locked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (timetable_id, class_id, weekday, bell_period_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lrn_timetable_slots_teacher_uniq ON lrn_timetable_slots(timetable_id, teacher_staff_id, weekday, bell_period_id) WHERE teacher_staff_id IS NOT NULL;

-- Holidays, events and exam days with no normal lessons; class NULL = whole school.
CREATE TABLE IF NOT EXISTS lrn_days_off (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  UNIQUE NULLS NOT DISTINCT (organization_id, day, class_id)
);

-- The dated plan: one row per class lesson period in the term, carrying the scheme lesson (or part of it) taught then.
CREATE TABLE IF NOT EXISTS lrn_period_plan (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT NOT NULL REFERENCES lrn_timetables(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES lrn_timetable_slots(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  teacher_staff_id TEXT REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  plan_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  scheme_id TEXT REFERENCES lrn_schemes(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lrn_lessons(id) ON DELETE SET NULL,
  lesson_part SMALLINT,
  lesson_parts SMALLINT,
  topic TEXT,
  subtopic TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','taught','missed','free')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (slot_id, plan_date)
);
CREATE INDEX IF NOT EXISTS lrn_period_plan_class_idx ON lrn_period_plan(organization_id, class_id, plan_date, starts_at);
CREATE INDEX IF NOT EXISTS lrn_period_plan_teacher_idx ON lrn_period_plan(organization_id, teacher_staff_id, plan_date);
CREATE INDEX IF NOT EXISTS lrn_period_plan_lesson_idx ON lrn_period_plan(lesson_id);

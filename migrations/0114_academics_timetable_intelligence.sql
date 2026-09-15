PRAGMA foreign_keys=ON;

-- Academics 2.1: governed timetable planning, lesson-aware occurrences and exceptions.
ALTER TABLE acad_timetable_entries ADD COLUMN period_id TEXT REFERENCES school_lesson_periods(id) ON DELETE SET NULL;
ALTER TABLE acad_timetable_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','rule_engine','ai_draft'));
ALTER TABLE acad_timetable_entries ADD COLUMN draft_id TEXT;

CREATE INDEX IF NOT EXISTS acad_tt_period_idx
  ON acad_timetable_entries(organization_id,timetable_id,weekday,period_id,active);

CREATE TABLE IF NOT EXISTS acad_timetable_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT REFERENCES acad_timetables(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'school' CHECK(scope_type IN ('school','class','stream','subject','teacher','room')),
  scope_id TEXT,
  rule_type TEXT NOT NULL CHECK(rule_type IN (
    'weekly_periods','daily_max','consecutive_max','preferred_period','avoid_period','require_double',
    'subject_spread','subject_min_gap','morning_preference','room_type','fixed_slot','teacher_break',
    'teacher_daily_max','teacher_consecutive_max','class_daily_subject_max','working_days'
  )),
  config_json TEXT NOT NULL DEFAULT '{}',
  hardness TEXT NOT NULL DEFAULT 'soft' CHECK(hardness IN ('hard','soft')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_tt_rules_lookup_idx
  ON acad_timetable_rules(organization_id,timetable_id,scope_type,scope_id,rule_type,active);

CREATE TABLE IF NOT EXISTS acad_timetable_drafts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT NOT NULL REFERENCES acad_timetables(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','applied','discarded')),
  mode TEXT NOT NULL DEFAULT 'replace' CHECK(mode IN ('replace','fill_gaps')),
  score REAL NOT NULL DEFAULT 0,
  proposed_entries_json TEXT NOT NULL DEFAULT '[]',
  violations_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT,
  discarded_at TEXT
);
CREATE INDEX IF NOT EXISTS acad_tt_drafts_idx
  ON acad_timetable_drafts(organization_id,timetable_id,status,generated_at);

CREATE TABLE IF NOT EXISTS acad_timetable_occurrences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_entry_id TEXT NOT NULL REFERENCES acad_timetable_entries(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  scheme_lesson_id TEXT REFERENCES acad_scheme_lessons(id) ON DELETE SET NULL,
  lesson_plan_id TEXT REFERENCES acad_lesson_plans(id) ON DELETE SET NULL,
  delivery_id TEXT REFERENCES acad_lesson_deliveries(id) ON DELETE SET NULL,
  effective_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  effective_room_id TEXT REFERENCES acad_rooms(id) ON DELETE SET NULL,
  effective_starts_at TEXT,
  effective_ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','ready','needs_cover','taught','missed','postponed','cancelled','recovery')),
  exception_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,timetable_entry_id,occurrence_date)
);
CREATE INDEX IF NOT EXISTS acad_tt_occurrence_date_idx
  ON acad_timetable_occurrences(organization_id,occurrence_date,status,effective_teacher_user_id);
CREATE INDEX IF NOT EXISTS acad_tt_occurrence_lesson_idx
  ON acad_timetable_occurrences(organization_id,scheme_lesson_id,occurrence_date);

CREATE TABLE IF NOT EXISTS acad_timetable_exceptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT NOT NULL REFERENCES acad_timetables(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK(exception_type IN ('teacher_absence','room_unavailable','school_closure','class_event','assembly','weather','emergency','other')),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  scope_type TEXT NOT NULL DEFAULT 'school' CHECK(scope_type IN ('school','class','stream','teacher','room')),
  scope_id TEXT,
  handling_policy TEXT NOT NULL DEFAULT 'manual' CHECK(handling_policy IN ('substitute','reschedule','cancel','manual')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','cancelled')),
  resolution_notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_on<=ends_on)
);
CREATE INDEX IF NOT EXISTS acad_tt_exceptions_date_idx
  ON acad_timetable_exceptions(organization_id,timetable_id,status,starts_on,ends_on);

CREATE TABLE IF NOT EXISTS acad_timetable_recovery_queue (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES acad_timetable_occurrences(id) ON DELETE CASCADE,
  scheme_lesson_id TEXT REFERENCES acad_scheme_lessons(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','scheduled','completed','cancelled')),
  suggested_slots_json TEXT NOT NULL DEFAULT '[]',
  recovery_occurrence_id TEXT REFERENCES acad_timetable_occurrences(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,occurrence_id)
);
CREATE INDEX IF NOT EXISTS acad_tt_recovery_idx
  ON acad_timetable_recovery_queue(organization_id,status,created_at);

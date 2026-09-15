ALTER TABLE acad_timetable_entries ADD COLUMN IF NOT EXISTS period_id TEXT REFERENCES school_lesson_periods(id) ON DELETE SET NULL;
ALTER TABLE acad_timetable_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE acad_timetable_entries ADD COLUMN IF NOT EXISTS draft_id TEXT;
CREATE INDEX IF NOT EXISTS acad_tt_period_idx ON acad_timetable_entries(organization_id,timetable_id,weekday,period_id,active);

CREATE TABLE IF NOT EXISTS acad_timetable_rules (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 timetable_id TEXT REFERENCES acad_timetables(id) ON DELETE CASCADE,
 scope_type TEXT NOT NULL DEFAULT 'school', scope_id TEXT, rule_type TEXT NOT NULL,
 config_json JSONB NOT NULL DEFAULT '{}'::jsonb, hardness TEXT NOT NULL DEFAULT 'soft', priority INTEGER NOT NULL DEFAULT 50,
 active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(scope_type IN ('school','class','stream','subject','teacher','room')),
 CHECK(hardness IN ('hard','soft')), CHECK(priority BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS acad_tt_rules_lookup_idx ON acad_timetable_rules(organization_id,timetable_id,scope_type,scope_id,rule_type,active);

CREATE TABLE IF NOT EXISTS acad_timetable_drafts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 timetable_id TEXT NOT NULL REFERENCES acad_timetables(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'generated', mode TEXT NOT NULL DEFAULT 'replace', score DOUBLE PRECISION NOT NULL DEFAULT 0,
 proposed_entries_json JSONB NOT NULL DEFAULT '[]'::jsonb, violations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb, assumptions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 generated_by TEXT REFERENCES users(id) ON DELETE SET NULL, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 applied_by TEXT REFERENCES users(id) ON DELETE SET NULL, applied_at TIMESTAMPTZ, discarded_at TIMESTAMPTZ,
 CHECK(status IN ('generated','applied','discarded')), CHECK(mode IN ('replace','fill_gaps'))
);
CREATE INDEX IF NOT EXISTS acad_tt_drafts_idx ON acad_timetable_drafts(organization_id,timetable_id,status,generated_at);

CREATE TABLE IF NOT EXISTS acad_timetable_occurrences (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 timetable_entry_id TEXT NOT NULL REFERENCES acad_timetable_entries(id) ON DELETE CASCADE,
 occurrence_date DATE NOT NULL, scheme_lesson_id TEXT REFERENCES acad_scheme_lessons(id) ON DELETE SET NULL,
 lesson_plan_id TEXT REFERENCES acad_lesson_plans(id) ON DELETE SET NULL,
 delivery_id TEXT REFERENCES acad_lesson_deliveries(id) ON DELETE SET NULL,
 effective_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 effective_room_id TEXT REFERENCES acad_rooms(id) ON DELETE SET NULL,
 effective_starts_at TEXT, effective_ends_at TEXT, status TEXT NOT NULL DEFAULT 'scheduled', exception_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(organization_id,timetable_entry_id,occurrence_date),
 CHECK(status IN ('scheduled','ready','needs_cover','taught','missed','postponed','cancelled','recovery'))
);
CREATE INDEX IF NOT EXISTS acad_tt_occurrence_date_idx ON acad_timetable_occurrences(organization_id,occurrence_date,status,effective_teacher_user_id);
CREATE INDEX IF NOT EXISTS acad_tt_occurrence_lesson_idx ON acad_timetable_occurrences(organization_id,scheme_lesson_id,occurrence_date);

CREATE TABLE IF NOT EXISTS acad_timetable_exceptions (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 timetable_id TEXT NOT NULL REFERENCES acad_timetables(id) ON DELETE CASCADE,
 exception_type TEXT NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, starts_at TEXT, ends_at TEXT,
 scope_type TEXT NOT NULL DEFAULT 'school', scope_id TEXT, handling_policy TEXT NOT NULL DEFAULT 'manual',
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', resolution_notes TEXT,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL, resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(exception_type IN ('teacher_absence','room_unavailable','school_closure','class_event','assembly','weather','emergency','other')),
 CHECK(scope_type IN ('school','class','stream','teacher','room')),
 CHECK(handling_policy IN ('substitute','reschedule','cancel','manual')),
 CHECK(status IN ('active','resolved','cancelled')), CHECK(starts_on<=ends_on)
);
CREATE INDEX IF NOT EXISTS acad_tt_exceptions_date_idx ON acad_timetable_exceptions(organization_id,timetable_id,status,starts_on,ends_on);

CREATE TABLE IF NOT EXISTS acad_timetable_recovery_queue (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES acad_timetable_occurrences(id) ON DELETE CASCADE,
 scheme_lesson_id TEXT REFERENCES acad_scheme_lessons(id) ON DELETE SET NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open', suggested_slots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 recovery_occurrence_id TEXT REFERENCES acad_timetable_occurrences(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(organization_id,occurrence_id), CHECK(status IN ('open','scheduled','completed','cancelled'))
);
CREATE INDEX IF NOT EXISTS acad_tt_recovery_idx ON acad_timetable_recovery_queue(organization_id,status,created_at);

PRAGMA foreign_keys=ON;

-- Academics learning cycle v2.
-- Keeps Exams separate: these tables store teaching-plan competencies and
-- lesson-level continuous/formative assessment only.

CREATE TABLE IF NOT EXISTS acad_scheme_topics (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES acad_schemes(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  week_from INTEGER,
  week_to INTEGER,
  planned_start_on TEXT,
  planned_end_on TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','covered','carried_forward')),
  teacher_reflection TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scheme_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS acad_scheme_topics_scheme_idx
  ON acad_scheme_topics(organization_id,scheme_id,sequence_no,status);

CREATE TABLE IF NOT EXISTS acad_scheme_lessons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES acad_schemes(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES acad_scheme_topics(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  lesson_no INTEGER,
  title TEXT NOT NULL,
  subtopic TEXT,
  planned_date TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 40 CHECK(duration_minutes > 0),
  learning_outcomes TEXT,
  teaching_methods TEXT,
  learning_resources TEXT,
  learner_activities TEXT,
  assessment_strategy TEXT,
  values_and_cross_cutting TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','plan_drafted','plan_submitted','plan_approved','delivered','assessed','completed')),
  delivery_id TEXT REFERENCES acad_lesson_deliveries(id) ON DELETE SET NULL,
  teacher_reflection TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(topic_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS acad_scheme_lessons_scheme_idx
  ON acad_scheme_lessons(organization_id,scheme_id,topic_id,status,sequence_no);
CREATE INDEX IF NOT EXISTS acad_scheme_lessons_date_idx
  ON acad_scheme_lessons(organization_id,planned_date,status);

CREATE TABLE IF NOT EXISTS acad_lesson_competencies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_lesson_id TEXT NOT NULL REFERENCES acad_scheme_lessons(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  competency_type TEXT NOT NULL DEFAULT 'specific' CHECK(competency_type IN ('specific','generic','values','literacy','numeracy','digital','other')),
  code TEXT,
  title TEXT NOT NULL,
  description TEXT,
  success_criteria TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scheme_lesson_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS acad_lesson_competencies_lesson_idx
  ON acad_lesson_competencies(organization_id,scheme_lesson_id,sequence_no);

-- One canonical lesson plan may be linked to one planned scheme lesson.
-- A separate link table preserves compatibility with existing lesson-plan rows.
CREATE TABLE IF NOT EXISTS acad_lesson_plan_links (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_plan_id TEXT NOT NULL REFERENCES acad_lesson_plans(id) ON DELETE CASCADE,
  scheme_lesson_id TEXT NOT NULL REFERENCES acad_scheme_lessons(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, lesson_plan_id),
  UNIQUE(organization_id, scheme_lesson_id)
);
CREATE INDEX IF NOT EXISTS acad_lesson_plan_links_lesson_idx
  ON acad_lesson_plan_links(organization_id,scheme_lesson_id);

CREATE TABLE IF NOT EXISTS acad_lesson_assessments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_plan_id TEXT NOT NULL REFERENCES acad_lesson_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Lesson assessment',
  assessment_type TEXT NOT NULL DEFAULT 'formative' CHECK(assessment_type IN ('formative','oral','written','practical','observation','project','homework','other')),
  max_score REAL NOT NULL DEFAULT 100 CHECK(max_score > 0),
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','reopened')),
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, lesson_plan_id)
);
CREATE INDEX IF NOT EXISTS acad_lesson_assessments_plan_idx
  ON acad_lesson_assessments(organization_id,lesson_plan_id,status);

CREATE TABLE IF NOT EXISTS acad_lesson_marks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES acad_lesson_assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  score REAL,
  absent INTEGER NOT NULL DEFAULT 0 CHECK(absent IN (0,1)),
  competency_level TEXT NOT NULL DEFAULT 'not_assessed' CHECK(competency_level IN ('not_assessed','emerging','developing','proficient','advanced')),
  remark TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS acad_lesson_marks_assessment_idx
  ON acad_lesson_marks(organization_id,assessment_id,student_id);

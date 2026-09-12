CREATE TABLE school_promotion_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_level_id text REFERENCES school_class_levels(id) ON DELETE CASCADE,
  name text NOT NULL,
  minimum_average numeric,
  maximum_failed_subjects integer,
  minimum_attendance_percent numeric,
  target_class_level_id text REFERENCES school_class_levels(id) ON DELETE SET NULL,
  allow_manual_override boolean NOT NULL DEFAULT true,
  rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_promotion_rules_idx ON school_promotion_rules(organization_id,class_level_id,active);

CREATE TABLE school_promotion_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  to_academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  source_class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  source_stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  effective_on date NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied','cancelled')),
  total_students integer NOT NULL DEFAULT 0,
  recommended_promotions integer NOT NULL DEFAULT 0,
  recommended_repeats integer NOT NULL DEFAULT 0,
  recommended_graduations integer NOT NULL DEFAULT 0,
  review_required integer NOT NULL DEFAULT 0,
  created_by text,
  applied_by text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_promotion_run_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES school_promotion_runs(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  from_class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  from_stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  source_class_level_id text REFERENCES school_class_levels(id) ON DELETE SET NULL,
  target_class_level_id text REFERENCES school_class_levels(id) ON DELETE SET NULL,
  target_class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  target_stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  average_percent numeric,
  failed_subjects integer,
  attendance_percent numeric,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_decision text NOT NULL CHECK (recommended_decision IN ('promoted','repeated','graduated','review')),
  recommendation_reason text NOT NULL,
  final_decision text CHECK (final_decision IS NULL OR final_decision IN ('promoted','repeated','graduated')),
  override_reason text,
  applied_enrollment_id text REFERENCES school_enrollments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,run_id,student_id)
);
CREATE INDEX school_promotion_items_run_idx ON school_promotion_run_items(organization_id,run_id,recommended_decision,final_decision);

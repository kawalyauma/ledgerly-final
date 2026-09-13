CREATE TABLE exm_comment_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comment_type text NOT NULL CHECK (comment_type IN ('class_teacher','head_teacher')),
  min_agg integer NOT NULL,
  max_agg integer NOT NULL,
  comment_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (min_agg <= max_agg)
);
CREATE INDEX exm_comment_rules_org_idx ON exm_comment_rules(organization_id,comment_type,active,min_agg);

CREATE TABLE exm_finalization_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('finalized','reopened')),
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX exm_finalization_events_exam_idx ON exm_finalization_events(organization_id,exam_id,created_at DESC);

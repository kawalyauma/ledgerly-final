CREATE TABLE school_supervision_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  schema_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id),
  updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_supervision_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT school_supervision_templates_schema_array CHECK (jsonb_typeof(schema_json) = 'array')
);

CREATE UNIQUE INDEX school_supervision_templates_org_name
  ON school_supervision_templates(organization_id, lower(name));
CREATE INDEX school_supervision_templates_org_active
  ON school_supervision_templates(organization_id, active, updated_at DESC);

CREATE TABLE school_supervision_reviews (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES school_supervision_templates(id),
  template_version integer NOT NULL,
  title text,
  observed_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','completed','follow_up','closed')),
  primary_entity_type text
    CHECK (primary_entity_type IS NULL OR primary_entity_type IN ('teacher','class','subject','student')),
  primary_entity_id text,
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  completed_at timestamptz,
  created_by text NOT NULL REFERENCES users(id),
  updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_supervision_reviews_answers_object CHECK (jsonb_typeof(answers_json) = 'object'),
  CONSTRAINT school_supervision_reviews_template_array CHECK (jsonb_typeof(template_snapshot) = 'array'),
  CONSTRAINT school_supervision_reviews_entity_pair CHECK (
    (primary_entity_type IS NULL AND primary_entity_id IS NULL) OR
    (primary_entity_type IS NOT NULL AND primary_entity_id IS NOT NULL)
  )
);

CREATE INDEX school_supervision_reviews_org_date
  ON school_supervision_reviews(organization_id, observed_on DESC, created_at DESC);
CREATE INDEX school_supervision_reviews_template
  ON school_supervision_reviews(organization_id, template_id, observed_on DESC);
CREATE INDEX school_supervision_reviews_entity
  ON school_supervision_reviews(organization_id, primary_entity_type, primary_entity_id, observed_on DESC);

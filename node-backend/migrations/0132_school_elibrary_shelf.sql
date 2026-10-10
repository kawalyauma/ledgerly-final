-- School e-library shelf: ULibTech (notesug.com) resources a school saves for its teachers and Ledgerly AI.
CREATE TABLE IF NOT EXISTS school_elibrary_shelf (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  resource_type TEXT,
  class_name TEXT,
  subject_name TEXT,
  term_name TEXT,
  page_count INTEGER,
  thumbnail_url TEXT,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  note TEXT,
  saved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, resource_slug)
);
CREATE INDEX IF NOT EXISTS school_elibrary_shelf_org_idx ON school_elibrary_shelf(organization_id, created_at DESC);

-- Let the academic AI employees use the e-library and draft schemes/lesson plans (always approval-gated).
UPDATE lai_agent_templates t
   SET tool_allowlist_json = (
         SELECT jsonb_agg(DISTINCT tool ORDER BY tool)
           FROM jsonb_array_elements_text(t.tool_allowlist_json || CASE
             WHEN t.agent_key IN ('elimu','dos','headteacher')
               THEN '["elibrary.search","elibrary.read_resource","elibrary.shelf.list","academics.setup.lookup","academics.scheme.create","academics.lesson_plan.create"]'::jsonb
             ELSE '["elibrary.search","elibrary.read_resource","elibrary.shelf.list"]'::jsonb END) AS tool),
       template_version = t.template_version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE t.agent_key IN ('elimu','dos','headteacher','ripoti');

CREATE TABLE saved_reports (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  report_type text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','organization')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX saved_reports_access_idx ON saved_reports(organization_id,visibility,owner_id,name);

CREATE TABLE report_packages (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  description text,
  report_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX report_packages_org_idx ON report_packages(organization_id,name);

CREATE TABLE report_layouts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL,
  groups_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  columns_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  branding_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX report_layouts_org_idx ON report_layouts(organization_id,report_type,name);

CREATE TABLE report_annotations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  period_key text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed_off')),
  created_by text NOT NULL REFERENCES users(id),
  signed_off_by text REFERENCES users(id),
  signed_off_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX report_annotations_org_idx ON report_annotations(organization_id,report_type,period_key);

CREATE TABLE report_schedules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  report_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('json','csv','xlsx','pdf')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  cron text NOT NULL CHECK (cron IN ('hourly','daily','weekly','monthly')),
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_job_id text REFERENCES report_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX report_schedules_due_idx ON report_schedules(active,next_run_at) WHERE active=true;
CREATE INDEX report_schedules_org_idx ON report_schedules(organization_id,name);

CREATE TABLE dashboards (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','organization')),
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX dashboards_access_idx ON dashboards(organization_id,visibility,owner_id,is_default,name);
CREATE UNIQUE INDEX dashboards_owner_default_uq ON dashboards(organization_id,owner_id) WHERE is_default=true;

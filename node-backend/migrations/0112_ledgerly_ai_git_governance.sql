CREATE TABLE IF NOT EXISTS lai_git_workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  incident_id TEXT,
  work_kind TEXT NOT NULL CHECK(work_kind IN ('incident','task','manual')),
  work_key TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','committed','pr_open','conflict','merged','closed','failed')),
  changed_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  diff_summary TEXT,
  conflict_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(branch_name)
);
CREATE INDEX IF NOT EXISTS idx_lai_git_workspaces_org_recent
  ON lai_git_workspaces(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_git_workspaces_incident
  ON lai_git_workspaces(incident_id,created_at DESC)
  WHERE incident_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lai_git_commits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  organization_id TEXT,
  incident_id TEXT,
  agent_key TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  diff_summary TEXT,
  changed_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commit_sha)
);
CREATE INDEX IF NOT EXISTS idx_lai_git_commits_workspace
  ON lai_git_commits(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS lai_git_pull_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  organization_id TEXT,
  incident_id TEXT,
  repository TEXT NOT NULL,
  external_number INTEGER,
  url TEXT,
  title TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','closed','merged','error')),
  ci_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK(ci_state IN ('unknown','pending','passing','failing')),
  mergeable_state TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_git_pr_external
  ON lai_git_pull_requests(repository,external_number)
  WHERE external_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lai_git_pr_workspace
  ON lai_git_pull_requests(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS lai_git_ci_checks (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL,
  organization_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  external_url TEXT,
  head_sha TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pull_request_id,name,head_sha)
);
CREATE INDEX IF NOT EXISTS idx_lai_git_ci_pr
  ON lai_git_ci_checks(pull_request_id,observed_at DESC);

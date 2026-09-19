ALTER TABLE lai_tool_calls
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS approval_id TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

ALTER TABLE lai_approvals
  ADD COLUMN IF NOT EXISTS tool_call_id TEXT,
  ADD COLUMN IF NOT EXISTS tool_name TEXT,
  ADD COLUMN IF NOT EXISTS required_scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result_json JSONB;

ALTER TABLE lai_approvals DROP CONSTRAINT IF EXISTS lai_approvals_status_check;
ALTER TABLE lai_approvals
  ADD CONSTRAINT lai_approvals_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled','executed','failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_tool_calls_approval
  ON lai_tool_calls(organization_id,approval_id)
  WHERE approval_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_approvals_tool_call
  ON lai_approvals(organization_id,tool_call_id)
  WHERE tool_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lai_approvals_pending_tools
  ON lai_approvals(organization_id,status,expires_at,created_at)
  WHERE tool_call_id IS NOT NULL;

UPDATE lai_agent_templates SET
  permissions_json='["school:read","reports:read","work:read","work:write","admin:read"]'::jsonb,
  tool_allowlist_json='["student.lookup","guardian.lookup","staff.lookup","report.generate","work.task.create","service.health"]'::jsonb
WHERE agent_key='amani';

UPDATE lai_agent_templates SET
  tool_allowlist_json='["repo.search","repo.status","repo.diff","test.run","build.run","logs.read","service.health","work.task.create"]'::jsonb
WHERE agent_key IN ('kato','maya');

UPDATE lai_agent_templates SET
  tool_allowlist_json='["db.query.safe","repo.search","repo.status","repo.diff","test.run","service.health"]'::jsonb
WHERE agent_key='tendo';

UPDATE lai_agent_templates SET
  tool_allowlist_json='["repo.search","repo.status","repo.diff","test.run","build.run","service.health","work.task.create"]'::jsonb
WHERE agent_key='nia';

UPDATE lai_agent_templates SET
  tool_allowlist_json='["docker.health","logs.read","service.health","repo.status","repo.diff","test.run","build.run","work.task.create"]'::jsonb
WHERE agent_key='jabali';

UPDATE lai_agent_templates SET
  tool_allowlist_json='["repo.search","repo.status","repo.diff","logs.read","service.health","db.query.safe"]'::jsonb
WHERE agent_key='safi';

UPDATE lai_agent_templates SET
  permissions_json='["school:read","school:write","reports:read","exams:read"]'::jsonb,
  tool_allowlist_json='["student.lookup","guardian.lookup","staff.lookup","attendance.read","attendance.record","academics.read","report.generate"]'::jsonb
WHERE agent_key='elimu';

UPDATE lai_agent_templates SET
  tool_allowlist_json='["student.lookup","fees.read","finance.read","payroll.read","report.generate"]'::jsonb
WHERE agent_key='hesabu';

UPDATE lai_agent_templates SET
  permissions_json='["reports:read","reports:write","school:read","accounts:read","payments:read","payroll:read","work:read"]'::jsonb,
  tool_allowlist_json='["student.lookup","guardian.lookup","staff.lookup","attendance.read","academics.read","fees.read","finance.read","payroll.read","report.generate"]'::jsonb
WHERE agent_key='ripoti';

UPDATE lai_agents a SET
  permissions_json=t.permissions_json,
  tool_allowlist_json=t.tool_allowlist_json,
  updated_at=CURRENT_TIMESTAMP
FROM lai_agent_templates t
WHERE a.organization_id IS NOT NULL
  AND a.kind='built-in'
  AND a.agent_key=t.agent_key;

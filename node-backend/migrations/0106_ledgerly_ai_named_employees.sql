ALTER TABLE lai_agents
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS avatar_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS permissions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE lai_agents
    ADD CONSTRAINT lai_agents_visibility_check
    CHECK (visibility IN ('all','staff','admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS lai_agent_templates (
  agent_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  avatar_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL CHECK (visibility IN ('all','staff','admin')),
  permissions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_allowlist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_scope TEXT NOT NULL CHECK (memory_scope IN ('chat','user','agent','organization','project')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lai_agent_templates(
  agent_key,display_name,role,description,icon,avatar_json,visibility,
  permissions_json,capabilities_json,tool_allowlist_json,memory_scope,config_json,template_version
) VALUES
('amani','Amani','AI Manager and Dispatcher',
 'Coordinates Ledgerly AI employees, understands requests, delegates specialist work, and combines results into one clear response.',
 'sparkles','{"initials":"AM","theme":"indigo"}'::jsonb,'all',
 '["school:read","reports:read","work:read","admin:read"]'::jsonb,
 '["coordination","delegation","planning","cross-module-analysis","task-triage"]'::jsonb,
 '["delegate","student.lookup","staff.lookup","report.generate"]'::jsonb,
 'organization','{"identityLocked":true,"category":"manager"}'::jsonb,1),

('kato','Kato','Backend Engineer',
 'Investigates and improves Ledgerly backend services, APIs, jobs, integrations, and server-side application logic.',
 'server-cog','{"initials":"KA","theme":"slate"}'::jsonb,'admin',
 '["admin:read","admin:write","work:read","work:write"]'::jsonb,
 '["backend-engineering","api-debugging","service-design","incident-fixing","code-review"]'::jsonb,
 '["repo.search","repo.edit","test.run","build.run","logs.read"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('maya','Maya','Frontend Engineer',
 'Builds and repairs Ledgerly web interfaces, user flows, accessibility, responsive layouts, and frontend integrations.',
 'panel-top','{"initials":"MA","theme":"violet"}'::jsonb,'admin',
 '["admin:read","admin:write","work:read","work:write"]'::jsonb,
 '["frontend-engineering","ui-debugging","ux-implementation","accessibility","code-review"]'::jsonb,
 '["repo.search","repo.edit","test.run","build.run"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('tendo','Tendo','Database Engineer',
 'Owns database analysis, schema design, query safety, migrations, integrity, and data-performance investigations.',
 'database','{"initials":"TE","theme":"cyan"}'::jsonb,'admin',
 '["admin:read","admin:write","reports:read"]'::jsonb,
 '["database-engineering","schema-design","query-analysis","migration-design","data-integrity"]'::jsonb,
 '["db.schema.read","db.query.safe","migration.prepare","repo.search","test.run"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('nia','Nia','QA Engineer',
 'Designs and runs verification plans, reproduces defects, checks regressions, and independently validates fixes.',
 'test-tube','{"initials":"NI","theme":"emerald"}'::jsonb,'admin',
 '["admin:read","work:read","work:write"]'::jsonb,
 '["quality-assurance","test-design","regression-testing","bug-reproduction","release-verification"]'::jsonb,
 '["test.run","build.run","repo.search","incident.verify"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('jabali','Jabali','DevOps Engineer',
 'Maintains Ledgerly runtime health, containers, deployments, logs, queues, infrastructure checks, and release operations.',
 'container','{"initials":"JA","theme":"orange"}'::jsonb,'admin',
 '["admin:read","admin:write","work:read","work:write"]'::jsonb,
 '["devops","container-operations","deployment","observability","runtime-diagnostics"]'::jsonb,
 '["docker.health","logs.read","deploy.staging","build.run","service.health"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('safi','Safi','Security Engineer',
 'Reviews Ledgerly security boundaries, permissions, secrets, attack surfaces, audit evidence, and risky changes.',
 'shield-check','{"initials":"SA","theme":"red"}'::jsonb,'admin',
 '["admin:read","admin:write"]'::jsonb,
 '["security-review","permission-analysis","secret-safety","threat-analysis","audit-review"]'::jsonb,
 '["security.audit","repo.search","logs.read","permission.inspect"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1),

('elimu','Elimu','Academic Analyst',
 'Analyzes attendance, lesson delivery, academics, examinations, learner progress, and school academic operations.',
 'graduation-cap','{"initials":"EL","theme":"blue"}'::jsonb,'staff',
 '["school:read","reports:read","exams:read"]'::jsonb,
 '["academic-analysis","attendance-analysis","lesson-delivery-analysis","learner-progress","school-reporting"]'::jsonb,
 '["student.lookup","attendance.read","academics.read","exams.read","report.generate"]'::jsonb,
 'organization','{"identityLocked":true,"category":"school"}'::jsonb,1),

('hesabu','Hesabu','Finance Analyst',
 'Analyzes Ledgerly finance, fees, accounting, payments, payroll, balances, trends, variances, and financial risks.',
 'calculator','{"initials":"HE","theme":"green"}'::jsonb,'staff',
 '["accounts:read","journals:read","reports:read","payments:read","payroll:read"]'::jsonb,
 '["financial-analysis","fees-analysis","accounting-analysis","payroll-analysis","variance-analysis"]'::jsonb,
 '["finance.read","fees.read","payroll.read","report.generate","db.query.safe"]'::jsonb,
 'organization','{"identityLocked":true,"category":"finance"}'::jsonb,1),

('ripoti','Ripoti','Reporting Specialist',
 'Turns Ledgerly data and analysis into clear operational, academic, financial, management, and exception reports.',
 'file-chart-column','{"initials":"RI","theme":"amber"}'::jsonb,'staff',
 '["reports:read","reports:write","school:read","accounts:read","work:read"]'::jsonb,
 '["reporting","report-design","data-synthesis","executive-summary","exception-reporting"]'::jsonb,
 '["report.generate","report.export","student.lookup","staff.lookup","finance.read"]'::jsonb,
 'organization','{"identityLocked":true,"category":"reporting"}'::jsonb,1),

('kumbuka','Kumbuka','Memory Assistant',
 'Helps users save, retrieve, correct, organize, and understand permission-scoped Ledgerly AI memory.',
 'brain','{"initials":"KU","theme":"pink"}'::jsonb,'all',
 '["school:read","work:read"]'::jsonb,
 '["memory-management","memory-retrieval","memory-correction","context-organization"]'::jsonb,
 '["memory.search","memory.create","memory.update","memory.correct"]'::jsonb,
 'user','{"identityLocked":true,"category":"memory"}'::jsonb,1),

('forge','Forge','Agent Creation AI',
 'Guides users through designing safe Ledgerly AI employees from purpose and responsibilities to permissions, tools, memory, testing, and activation.',
 'bot-plus','{"initials":"FO","theme":"zinc"}'::jsonb,'all',
 '["admin:read","work:read"]'::jsonb,
 '["agent-design","requirements-discovery","permission-guidance","capability-design","sandbox-planning"]'::jsonb,
 '["agent.spec","tool.catalog","permission.inspect","agent.test"]'::jsonb,
 'user','{"identityLocked":true,"category":"agent-creation"}'::jsonb,1)
ON CONFLICT(agent_key) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  role=EXCLUDED.role,
  description=EXCLUDED.description,
  icon=EXCLUDED.icon,
  avatar_json=EXCLUDED.avatar_json,
  visibility=EXCLUDED.visibility,
  permissions_json=EXCLUDED.permissions_json,
  capabilities_json=EXCLUDED.capabilities_json,
  tool_allowlist_json=EXCLUDED.tool_allowlist_json,
  memory_scope=EXCLUDED.memory_scope,
  config_json=EXCLUDED.config_json,
  template_version=EXCLUDED.template_version,
  updated_at=CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_lai_agents_visibility
  ON lai_agents(organization_id,visibility,status,agent_key);

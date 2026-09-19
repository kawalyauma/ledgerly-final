ALTER TABLE ae_conversations
  ADD COLUMN IF NOT EXISTS ledgerly_ai_chat_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_conversations_lai_chat
  ON ae_conversations(organization_id,ledgerly_ai_chat_id)
  WHERE ledgerly_ai_chat_id IS NOT NULL;

ALTER TABLE ae_messages
  ADD COLUMN IF NOT EXISTS ledgerly_ai_message_id TEXT;

ALTER TABLE ae_tasks
  ADD COLUMN IF NOT EXISTS ledgerly_ai_job_id TEXT;

ALTER TABLE ae_delegations
  ADD COLUMN IF NOT EXISTS ledgerly_ai_handoff_id TEXT,
  ADD COLUMN IF NOT EXISTS delegation_depth INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS context_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS lai_agent_handoffs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  parent_handoff_id TEXT,
  root_handoff_id TEXT,
  parent_job_id TEXT,
  child_job_id TEXT,
  parent_chat_id TEXT,
  child_chat_id TEXT,
  from_agent_key TEXT NOT NULL,
  to_agent_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  request_text TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  depth INTEGER NOT NULL DEFAULT 1 CHECK(depth BETWEEN 1 AND 8),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','completed','failed','cancelled')),
  response_text TEXT,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lai_handoffs_org_recent
  ON lai_agent_handoffs(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_handoffs_parent
  ON lai_agent_handoffs(organization_id,parent_handoff_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lai_handoffs_status
  ON lai_agent_handoffs(organization_id,status,created_at);

CREATE TABLE IF NOT EXISTS lai_agent_activity (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  job_id TEXT,
  chat_id TEXT,
  handoff_id TEXT,
  agent_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lai_agent_activity_org_recent
  ON lai_agent_activity(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_agent_activity_job
  ON lai_agent_activity(organization_id,job_id,created_at);

INSERT INTO lai_agent_templates(
  agent_key,display_name,role,description,icon,avatar_json,visibility,
  permissions_json,capabilities_json,tool_allowlist_json,memory_scope,config_json,template_version
) VALUES
('secretary','Amina','AI Secretary',
 'Front-office records, students and guardians, communications, correspondence, documents and routine school administration.',
 'clipboard-list','{"initials":"AM","theme":"sky"}'::jsonb,'staff',
 '["school:read","school:write","communications:read","communications:write","documents:read","documents:write","work:read","work:write"]'::jsonb,
 '["front-office","student-records","guardian-records","communications","documents"]'::jsonb,
 '["student.lookup","guardian.lookup","staff.lookup","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"secretary"}'::jsonb,1),

('dos','Daniel','AI Director of Studies',
 'Academic supervision, lesson plans, schemes, timetables, teacher deployment, attendance analysis and academic administration.',
 'book-open-check','{"initials":"DA","theme":"blue"}'::jsonb,'staff',
 '["school:read","school:write","reports:read","exams:read","work:read","work:write"]'::jsonb,
 '["academic-supervision","timetabling","attendance-analysis","lesson-delivery","delegation"]'::jsonb,
 '["student.lookup","guardian.lookup","staff.lookup","attendance.read","academics.read","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"dos"}'::jsonb,1),

('bursar','Grace','AI Bursar',
 'Fees, payments, accounting, banking, budgets, arrears, reports and finance documents.',
 'landmark','{"initials":"GR","theme":"green"}'::jsonb,'staff',
 '["school:read","accounts:read","journals:read","reports:read","payments:read","work:read","work:write"]'::jsonb,
 '["fees","accounting","payments","banking","arrears","finance-reporting"]'::jsonb,
 '["student.lookup","fees.read","finance.read","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"bursar"}'::jsonb,1),

('headteacher','Mirembe','AI Head Teacher Assistant',
 'Broad operational school management, executive analysis, academic scheduling and governed actions.',
 'school','{"initials":"MI","theme":"purple"}'::jsonb,'staff',
 '["school:read","school:write","reports:read","accounts:read","payments:read","payroll:read","hr:read","work:read","work:write"]'::jsonb,
 '["executive-analysis","school-management","academic-supervision","finance-oversight","hr-oversight","delegation"]'::jsonb,
 '["student.lookup","guardian.lookup","staff.lookup","attendance.read","academics.read","fees.read","finance.read","payroll.read","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"headteacher"}'::jsonb,1),

('hr','Sarah','AI HR Officer',
 'Staff records, leave, workforce administration, payroll-related HR work, documents and communications.',
 'users-round','{"initials":"SA","theme":"rose"}'::jsonb,'staff',
 '["school:read","hr:read","hr:write","payroll:read","work:read","work:write"]'::jsonb,
 '["human-resources","leave","workforce-administration","payroll-support"]'::jsonb,
 '["staff.lookup","payroll.read","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"hr"}'::jsonb,1),

('librarian','Peter','AI Librarian',
 'Writing-book stock, distributions, inventory records, learner book history and stock documents.',
 'library','{"initials":"PE","theme":"amber"}'::jsonb,'staff',
 '["school:read","products:read","documents:read","work:read","work:write"]'::jsonb,
 '["books","inventory","learner-book-history","stock-reporting"]'::jsonb,
 '["student.lookup","report.generate","work.task.create"]'::jsonb,
 'agent','{"identityLocked":true,"category":"legacy-agentic","legacyAgentKey":"librarian"}'::jsonb,1)
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

UPDATE lai_agent_templates
SET tool_allowlist_json = (
  SELECT jsonb_agg(DISTINCT value)
  FROM jsonb_array_elements_text(tool_allowlist_json || '["agent.delegate.legacy"]'::jsonb) AS x(value)
)
WHERE agent_key='amani';

UPDATE lai_agents a SET
  permissions_json=t.permissions_json,
  tool_allowlist_json=t.tool_allowlist_json,
  capabilities_json=t.capabilities_json,
  config_json=a.config_json || t.config_json,
  updated_at=CURRENT_TIMESTAMP
FROM lai_agent_templates t
WHERE a.organization_id IS NOT NULL
  AND a.agent_key=t.agent_key
  AND t.agent_key IN ('amani','secretary','dos','bursar','headteacher','hr','librarian');


CREATE OR REPLACE FUNCTION lai_sync_legacy_agent_memory() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  memory_id TEXT;
  legacy_agent_id TEXT;
  mapped_status TEXT;
  mapped_kind TEXT;
  mapped_importance DOUBLE PRECISION;
BEGIN
  IF TG_OP='DELETE' THEN
    UPDATE lai_memories
       SET status='deleted',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE organization_id=OLD.organization_id
       AND source_type='agentic_memory' AND source_id=OLD.id;
    RETURN OLD;
  END IF;

  memory_id := 'laimem_legacy_' || NEW.id;
  legacy_agent_id := 'laiagt_' || NEW.agent_key || '_' ||
    substr(md5(NEW.organization_id || ':' || NEW.agent_key),1,20);
  mapped_status := CASE
    WHEN NEW.memory_type='working' AND NEW.status IN ('done','cancelled') THEN 'expired'
    WHEN NEW.memory_type='institutional' AND NEW.status='archived' THEN 'expired'
    ELSE 'active'
  END;
  mapped_kind := CASE
    WHEN NEW.memory_type='working' THEN 'task'
    ELSE 'operational'
  END;
  mapped_importance := CASE NEW.priority
    WHEN 'urgent' THEN 1.0
    WHEN 'high' THEN 0.85
    WHEN 'normal' THEN 0.65
    ELSE 0.4
  END;

  INSERT INTO lai_memories(
    id,organization_id,scope_type,scope_id,memory_kind,title,content,
    importance,confidence,source_type,source_id,status,metadata_json,
    expires_at,created_by,updated_by,created_at,updated_at
  ) VALUES(
    memory_id,NEW.organization_id,'agent',legacy_agent_id,mapped_kind,
    NEW.title,NEW.content,mapped_importance,0.95,'agentic_memory',NEW.id,
    mapped_status,
    jsonb_build_object(
      'legacyAgentKey',NEW.agent_key,
      'legacyMemoryType',NEW.memory_type,
      'legacyVisibility',NEW.visibility,
      'legacyPriority',NEW.priority,
      'legacyStatus',NEW.status,
      'legacyTags',COALESCE(NEW.tags_json,'[]'::jsonb)
    ),
    CASE WHEN NEW.memory_type='working' THEN NEW.due_at ELSE NULL END,
    NEW.created_by,COALESCE(NEW.updated_by,NEW.created_by),
    COALESCE(NEW.created_at,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    scope_id=EXCLUDED.scope_id,
    memory_kind=EXCLUDED.memory_kind,
    title=EXCLUDED.title,
    content=EXCLUDED.content,
    importance=EXCLUDED.importance,
    confidence=EXCLUDED.confidence,
    status=EXCLUDED.status,
    metadata_json=EXCLUDED.metadata_json,
    expires_at=EXCLUDED.expires_at,
    updated_by=EXCLUDED.updated_by,
    updated_at=CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lai_legacy_agent_memory_sync ON ae_memories;
CREATE TRIGGER lai_legacy_agent_memory_sync
AFTER INSERT OR UPDATE ON ae_memories
FOR EACH ROW EXECUTE FUNCTION lai_sync_legacy_agent_memory();

DROP TRIGGER IF EXISTS lai_legacy_agent_memory_delete ON ae_memories;
CREATE TRIGGER lai_legacy_agent_memory_delete
AFTER DELETE ON ae_memories
FOR EACH ROW EXECUTE FUNCTION lai_sync_legacy_agent_memory();

INSERT INTO lai_memories(
  id,organization_id,scope_type,scope_id,memory_kind,title,content,
  importance,confidence,source_type,source_id,status,metadata_json,
  expires_at,created_by,updated_by,created_at,updated_at
)
SELECT
  'laimem_legacy_' || m.id,
  m.organization_id,
  'agent',
  'laiagt_' || m.agent_key || '_' || substr(md5(m.organization_id || ':' || m.agent_key),1,20),
  CASE WHEN m.memory_type='working' THEN 'task' ELSE 'operational' END,
  m.title,m.content,
  CASE m.priority WHEN 'urgent' THEN 1.0 WHEN 'high' THEN 0.85 WHEN 'normal' THEN 0.65 ELSE 0.4 END,
  0.95,'agentic_memory',m.id,
  CASE
    WHEN m.memory_type='working' AND m.status IN ('done','cancelled') THEN 'expired'
    WHEN m.memory_type='institutional' AND m.status='archived' THEN 'expired'
    ELSE 'active'
  END,
  jsonb_build_object(
    'legacyAgentKey',m.agent_key,'legacyMemoryType',m.memory_type,
    'legacyVisibility',m.visibility,'legacyPriority',m.priority,
    'legacyStatus',m.status,'legacyTags',COALESCE(m.tags_json,'[]'::jsonb)
  ),
  CASE WHEN m.memory_type='working' THEN m.due_at ELSE NULL END,
  m.created_by,COALESCE(m.updated_by,m.created_by),m.created_at,m.updated_at
FROM ae_memories m
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ae_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_id TEXT,
  reaction_id TEXT,
  agent_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  required_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','prepared','awaiting_approval','approved','executing','executed','failed','dismissed')),
  approval_id TEXT,
  result_entity_type TEXT,
  result_entity_id TEXT,
  failure_text TEXT,
  prepared_by TEXT,
  prepared_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  executed_by TEXT,
  executed_at TEXT,
  dismissed_by TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ae_actions_org_status ON ae_actions(organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_actions_event ON ae_actions(organization_id,event_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_actions_approval ON ae_actions(organization_id,approval_id) WHERE approval_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS ae_action_approval_approved
AFTER UPDATE OF status ON ae_approvals
FOR EACH ROW WHEN NEW.status='approved' AND OLD.status<>NEW.status
BEGIN
  UPDATE ae_actions SET status='approved',approved_by=NEW.reviewed_by,approved_at=COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND approval_id=NEW.id AND status='awaiting_approval';
END;

CREATE TRIGGER IF NOT EXISTS ae_action_approval_rejected
AFTER UPDATE OF status ON ae_approvals
FOR EACH ROW WHEN NEW.status IN ('rejected','cancelled') AND OLD.status<>NEW.status
BEGIN
  UPDATE ae_actions SET status='dismissed',dismissed_by=NEW.reviewed_by,dismissed_at=COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND approval_id=NEW.id AND status IN ('awaiting_approval','approved','executing');
END;

CREATE TRIGGER IF NOT EXISTS ae_action_approval_executed
AFTER UPDATE OF status ON ae_approvals
FOR EACH ROW WHEN NEW.status='executed' AND OLD.status<>NEW.status
BEGIN
  UPDATE ae_actions SET status='executed',executed_at=COALESCE(NEW.executed_at,CURRENT_TIMESTAMP),failure_text=NULL,updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND approval_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS ae_action_approval_failed
AFTER UPDATE OF status ON ae_approvals
FOR EACH ROW WHEN NEW.status='failed' AND OLD.status<>NEW.status
BEGIN
  UPDATE ae_actions SET status='failed',failure_text=NEW.execution_error,executed_at=COALESCE(NEW.executed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND approval_id=NEW.id;
END;

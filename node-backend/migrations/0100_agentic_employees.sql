CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ae_agent_settings(organization_id TEXT NOT NULL,agent_key TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),model_tier TEXT NOT NULL DEFAULT 'luna' CHECK(model_tier IN('luna','terra','sol')),system_prompt TEXT,tool_allowlist_json TEXT,updated_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,agent_key));
CREATE TABLE IF NOT EXISTS ae_conversations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,agent_key TEXT NOT NULL,created_by TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','closed','archived')),last_message_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_ae_conversations_org_recent ON ae_conversations(organization_id,last_message_at,created_at);
CREATE TABLE IF NOT EXISTS ae_messages(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,conversation_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('user','assistant','system')),content TEXT NOT NULL,user_id TEXT,model TEXT,provider_response_id TEXT,metadata_json TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_ae_messages_conversation ON ae_messages(organization_id,conversation_id,created_at);
CREATE TABLE IF NOT EXISTS ae_tasks(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,agent_key TEXT NOT NULL,conversation_id TEXT,created_by TEXT NOT NULL,title TEXT NOT NULL,instructions TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','waiting_approval','completed','failed','cancelled')),result_text TEXT,error_text TEXT,started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_ae_tasks_org_status ON ae_tasks(organization_id,status,created_at);
CREATE TABLE IF NOT EXISTS ae_tool_calls(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,conversation_id TEXT NOT NULL,agent_key TEXT NOT NULL,user_id TEXT NOT NULL,tool_name TEXT NOT NULL,arguments_json TEXT NOT NULL,result_json TEXT,status TEXT NOT NULL CHECK(status IN('running','succeeded','failed','denied')),error_text TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_ae_tool_calls_org_recent ON ae_tool_calls(organization_id,created_at);CREATE INDEX IF NOT EXISTS idx_ae_tool_calls_conversation ON ae_tool_calls(organization_id,conversation_id,created_at);
CREATE TABLE IF NOT EXISTS ae_approvals(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,conversation_id TEXT,task_id TEXT,agent_key TEXT NOT NULL,requested_by TEXT NOT NULL,action_type TEXT NOT NULL,required_scope TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','executed','failed','cancelled')),reviewed_by TEXT,review_note TEXT,reviewed_at TIMESTAMPTZ,executed_at TIMESTAMPTZ,execution_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS idx_ae_approvals_org_status ON ae_approvals(organization_id,status,created_at);
CREATE TABLE IF NOT EXISTS ae_proactive_schedules(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,workflow_key TEXT NOT NULL,agent_key TEXT NOT NULL,actor_user_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,cadence TEXT NOT NULL DEFAULT 'daily',run_hour INTEGER NOT NULL DEFAULT 7,run_minute INTEGER NOT NULL DEFAULT 0,weekday INTEGER,config_json TEXT NOT NULL DEFAULT '{}',last_run_at TIMESTAMPTZ,next_run_at TIMESTAMPTZ,updated_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(organization_id,workflow_key));CREATE INDEX IF NOT EXISTS idx_ae_proactive_due ON ae_proactive_schedules(enabled,next_run_at);
CREATE TABLE IF NOT EXISTS ae_proactive_runs(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,schedule_id TEXT,workflow_key TEXT NOT NULL,agent_key TEXT NOT NULL,actor_user_id TEXT NOT NULL,conversation_id TEXT,parent_run_id TEXT,trigger_type TEXT NOT NULL DEFAULT 'scheduled',status TEXT NOT NULL DEFAULT 'running',summary TEXT,error_text TEXT,model TEXT,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ,metadata_json TEXT NOT NULL DEFAULT '{}');CREATE INDEX IF NOT EXISTS idx_ae_proactive_runs_recent ON ae_proactive_runs(organization_id,started_at);CREATE INDEX IF NOT EXISTS idx_ae_proactive_runs_parent ON ae_proactive_runs(parent_run_id);
CREATE TABLE IF NOT EXISTS ae_family_reports(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,conversation_id TEXT,created_by TEXT NOT NULL,requested_agent_key TEXT NOT NULL,guardian_id TEXT,guardian_query TEXT NOT NULL,student_filter_json TEXT NOT NULL DEFAULT '{}',snapshot_json TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS idx_ae_family_reports_org_created ON ae_family_reports(organization_id,created_at);CREATE INDEX IF NOT EXISTS idx_ae_family_reports_guardian ON ae_family_reports(organization_id,guardian_id,created_at);
CREATE TABLE IF NOT EXISTS ae_delegations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,parent_conversation_id TEXT,child_conversation_id TEXT,from_agent_key TEXT NOT NULL,to_agent_key TEXT NOT NULL,requested_by TEXT NOT NULL,request_text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',response_text TEXT,model TEXT,error_text TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ);CREATE INDEX IF NOT EXISTS idx_ae_delegations_parent ON ae_delegations(organization_id,parent_conversation_id,created_at);CREATE INDEX IF NOT EXISTS idx_ae_delegations_recent ON ae_delegations(organization_id,created_at);
CREATE TABLE IF NOT EXISTS ae_event_inbox(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,event_type TEXT NOT NULL,source_module TEXT NOT NULL,source_record_id TEXT NOT NULL,subject_type TEXT,subject_id TEXT,payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','processed','ignored','failed')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ,occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),processing_started_at TIMESTAMPTZ,processed_at TIMESTAMPTZ,error_text TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_event_dedupe ON ae_event_inbox(organization_id,event_type,source_record_id,occurred_at);CREATE INDEX IF NOT EXISTS idx_ae_event_pending ON ae_event_inbox(status,next_attempt_at,occurred_at);CREATE INDEX IF NOT EXISTS idx_ae_event_org_recent ON ae_event_inbox(organization_id,occurred_at);
CREATE TABLE IF NOT EXISTS ae_event_reactions(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,event_id TEXT NOT NULL,agent_key TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN('info','attention','urgent')),title TEXT NOT NULL,summary TEXT NOT NULL,recommended_action TEXT,model TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',acknowledged_at TIMESTAMPTZ,acknowledged_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(organization_id,event_id,agent_key));CREATE INDEX IF NOT EXISTS idx_ae_event_reactions_recent ON ae_event_reactions(organization_id,created_at);CREATE INDEX IF NOT EXISTS idx_ae_event_reactions_unacked ON ae_event_reactions(organization_id,acknowledged_at,severity,created_at);
CREATE TABLE IF NOT EXISTS ae_event_settings(organization_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,attendance_window_days INTEGER NOT NULL DEFAULT 7,attendance_attention_count INTEGER NOT NULL DEFAULT 2,attendance_urgent_count INTEGER NOT NULL DEFAULT 3,books_low_stock_threshold INTEGER NOT NULL DEFAULT 20,payment_reaction_enabled INTEGER NOT NULL DEFAULT 1,attendance_reaction_enabled INTEGER NOT NULL DEFAULT 1,hr_reaction_enabled INTEGER NOT NULL DEFAULT 1,books_reaction_enabled INTEGER NOT NULL DEFAULT 1,updated_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ae_actions(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,event_id TEXT,reaction_id TEXT,agent_key TEXT NOT NULL,action_type TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL,required_scope TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',idempotency_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN('suggested','prepared','awaiting_approval','approved','executing','executed','failed','dismissed')),approval_id TEXT,result_entity_type TEXT,result_entity_id TEXT,failure_text TEXT,prepared_by TEXT,prepared_at TIMESTAMPTZ,approved_by TEXT,approved_at TIMESTAMPTZ,executed_by TEXT,executed_at TIMESTAMPTZ,dismissed_by TEXT,dismissed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(organization_id,idempotency_key));CREATE INDEX IF NOT EXISTS idx_ae_actions_org_status ON ae_actions(organization_id,status,created_at);CREATE INDEX IF NOT EXISTS idx_ae_actions_event ON ae_actions(organization_id,event_id,created_at);CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_actions_approval ON ae_actions(organization_id,approval_id) WHERE approval_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ae_generated_documents(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,agent_key TEXT NOT NULL,conversation_id TEXT,action_id TEXT,title TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN('docx','xlsx','pptx')),source_object_key TEXT NOT NULL,pdf_object_key TEXT NOT NULL,source_mime_type TEXT NOT NULL,source_size_bytes BIGINT NOT NULL DEFAULT 0,pdf_size_bytes BIGINT NOT NULL DEFAULT 0,checksum_sha256 TEXT,spec_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'saved' CHECK(status IN('saved','archived','deleted')),created_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_org_recent ON ae_generated_documents(organization_id,created_at);CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_agent_recent ON ae_generated_documents(organization_id,agent_key,created_at);CREATE INDEX IF NOT EXISTS idx_ae_generated_documents_action ON ae_generated_documents(organization_id,action_id);

CREATE OR REPLACE FUNCTION ae_sync_action_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN UPDATE ae_actions SET status='approved',approved_by=NEW.reviewed_by,approved_at=COALESCE(NEW.reviewed_at,now()),updated_at=now() WHERE organization_id=NEW.organization_id AND approval_id=NEW.id AND status='awaiting_approval'; ELSIF NEW.status IN('rejected','cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN UPDATE ae_actions SET status='dismissed',dismissed_by=NEW.reviewed_by,dismissed_at=COALESCE(NEW.reviewed_at,now()),updated_at=now() WHERE organization_id=NEW.organization_id AND approval_id=NEW.id AND status IN('awaiting_approval','approved','executing'); ELSIF NEW.status='executed' AND OLD.status IS DISTINCT FROM NEW.status THEN UPDATE ae_actions SET status='executed',executed_at=COALESCE(NEW.executed_at,now()),failure_text=NULL,updated_at=now() WHERE organization_id=NEW.organization_id AND approval_id=NEW.id; ELSIF NEW.status='failed' AND OLD.status IS DISTINCT FROM NEW.status THEN UPDATE ae_actions SET status='failed',failure_text=NEW.execution_error,executed_at=COALESCE(NEW.executed_at,now()),updated_at=now() WHERE organization_id=NEW.organization_id AND approval_id=NEW.id; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ae_action_approval_sync ON ae_approvals;CREATE TRIGGER ae_action_approval_sync AFTER UPDATE OF status ON ae_approvals FOR EACH ROW EXECUTE FUNCTION ae_sync_action_approval();

CREATE OR REPLACE FUNCTION ae_enqueue_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.payment_id AND p.organization_id=NEW.organization_id AND p.status='posted') THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) VALUES('aev_'||replace(gen_random_uuid()::text,'-',''),NEW.organization_id,'finance.payment_allocated','finance',NEW.id,'document',NEW.document_id,jsonb_build_object('paymentId',NEW.payment_id,'documentId',NEW.document_id,'amountMinor',NEW.amount_minor)::text,now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION ae_enqueue_payment_posted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='posted' AND OLD.status IS DISTINCT FROM NEW.status THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) SELECT 'aev_'||replace(gen_random_uuid()::text,'-',''),a.organization_id,'finance.payment_allocated','finance',a.id,'document',a.document_id,jsonb_build_object('paymentId',a.payment_id,'documentId',a.document_id,'amountMinor',a.amount_minor)::text,now() FROM payment_allocations a WHERE a.payment_id=NEW.id AND a.organization_id=NEW.organization_id ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION ae_enqueue_absence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) VALUES('aev_'||replace(gen_random_uuid()::text,'-',''),NEW.organization_id,'attendance.student_absent','attendance',NEW.id,'student',NEW.person_id,jsonb_build_object('attendanceDate',NEW.attendance_date,'status',NEW.status)::text,now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION ae_enqueue_leave() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) VALUES('aev_'||replace(gen_random_uuid()::text,'-',''),NEW.organization_id,'hr.leave_approved','human-resources',NEW.id,'employee',NEW.employee_id,jsonb_build_object('status',NEW.status,'previousStatus',OLD.status)::text,now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION ae_enqueue_book_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reversed_at IS NULL THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) VALUES('aev_'||replace(gen_random_uuid()::text,'-',''),NEW.organization_id,'books.stock_changed','books',NEW.id,'book_type',NEW.book_type,jsonb_build_object('bookType',NEW.book_type,'quantityDelta',NEW.quantity_delta)::text,COALESCE(NEW.created_at,now())) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION ae_enqueue_book_distribution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reversed_at IS NULL THEN INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at) VALUES('aev_'||replace(gen_random_uuid()::text,'-',''),NEW.organization_id,'books.stock_changed','books','distribution:'||NEW.id,'book_type',NEW.book_type,jsonb_build_object('bookType',NEW.book_type,'quantityDistributed',NEW.quantity)::text,now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
DO $$ BEGIN IF to_regclass('public.payment_allocations') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_payment_allocation_insert ON payment_allocations;CREATE TRIGGER ae_evt_payment_allocation_insert AFTER INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION ae_enqueue_payment_allocation();END IF;IF to_regclass('public.payments') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_payment_posted ON payments;CREATE TRIGGER ae_evt_payment_posted AFTER UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION ae_enqueue_payment_posted();END IF;IF to_regclass('public.att_records') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_attendance_absent_insert ON att_records;DROP TRIGGER IF EXISTS ae_evt_attendance_absent_update ON att_records;CREATE TRIGGER ae_evt_attendance_absent_insert AFTER INSERT ON att_records FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();CREATE TRIGGER ae_evt_attendance_absent_update AFTER UPDATE OF status ON att_records FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();END IF;IF to_regclass('public.hr_leave_requests') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_hr_leave_approved ON hr_leave_requests;CREATE TRIGGER ae_evt_hr_leave_approved AFTER UPDATE OF status ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION ae_enqueue_leave();END IF;IF to_regclass('public.bks_stock_movements') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_books_stock_movement ON bks_stock_movements;CREATE TRIGGER ae_evt_books_stock_movement AFTER INSERT ON bks_stock_movements FOR EACH ROW EXECUTE FUNCTION ae_enqueue_book_movement();END IF;IF to_regclass('public.bks_distributions') IS NOT NULL THEN DROP TRIGGER IF EXISTS ae_evt_books_distribution ON bks_distributions;CREATE TRIGGER ae_evt_books_distribution AFTER INSERT ON bks_distributions FOR EACH ROW EXECUTE FUNCTION ae_enqueue_book_distribution();END IF;END $$;
-- Agentic Employees v1.5 PostgreSQL patch.
-- Apply after selfhost/postgres/agentic-employees.sql.

ALTER TABLE ae_generated_documents
  ADD COLUMN IF NOT EXISTS pdf_page_count INTEGER NOT NULL DEFAULT 1;

-- Avoid referring to OLD during INSERT triggers. PostgreSQL does not define OLD
-- for INSERT operations, so handle inserts and updates as separate branches.
CREATE OR REPLACE FUNCTION ae_enqueue_absence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent' THEN
      INSERT INTO ae_event_inbox(
        id,organization_id,event_type,source_module,source_record_id,
        subject_type,subject_id,payload_json,occurred_at
      ) VALUES(
        'aev_'||replace(gen_random_uuid()::text,'-',''),
        NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
        'student',NEW.person_id,
        jsonb_build_object('attendanceDate',NEW.attendance_date,'status',NEW.status)::text,
        now()
      ) ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent'
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO ae_event_inbox(
        id,organization_id,event_type,source_module,source_record_id,
        subject_type,subject_id,payload_json,occurred_at
      ) VALUES(
        'aev_'||replace(gen_random_uuid()::text,'-',''),
        NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
        'student',NEW.person_id,
        jsonb_build_object(
          'attendanceDate',NEW.attendance_date,
          'status',NEW.status,
          'previousStatus',OLD.status
        )::text,
        now()
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Reinstall the triggers in case the base migration was applied before this patch.
DO $$
BEGIN
  IF to_regclass('public.att_records') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ae_evt_attendance_absent_insert ON att_records;
    DROP TRIGGER IF EXISTS ae_evt_attendance_absent_update ON att_records;
    CREATE TRIGGER ae_evt_attendance_absent_insert
      AFTER INSERT ON att_records
      FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();
    CREATE TRIGGER ae_evt_attendance_absent_update
      AFTER UPDATE OF status ON att_records
      FOR EACH ROW EXECUTE FUNCTION ae_enqueue_absence();
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS ae_image_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  ocr_text TEXT,
  vision_summary TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('processing','ready','failed','deleted')),
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ae_image_attachments_org_recent ON ae_image_attachments(organization_id,created_at);
CREATE TABLE IF NOT EXISTS ae_memories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK(memory_type IN ('working','institutional')),
  visibility TEXT NOT NULL DEFAULT 'agent' CHECK(visibility IN ('agent','organization')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  due_at TIMESTAMPTZ,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_conversation_id TEXT,
  source_message_id TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((memory_type='working' AND status IN ('open','in_progress','waiting','done','cancelled')) OR (memory_type='institutional' AND status IN ('active','archived')))
);
CREATE INDEX IF NOT EXISTS idx_ae_memory_agent ON ae_memories(organization_id,agent_key,memory_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_memory_due ON ae_memories(organization_id,memory_type,status,due_at);
CREATE INDEX IF NOT EXISTS idx_ae_memory_org_shared ON ae_memories(organization_id,visibility,memory_type,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS ae_ai_provider_settings (
  organization_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'google', 'anthropic')),
  models_json TEXT NOT NULL DEFAULT '{}',
  api_key_ciphertext TEXT,
  api_key_hint TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ae_ai_provider_settings_provider
  ON ae_ai_provider_settings(provider);

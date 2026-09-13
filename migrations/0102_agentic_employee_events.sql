CREATE TABLE IF NOT EXISTS ae_event_inbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','ignored','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TEXT,
  processed_at TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_event_dedupe
  ON ae_event_inbox(organization_id,event_type,source_record_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_ae_event_pending
  ON ae_event_inbox(status,next_attempt_at,occurred_at);
CREATE INDEX IF NOT EXISTS idx_ae_event_org_recent
  ON ae_event_inbox(organization_id,occurred_at);

CREATE TABLE IF NOT EXISTS ae_event_reactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','attention','urgent')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommended_action TEXT,
  model TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,event_id,agent_key)
);

CREATE INDEX IF NOT EXISTS idx_ae_event_reactions_recent
  ON ae_event_reactions(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ae_event_reactions_unacked
  ON ae_event_reactions(organization_id,acknowledged_at,severity,created_at);

CREATE TRIGGER IF NOT EXISTS ae_evt_payment_allocation_insert
AFTER INSERT ON payment_allocations
FOR EACH ROW
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'finance.payment_allocated','finance',NEW.id,
    'document',NEW.document_id,
    json_object('paymentId',NEW.payment_id,'documentId',NEW.document_id,'amountMinor',NEW.amount_minor),
    COALESCE(NEW.created_at,CURRENT_TIMESTAMP)
  );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_attendance_absent_insert
AFTER INSERT ON att_records
FOR EACH ROW
WHEN NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent'
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
    'student',NEW.person_id,
    json_object('attendanceDate',NEW.attendance_date,'status',NEW.status),
    CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_attendance_absent_update
AFTER UPDATE OF status ON att_records
FOR EACH ROW
WHEN NEW.person_type='student' AND NEW.official=1 AND NEW.status='absent' AND OLD.status<>'absent'
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'attendance.student_absent','attendance',NEW.id,
    'student',NEW.person_id,
    json_object('attendanceDate',NEW.attendance_date,'status',NEW.status,'previousStatus',OLD.status),
    CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_hr_leave_approved
AFTER UPDATE OF status ON hr_leave_requests
FOR EACH ROW
WHEN NEW.status='approved' AND OLD.status<>'approved'
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'hr.leave_approved','human-resources',NEW.id,
    'employee',NEW.employee_id,
    json_object('previousStatus',OLD.status,'status',NEW.status),
    CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_books_stock_movement
AFTER INSERT ON bks_stock_movements
FOR EACH ROW
WHEN NEW.reversed_at IS NULL
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'books.stock_changed','books',NEW.id,
    'book_type',NEW.book_type,
    json_object('bookType',NEW.book_type,'quantityDelta',NEW.quantity_delta),
    COALESCE(NEW.created_at,CURRENT_TIMESTAMP)
  );
END;

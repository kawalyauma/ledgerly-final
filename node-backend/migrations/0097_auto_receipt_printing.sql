CREATE TABLE prn_receipt_print_settings (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
  copies integer NOT NULL DEFAULT 1 CHECK(copies BETWEEN 1 AND 10),
  page_size text NOT NULL DEFAULT 'A5' CHECK(page_size IN ('A4','A5','Letter','Legal')),
  auto_charge_finance boolean NOT NULL DEFAULT true,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prn_receipt_print_dispatches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  printerly_document_id text REFERENCES prn_documents(id) ON DELETE SET NULL,
  printerly_job_id text REFERENCES prn_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','waiting_printer','queued','printing','completed','failed','skipped')),
  finance_status text NOT NULL DEFAULT 'pending' CHECK(finance_status IN ('pending','posted','not_applicable','failed')),
  finance_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,payment_id)
);
CREATE INDEX prn_receipt_dispatch_due_idx ON prn_receipt_print_dispatches(status,next_attempt_at,created_at)
  WHERE status IN ('pending','waiting_printer');
CREATE INDEX prn_receipt_dispatch_finance_idx ON prn_receipt_print_dispatches(finance_status,next_attempt_at,created_at)
  WHERE status='completed' AND finance_status IN ('pending','failed');

CREATE OR REPLACE FUNCTION ledgerly_enqueue_receipt_autoprint() RETURNS trigger AS $$
DECLARE
  dispatch_id text;
  job_id uuid;
  printing_enabled boolean;
BEGIN
  IF NEW.type <> 'receipt' OR NEW.status <> 'posted' OR OLD.status = 'posted' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.enabled,true) INTO printing_enabled
  FROM (SELECT 1) x
  LEFT JOIN prn_receipt_print_settings s ON s.organization_id=NEW.organization_id;
  IF NOT printing_enabled THEN RETURN NEW; END IF;

  dispatch_id := 'rpd_' || substr(md5(NEW.organization_id || ':' || NEW.id),1,24);
  INSERT INTO prn_receipt_print_dispatches(id,organization_id,payment_id)
  VALUES(dispatch_id,NEW.organization_id,NEW.id)
  ON CONFLICT(organization_id,payment_id) DO NOTHING;

  job_id := CAST(md5('printerly.auto_receipt:' || NEW.organization_id || ':' || NEW.id) AS uuid);
  INSERT INTO backend_jobs(id,queue,kind,payload,status,attempts,max_attempts,available_at)
  VALUES(job_id,'printerly','printerly.auto_receipt',jsonb_build_object('organizationId',NEW.organization_id,'paymentId',NEW.id),'queued',0,8,CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_receipt_autoprint_trg ON payments;
CREATE TRIGGER payments_receipt_autoprint_trg
AFTER UPDATE OF status ON payments
FOR EACH ROW
WHEN (NEW.type='receipt' AND NEW.status='posted' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION ledgerly_enqueue_receipt_autoprint();

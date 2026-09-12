CREATE TABLE payments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('receipt','payment')),
  number text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  bank_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  control_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  currency text NOT NULL CHECK (char_length(currency)=3),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,type,number),
  UNIQUE (organization_id,idempotency_key)
);
CREATE INDEX payments_org_date_idx ON payments (organization_id,payment_date DESC,number DESC);
CREATE INDEX payments_contact_idx ON payments (organization_id,contact_id,payment_date DESC);
CREATE INDEX payments_journal_idx ON payments (organization_id,journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE TABLE payment_allocations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (organization_id,payment_id) WHERE reversed_at IS NULL;
CREATE INDEX payment_allocations_document_idx ON payment_allocations (organization_id,document_id) WHERE reversed_at IS NULL;

CREATE OR REPLACE FUNCTION ledgerly_validate_payment_allocation() RETURNS trigger AS $$
DECLARE
  payment_row payments%ROWTYPE;
  document_row documents%ROWTYPE;
  used_payment bigint;
  used_document bigint;
  expected_document_type text;
BEGIN
  IF NEW.reversed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO payment_row FROM payments
    WHERE id=NEW.payment_id AND organization_id=NEW.organization_id
    FOR UPDATE;
  IF NOT FOUND OR payment_row.status <> 'posted' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_POSTED:%', NEW.payment_id USING ERRCODE='P0001';
  END IF;

  expected_document_type := CASE WHEN payment_row.type='receipt' THEN 'invoice' ELSE 'bill' END;
  SELECT * INTO document_row FROM documents
    WHERE id=NEW.document_id AND organization_id=NEW.organization_id
    FOR UPDATE;
  IF NOT FOUND
     OR document_row.contact_id <> payment_row.contact_id
     OR document_row.type <> expected_document_type
     OR document_row.currency <> payment_row.currency
     OR document_row.status NOT IN ('open','partially_paid') THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION_DOCUMENT:%', NEW.document_id USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(SUM(amount_minor),0) INTO used_payment
    FROM payment_allocations
    WHERE organization_id=NEW.organization_id AND payment_id=NEW.payment_id
      AND reversed_at IS NULL AND id<>NEW.id;
  IF used_payment + NEW.amount_minor > payment_row.amount_minor THEN
    RAISE EXCEPTION 'PAYMENT_OVER_ALLOCATION:%', NEW.payment_id USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(SUM(amount_minor),0) INTO used_document
    FROM payment_allocations
    WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id
      AND reversed_at IS NULL AND id<>NEW.id;
  IF used_document + NEW.amount_minor > document_row.total_minor THEN
    RAISE EXCEPTION 'DOCUMENT_OVER_ALLOCATION:%', NEW.document_id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocation_validate
BEFORE INSERT OR UPDATE OF payment_id,document_id,amount_minor,reversed_at ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_payment_allocation();

CREATE OR REPLACE FUNCTION ledgerly_recompute_document_paid(p_organization_id text,p_document_id text) RETURNS void AS $$
DECLARE allocated bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor),0) INTO allocated
    FROM payment_allocations
    WHERE organization_id=p_organization_id AND document_id=p_document_id AND reversed_at IS NULL;
  UPDATE documents
    SET paid_minor=allocated,
        status=CASE WHEN allocated=0 THEN 'open' WHEN allocated<total_minor THEN 'partially_paid' ELSE 'paid' END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=p_document_id AND organization_id=p_organization_id
      AND status IN ('open','partially_paid','paid');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ledgerly_sync_document_after_allocation() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM ledgerly_recompute_document_paid(OLD.organization_id,OLD.document_id);
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    PERFORM ledgerly_recompute_document_paid(OLD.organization_id,OLD.document_id);
  END IF;
  PERFORM ledgerly_recompute_document_paid(NEW.organization_id,NEW.document_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocation_document_sync
AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION ledgerly_sync_document_after_allocation();

CREATE OR REPLACE FUNCTION ledgerly_guard_payment_status() RETURNS trigger AS $$
DECLARE linked_status text;
DECLARE active_allocations bigint;
BEGIN
  IF NEW.status='posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    IF NEW.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'PAYMENT_JOURNAL_REQUIRED:%', NEW.id USING ERRCODE='P0001';
    END IF;
    SELECT status INTO linked_status FROM journal_entries
      WHERE id=NEW.journal_entry_id AND organization_id=NEW.organization_id;
    IF linked_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'PAYMENT_JOURNAL_NOT_POSTED:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.status='reversed' AND OLD.status IS DISTINCT FROM 'reversed' THEN
    IF NEW.journal_entry_id IS NULL OR NEW.reversal_journal_id IS NULL THEN
      RAISE EXCEPTION 'PAYMENT_REVERSAL_JOURNAL_REQUIRED:%', NEW.id USING ERRCODE='P0001';
    END IF;
    SELECT status INTO linked_status FROM journal_entries
      WHERE id=NEW.journal_entry_id AND organization_id=NEW.organization_id;
    IF linked_status IS DISTINCT FROM 'reversed' THEN
      RAISE EXCEPTION 'PAYMENT_ORIGINAL_JOURNAL_NOT_REVERSED:%', NEW.id USING ERRCODE='P0001';
    END IF;
    SELECT COUNT(*) INTO active_allocations FROM payment_allocations
      WHERE organization_id=NEW.organization_id AND payment_id=NEW.id AND reversed_at IS NULL;
    IF active_allocations <> 0 THEN
      RAISE EXCEPTION 'PAYMENT_ALLOCATIONS_STILL_ACTIVE:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_status_guard
BEFORE UPDATE OF status,journal_entry_id,reversal_journal_id ON payments
FOR EACH ROW EXECUTE FUNCTION ledgerly_guard_payment_status();

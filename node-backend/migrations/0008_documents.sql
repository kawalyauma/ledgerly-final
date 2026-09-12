CREATE TABLE documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('invoice','bill','credit_note','supplier_credit')),
  number text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  issue_date date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','partially_paid','paid','void')),
  currency text NOT NULL CHECK (char_length(currency)=3),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0 AND paid_minor <= total_minor),
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,type,number)
);
CREATE INDEX documents_ageing_idx ON documents (organization_id,type,status,due_date);
CREATE INDEX documents_contact_idx ON documents (organization_id,contact_id,issue_date DESC);
CREATE INDEX documents_journal_idx ON documents (organization_id,journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE TABLE document_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id text,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  tax_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity_micros bigint NOT NULL DEFAULT 1000000 CHECK (quantity_micros > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0 AND total_minor = subtotal_minor + tax_minor),
  project_id text,
  class_id text,
  department_id text,
  location_id text,
  dimensions_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions_json)='object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_lines_doc_idx ON document_lines (organization_id,document_id);
CREATE INDEX document_lines_account_idx ON document_lines (organization_id,account_id);

CREATE OR REPLACE FUNCTION ledgerly_guard_document_status() RETURNS trigger AS $$
DECLARE linked_status text;
BEGIN
  IF NEW.status IN ('open','partially_paid','paid') THEN
    IF NEW.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'DOCUMENT_JOURNAL_REQUIRED:%', NEW.id USING ERRCODE='P0001';
    END IF;
    SELECT status INTO linked_status FROM journal_entries
      WHERE id=NEW.journal_entry_id AND organization_id=NEW.organization_id;
    IF linked_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'DOCUMENT_JOURNAL_NOT_POSTED:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.status='void' AND NEW.journal_entry_id IS NOT NULL THEN
    SELECT status INTO linked_status FROM journal_entries
      WHERE id=NEW.journal_entry_id AND organization_id=NEW.organization_id;
    IF linked_status IS DISTINCT FROM 'reversed' THEN
      RAISE EXCEPTION 'DOCUMENT_JOURNAL_NOT_REVERSED:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_status_guard
BEFORE INSERT OR UPDATE OF status,journal_entry_id ON documents
FOR EACH ROW EXECUTE FUNCTION ledgerly_guard_document_status();

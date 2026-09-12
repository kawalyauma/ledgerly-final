CREATE TABLE document_attachments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 25000000),
  uploaded_by text NOT NULL,
  uploaded_at timestamptz,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_attachments_entity_idx ON document_attachments(organization_id,entity_type,entity_id,created_at DESC);

CREATE TABLE document_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('document','order')),
  entity_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','download')),
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','opened','failed')),
  sent_at timestamptz,
  opened_at timestamptz,
  failure_reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_deliveries_entity_idx ON document_deliveries(organization_id,entity_type,entity_id,created_at DESC);

CREATE TABLE expense_claims (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  number text NOT NULL,
  claim_date date NOT NULL,
  currency text NOT NULL CHECK (char_length(currency)=3),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  reimbursed_payment_id text REFERENCES payments(id) ON DELETE RESTRICT,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,number)
);
CREATE TABLE expense_claim_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('expense','mileage','per_diem','card')),
  expense_date date NOT NULL,
  description text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  mileage_micros bigint,
  per_diem_days integer,
  project_id text REFERENCES projects(id) ON DELETE RESTRICT,
  receipt_attachment_id text REFERENCES document_attachments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX expense_claim_lines_claim_idx ON expense_claim_lines(organization_id,claim_id,expense_date);

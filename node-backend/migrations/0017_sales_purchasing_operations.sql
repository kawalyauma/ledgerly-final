CREATE TABLE orders (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('estimate','sales_order','purchase_order')),
  number text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  issue_date date NOT NULL,
  expiry_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','cancelled','converted','fulfilled','partially_fulfilled')),
  currency text NOT NULL CHECK (char_length(currency)=3),
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  accepted_at timestamptz,
  rejected_at timestamptz,
  fulfilled_quantity_micros bigint NOT NULL DEFAULT 0,
  converted_document_id text REFERENCES documents(id) ON DELETE RESTRICT,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,type,number)
);
CREATE INDEX orders_org_status_idx ON orders (organization_id,type,status,issue_date DESC);

CREATE TABLE order_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  tax_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL,
  project_id text REFERENCES projects(id) ON DELETE RESTRICT,
  fulfilled_quantity_micros bigint NOT NULL DEFAULT 0 CHECK (fulfilled_quantity_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fulfilled_quantity_micros <= quantity_micros)
);
CREATE INDEX order_lines_order_idx ON order_lines (organization_id,order_id,id);

CREATE TABLE delivery_notes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  number text NOT NULL,
  delivery_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','fulfilled','cancelled')),
  notes text,
  created_by text,
  fulfilled_by text,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,number)
);
CREATE TABLE delivery_note_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_note_id text NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  order_line_id text NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
  location_id text REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  inventory_movement_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,delivery_note_id,order_line_id)
);

CREATE TABLE purchase_requisitions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  requested_by text NOT NULL,
  required_by date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','converted','cancelled')),
  description text NOT NULL,
  estimated_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_minor >= 0),
  approved_by text,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,number)
);

CREATE TABLE goods_receipts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id text NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  number text NOT NULL,
  received_date date NOT NULL,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  supplier_document_number text,
  created_by text,
  posted_by text,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,number)
);
CREATE TABLE goods_receipt_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goods_receipt_id text NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  order_line_id text NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  inventory_movement_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,goods_receipt_id,order_line_id)
);

CREATE TABLE recurring_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('invoice','bill','journal')),
  name text NOT NULL,
  template_json jsonb NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('weekly','monthly','quarterly','yearly')),
  next_run_at timestamptz NOT NULL,
  auto_post boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX recurring_templates_due_idx ON recurring_templates (active,next_run_at);

CREATE TABLE approval_policies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  minimum_minor bigint NOT NULL DEFAULT 0,
  maximum_minor bigint,
  levels integer NOT NULL DEFAULT 1 CHECK (levels BETWEEN 1 AND 10),
  approver_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (maximum_minor IS NULL OR maximum_minor >= minimum_minor)
);
CREATE TABLE document_approval_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  policy_id text REFERENCES approval_policies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revision_required')),
  current_level integer NOT NULL DEFAULT 1,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by text,
  decided_at timestamptz,
  comments text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX approval_requests_entity_idx ON document_approval_requests (organization_id,entity_type,entity_id,status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'documents' AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE documents ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN ('not_required','pending','approved','rejected','revision_required'));
  ELSE
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_approval_status_check;
    ALTER TABLE documents ADD CONSTRAINT documents_approval_status_check CHECK (approval_status IN ('not_required','pending','approved','rejected','revision_required'));
  END IF;
END $$;

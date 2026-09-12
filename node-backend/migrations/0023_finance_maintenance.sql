CREATE TABLE supplier_bank_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  account_number_masked text NOT NULL,
  account_number_encrypted text NOT NULL,
  branch_code text,
  swift_bic text,
  currency text NOT NULL CHECK (char_length(currency)=3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX supplier_bank_accounts_contact_idx ON supplier_bank_accounts(organization_id,contact_id,active);

CREATE TABLE cheques (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  cheque_number text NOT NULL,
  payee_contact_id text REFERENCES contacts(id) ON DELETE RESTRICT,
  issue_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cleared','void','stopped')),
  payment_id text REFERENCES payments(id) ON DELETE RESTRICT,
  cleared_at timestamptz,
  voided_at timestamptz,
  stopped_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,bank_account_id,cheque_number)
);
CREATE INDEX cheques_org_status_idx ON cheques(organization_id,status,issue_date DESC);

CREATE TABLE inventory_lots (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  lot_number text NOT NULL,
  serial_number text,
  expiry_date date,
  quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  received_at date NOT NULL,
  receipt_movement_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX inventory_lots_identity_uq ON inventory_lots(organization_id,product_id,location_id,lot_number,COALESCE(serial_number,''));
CREATE UNIQUE INDEX inventory_lots_serial_uq ON inventory_lots(organization_id,product_id,serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX inventory_lots_expiry_idx ON inventory_lots(organization_id,expiry_date,product_id) WHERE expiry_date IS NOT NULL;

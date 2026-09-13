CREATE TABLE prn_suppliers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days BETWEEN 0 AND 365),
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_suppliers_org_idx ON prn_suppliers(organization_id,active,name);

CREATE TABLE prn_supplier_catalog (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES prn_suppliers(id) ON DELETE CASCADE,
  consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
  supplier_sku text,
  unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor>=0),
  min_order_qty integer NOT NULL DEFAULT 1 CHECK (min_order_qty>0),
  preferred boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,supplier_id,consumable_id)
);

CREATE TABLE prn_procurement_settings (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  auto_replenishment boolean NOT NULL DEFAULT false,
  auto_submit boolean NOT NULL DEFAULT false,
  default_supplier_id text REFERENCES prn_suppliers(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prn_purchase_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  supplier_id text REFERENCES prn_suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','ordered','partially_received','received','cancelled')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_replenishment')),
  notes text,
  rejection_reason text,
  ordered_reference text,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  approved_by text REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,request_number)
);
CREATE INDEX prn_purchase_requests_org_idx ON prn_purchase_requests(organization_id,status,created_at DESC);

CREATE TABLE prn_purchase_request_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id text NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE,
  consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity>0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity>=0),
  unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor>=0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,request_id,consumable_id)
);

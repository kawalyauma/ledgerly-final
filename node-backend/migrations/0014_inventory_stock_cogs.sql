CREATE TABLE products (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('inventory','service','non_inventory')),
  income_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  expense_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  inventory_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  quantity_on_hand_micros bigint NOT NULL DEFAULT 0 CHECK (quantity_on_hand_micros >= 0),
  average_cost_minor bigint NOT NULL DEFAULT 0 CHECK (average_cost_minor >= 0),
  reorder_point_micros bigint NOT NULL DEFAULT 0 CHECK (reorder_point_micros >= 0),
  sales_price_minor bigint NOT NULL DEFAULT 0 CHECK (sales_price_minor >= 0),
  purchase_price_minor bigint NOT NULL DEFAULT 0 CHECK (purchase_price_minor >= 0),
  unit_of_measure text NOT NULL DEFAULT 'each',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,sku)
);
CREATE INDEX products_org_type_idx ON products (organization_id,type,active,name);

CREATE TABLE inventory_locations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE UNIQUE INDEX inventory_locations_one_default_uq ON inventory_locations (organization_id) WHERE is_default;

CREATE TABLE inventory_balances (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  quantity_micros bigint NOT NULL DEFAULT 0 CHECK (quantity_micros >= 0),
  inventory_value_minor bigint NOT NULL DEFAULT 0 CHECK (inventory_value_minor >= 0),
  reserved_quantity_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_quantity_micros >= 0 AND reserved_quantity_micros <= quantity_micros),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,product_id,location_id)
);
CREATE INDEX inventory_balances_location_idx ON inventory_balances (organization_id,location_id,product_id);

CREATE TABLE inventory_movements (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('opening','receipt','issue','adjustment','sale_return','purchase_return','transfer_out','transfer_in','reversal')),
  movement_date date NOT NULL,
  quantity_delta_micros bigint NOT NULL CHECK (quantity_delta_micros <> 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  value_delta_minor bigint NOT NULL,
  offset_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  transfer_group_id text,
  journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','reversed')),
  reversal_of_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  reversed_by_movement_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,idempotency_key)
);
CREATE INDEX inventory_movements_product_date_idx ON inventory_movements (organization_id,product_id,movement_date,id);
CREATE INDEX inventory_movements_location_date_idx ON inventory_movements (organization_id,location_id,movement_date,id);
CREATE INDEX inventory_movements_source_idx ON inventory_movements (organization_id,source_type,source_id) WHERE source_id IS NOT NULL;
CREATE INDEX inventory_movements_pending_idx ON inventory_movements (organization_id,product_id,location_id,status) WHERE status='pending';

CREATE TABLE inventory_reservations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
  source_type text NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed')),
  expires_at timestamptz,
  created_by text,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,source_type,source_id,product_id,location_id)
);
CREATE INDEX inventory_reservations_active_idx ON inventory_reservations (organization_id,product_id,location_id,status) WHERE status='active';

CREATE TABLE inventory_stock_counts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  count_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  offset_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  notes text,
  created_by text NOT NULL,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX inventory_stock_counts_org_idx ON inventory_stock_counts (organization_id,count_date DESC,status);

CREATE TABLE inventory_stock_count_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stock_count_id text NOT NULL REFERENCES inventory_stock_counts(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  expected_quantity_micros bigint NOT NULL DEFAULT 0 CHECK (expected_quantity_micros >= 0),
  counted_quantity_micros bigint CHECK (counted_quantity_micros IS NULL OR counted_quantity_micros >= 0),
  difference_quantity_micros bigint,
  adjustment_movement_id text REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,stock_count_id,product_id)
);

CREATE OR REPLACE FUNCTION ledgerly_validate_product_accounts() RETURNS trigger AS $$
DECLARE account_org text;
DECLARE account_type text;
BEGIN
  IF NEW.income_account_id IS NOT NULL THEN
    SELECT organization_id,type INTO account_org,account_type FROM accounts WHERE id=NEW.income_account_id;
    IF account_org IS DISTINCT FROM NEW.organization_id OR account_type IS DISTINCT FROM 'revenue' THEN
      RAISE EXCEPTION 'PRODUCT_INCOME_ACCOUNT_INVALID:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.expense_account_id IS NOT NULL THEN
    SELECT organization_id,type INTO account_org,account_type FROM accounts WHERE id=NEW.expense_account_id;
    IF account_org IS DISTINCT FROM NEW.organization_id OR account_type IS DISTINCT FROM 'expense' THEN
      RAISE EXCEPTION 'PRODUCT_EXPENSE_ACCOUNT_INVALID:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.inventory_account_id IS NOT NULL THEN
    SELECT organization_id,type INTO account_org,account_type FROM accounts WHERE id=NEW.inventory_account_id;
    IF account_org IS DISTINCT FROM NEW.organization_id OR account_type IS DISTINCT FROM 'asset' THEN
      RAISE EXCEPTION 'PRODUCT_INVENTORY_ACCOUNT_INVALID:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.type='inventory' AND NEW.inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_INVENTORY_ACCOUNT_REQUIRED:%', NEW.id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_account_guard
BEFORE INSERT OR UPDATE OF organization_id,type,income_account_id,expense_account_id,inventory_account_id ON products
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_product_accounts();

CREATE OR REPLACE FUNCTION ledgerly_validate_inventory_balance_tenant() RETURNS trigger AS $$
DECLARE product_org text;
DECLARE location_org text;
BEGIN
  SELECT organization_id INTO product_org FROM products WHERE id=NEW.product_id;
  SELECT organization_id INTO location_org FROM inventory_locations WHERE id=NEW.location_id;
  IF product_org IS DISTINCT FROM NEW.organization_id OR location_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'INVENTORY_TENANT_MISMATCH:%', NEW.product_id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_balance_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,product_id,location_id ON inventory_balances
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_inventory_balance_tenant();

CREATE OR REPLACE FUNCTION ledgerly_validate_inventory_movement_tenant() RETURNS trigger AS $$
DECLARE product_org text;
DECLARE location_org text;
DECLARE offset_org text;
DECLARE journal_org text;
BEGIN
  SELECT organization_id INTO product_org FROM products WHERE id=NEW.product_id;
  SELECT organization_id INTO location_org FROM inventory_locations WHERE id=NEW.location_id;
  IF product_org IS DISTINCT FROM NEW.organization_id OR location_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
  END IF;
  IF NEW.offset_account_id IS NOT NULL THEN
    SELECT organization_id INTO offset_org FROM accounts WHERE id=NEW.offset_account_id;
    IF offset_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'INVENTORY_OFFSET_ACCOUNT_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.journal_entry_id IS NOT NULL THEN
    SELECT organization_id INTO journal_org FROM journal_entries WHERE id=NEW.journal_entry_id;
    IF journal_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'INVENTORY_JOURNAL_TENANT_MISMATCH:%', NEW.id USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_movement_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id,product_id,location_id,offset_account_id,journal_entry_id ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_inventory_movement_tenant();

CREATE OR REPLACE FUNCTION ledgerly_refresh_product_inventory_totals() RETURNS trigger AS $$
DECLARE target_org text;
DECLARE target_product text;
BEGIN
  target_org := COALESCE(NEW.organization_id,OLD.organization_id);
  target_product := COALESCE(NEW.product_id,OLD.product_id);
  UPDATE products p SET
    quantity_on_hand_micros = COALESCE((SELECT SUM(b.quantity_micros) FROM inventory_balances b WHERE b.organization_id=target_org AND b.product_id=target_product),0),
    average_cost_minor = CASE
      WHEN COALESCE((SELECT SUM(b.quantity_micros) FROM inventory_balances b WHERE b.organization_id=target_org AND b.product_id=target_product),0)=0 THEN 0
      ELSE ROUND(COALESCE((SELECT SUM(b.inventory_value_minor) FROM inventory_balances b WHERE b.organization_id=target_org AND b.product_id=target_product),0)*1000000.0/
                 NULLIF((SELECT SUM(b.quantity_micros) FROM inventory_balances b WHERE b.organization_id=target_org AND b.product_id=target_product),0))::bigint
    END,
    updated_at=CURRENT_TIMESTAMP
  WHERE p.id=target_product AND p.organization_id=target_org;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_balance_product_totals
AFTER INSERT OR UPDATE OR DELETE ON inventory_balances
FOR EACH ROW EXECUTE FUNCTION ledgerly_refresh_product_inventory_totals();

CREATE OR REPLACE FUNCTION ledgerly_refresh_inventory_reserved_quantity() RETURNS trigger AS $$
DECLARE target_org text;
DECLARE target_product text;
DECLARE target_location text;
DECLARE total_reserved bigint;
DECLARE on_hand bigint;
BEGIN
  target_org := COALESCE(NEW.organization_id,OLD.organization_id);
  target_product := COALESCE(NEW.product_id,OLD.product_id);
  target_location := COALESCE(NEW.location_id,OLD.location_id);
  SELECT COALESCE(SUM(quantity_micros),0) INTO total_reserved FROM inventory_reservations
   WHERE organization_id=target_org AND product_id=target_product AND location_id=target_location AND status='active';
  SELECT quantity_micros INTO on_hand FROM inventory_balances
   WHERE organization_id=target_org AND product_id=target_product AND location_id=target_location;
  IF on_hand IS NULL AND total_reserved > 0 THEN
    RAISE EXCEPTION 'INVENTORY_RESERVATION_WITHOUT_STOCK:%', target_product USING ERRCODE='P0001';
  END IF;
  IF total_reserved > COALESCE(on_hand,0) THEN
    RAISE EXCEPTION 'INVENTORY_OVER_RESERVED:%', target_product USING ERRCODE='P0001';
  END IF;
  UPDATE inventory_balances SET reserved_quantity_micros=total_reserved,updated_at=CURRENT_TIMESTAMP
   WHERE organization_id=target_org AND product_id=target_product AND location_id=target_location;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_reservation_balance_sync
AFTER INSERT OR UPDATE OR DELETE ON inventory_reservations
FOR EACH ROW EXECUTE FUNCTION ledgerly_refresh_inventory_reserved_quantity();

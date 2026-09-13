CREATE TABLE prn_consumables (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
 type text NOT NULL CHECK(type IN ('toner','ink','drum','paper','waste','other')),
 name text NOT NULL, sku text, marker_name text, color text, unit text NOT NULL DEFAULT 'unit',
 on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand>=0), reorder_level integer NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
 target_stock integer NOT NULL DEFAULT 0 CHECK(target_stock>=0), unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0),
 currency text NOT NULL DEFAULT 'UGX', marker_low_percent integer NOT NULL DEFAULT 15 CHECK(marker_low_percent BETWEEN 1 AND 99),
 last_marker_percent numeric(5,2), last_marker_at timestamptz, active boolean NOT NULL DEFAULT true,
 created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_consumables_org_idx ON prn_consumables(organization_id,active,type,name);
CREATE TABLE prn_consumable_movements (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
 movement_type text NOT NULL CHECK(movement_type IN ('opening','restock','usage','adjustment','writeoff')),
 quantity_delta integer NOT NULL, balance_after integer NOT NULL CHECK(balance_after>=0), unit_cost_minor bigint NOT NULL DEFAULT 0,
 reference text, notes text, actor_id text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_consumable_movements_idx ON prn_consumable_movements(organization_id,consumable_id,created_at DESC);
CREATE TABLE prn_maintenance_profiles (
 organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
 service_interval_impressions bigint NOT NULL DEFAULT 0, service_interval_days integer NOT NULL DEFAULT 0,
 warning_impressions bigint NOT NULL DEFAULT 0, warning_days integer NOT NULL DEFAULT 14,
 last_service_at timestamptz, last_service_impressions bigint NOT NULL DEFAULT 0, next_due_at timestamptz,
 updated_by text REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(organization_id,printer_id)
);
CREATE TABLE prn_maintenance_events (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
 event_type text NOT NULL CHECK(event_type IN ('service','repair','cleaning','inspection','parts')),
 notes text, technician text, cost_minor bigint NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'UGX',
 impressions_at_event bigint NOT NULL DEFAULT 0, performed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_maintenance_events_idx ON prn_maintenance_events(organization_id,printer_id,performed_at DESC);

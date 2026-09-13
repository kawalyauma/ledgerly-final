ALTER TABLE prn_retention_policies ADD COLUMN IF NOT EXISTS scan_inbox_days integer NOT NULL DEFAULT 30 CHECK (scan_inbox_days BETWEEN 0 AND 3650);
ALTER TABLE prn_retention_policies ADD COLUMN IF NOT EXISTS scan_routed_days integer NOT NULL DEFAULT 7 CHECK (scan_routed_days BETWEEN 0 AND 3650);
ALTER TABLE prn_retention_holds DROP CONSTRAINT IF EXISTS prn_retention_holds_entity_type_check;
ALTER TABLE prn_retention_holds ADD CONSTRAINT prn_retention_holds_entity_type_check CHECK (entity_type IN ('print_job','print_document','scan_job','scan_document'));
ALTER TABLE prn_scan_documents ADD COLUMN IF NOT EXISTS routed_at timestamptz;
ALTER TABLE prn_scan_documents ADD COLUMN IF NOT EXISTS route_status text NOT NULL DEFAULT 'pending' CHECK (route_status IN ('pending','routed','failed'));
ALTER TABLE prn_scan_documents ADD COLUMN IF NOT EXISTS route_error text;
CREATE INDEX IF NOT EXISTS prn_scan_documents_retention_idx ON prn_scan_documents(organization_id,retention_purged_at,created_at);

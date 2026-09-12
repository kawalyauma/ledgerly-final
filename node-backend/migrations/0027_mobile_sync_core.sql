CREATE TABLE mobile_sync_devices (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  device_name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android','ios')),
  app_version text NOT NULL,
  client_schema_version integer NOT NULL CHECK (client_schema_version > 0),
  device_model text,
  os_version text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_push_sequence bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,user_id,installation_id)
);
CREATE INDEX mobile_sync_devices_org_user_idx ON mobile_sync_devices(organization_id,user_id,status,last_seen_at DESC);

CREATE TABLE mobile_offline_grants (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mobile_offline_grants_device_active_idx ON mobile_offline_grants(device_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE mobile_sync_device_schemas (
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  acknowledged_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id,module_key,collection_key)
);

CREATE TABLE mobile_sync_record_versions (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted boolean NOT NULL DEFAULT false,
  server_updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_device_id text,
  PRIMARY KEY (organization_id,module_key,collection_key,record_id)
);
CREATE INDEX mobile_sync_record_versions_collection_idx ON mobile_sync_record_versions(organization_id,module_key,collection_key,deleted,server_updated_at);

CREATE TABLE mobile_sync_changes (
  change_id bigserial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','delete')),
  payload_json jsonb,
  changed_by text,
  device_id text,
  changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mobile_sync_changes_pull_idx ON mobile_sync_changes(organization_id,module_key,collection_key,change_id);

CREATE TABLE mobile_sync_tombstones (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  device_id text,
  PRIMARY KEY (organization_id,module_key,collection_key,record_id)
);

CREATE TABLE mobile_sync_bootstraps (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged')),
  watermarks_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  collection_count integer NOT NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mobile_sync_pull_state (
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  last_acked_change_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id,module_key,collection_key)
);

CREATE TABLE mobile_sync_pull_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  from_change_id bigint NOT NULL,
  to_change_id bigint NOT NULL,
  payload_count integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged')),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id,request_id,module_key,collection_key)
);
CREATE INDEX mobile_sync_pull_deliveries_pending_idx ON mobile_sync_pull_deliveries(device_id,status,created_at);

CREATE TABLE mobile_sync_batches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  batch_uuid text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  first_sequence bigint,
  last_sequence bigint,
  operation_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id,batch_uuid)
);

CREATE TABLE mobile_sync_operations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  batch_id text NOT NULL REFERENCES mobile_sync_batches(id) ON DELETE CASCADE,
  operation_uuid text NOT NULL,
  sequence_number bigint NOT NULL,
  module_key text NOT NULL,
  collection_key text NOT NULL,
  record_id text NOT NULL,
  mutation_kind text NOT NULL CHECK (mutation_kind IN ('upsert','delete')),
  schema_version integer NOT NULL,
  base_version bigint NOT NULL DEFAULT 0,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','blocked','applied','duplicate','conflict','rejected')),
  retryable boolean NOT NULL DEFAULT false,
  server_version bigint,
  result_json jsonb,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id,operation_uuid),
  UNIQUE (device_id,sequence_number)
);
CREATE INDEX mobile_sync_operations_batch_idx ON mobile_sync_operations(batch_id,sequence_number);

CREATE TABLE mobile_sync_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  user_id text,
  event_type text NOT NULL,
  batch_id text,
  operation_id text,
  details_json jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mobile_sync_events_device_idx ON mobile_sync_events(organization_id,device_id,created_at DESC);

CREATE OR REPLACE FUNCTION ledgerly_track_mobile_sync_row() RETURNS trigger AS $$
DECLARE org_id text;
DECLARE record_key text;
DECLARE next_version bigint;
DECLARE operation_name text;
BEGIN
  IF TG_OP='DELETE' THEN
    org_id := to_jsonb(OLD)->>'organization_id';
    record_key := to_jsonb(OLD)->>'id';
    operation_name := 'delete';
  ELSE
    org_id := to_jsonb(NEW)->>'organization_id';
    record_key := to_jsonb(NEW)->>'id';
    operation_name := 'upsert';
  END IF;
  IF org_id IS NULL OR record_key IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at)
    VALUES(org_id,TG_ARGV[0],TG_ARGV[1],record_key,1,TG_OP='DELETE',CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET
      version=mobile_sync_record_versions.version+1,deleted=(TG_OP='DELETE'),server_updated_at=CURRENT_TIMESTAMP
    RETURNING version INTO next_version;
  IF TG_OP='DELETE' THEN
    INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at)
      VALUES(org_id,TG_ARGV[0],TG_ARGV[1],record_key,next_version,CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=EXCLUDED.version,deleted_at=CURRENT_TIMESTAMP;
  ELSE
    DELETE FROM mobile_sync_tombstones WHERE organization_id=org_id AND module_key=TG_ARGV[0] AND collection_key=TG_ARGV[1] AND record_id=record_key;
  END IF;
  INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,changed_at)
    VALUES(org_id,TG_ARGV[0],TG_ARGV[1],record_key,next_version,operation_name,CURRENT_TIMESTAMP);
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_track_accounts AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','accounts');
CREATE TRIGGER mobile_track_dimensions AFTER INSERT OR UPDATE OR DELETE ON dimensions FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','dimensions');
CREATE TRIGGER mobile_track_products AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','products');
CREATE TRIGGER mobile_track_projects AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','projects');
CREATE TRIGGER mobile_track_periods AFTER INSERT OR UPDATE OR DELETE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','fiscal-periods');
CREATE TRIGGER mobile_track_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','bank-accounts');
CREATE TRIGGER mobile_track_documents AFTER INSERT OR UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','documents');
CREATE TRIGGER mobile_track_document_lines AFTER INSERT OR UPDATE OR DELETE ON document_lines FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','document-lines');
CREATE TRIGGER mobile_track_journals AFTER INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','journals');
CREATE TRIGGER mobile_track_journal_lines AFTER INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','journal-lines');
CREATE TRIGGER mobile_track_document_intents AFTER INSERT OR UPDATE OR DELETE ON ledgerly_mobile_document_intents FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','document-intents');
CREATE TRIGGER mobile_track_journal_intents AFTER INSERT OR UPDATE OR DELETE ON ledgerly_mobile_journal_intents FOR EACH ROW EXECUTE FUNCTION ledgerly_track_mobile_sync_row('ledgerly-core','journal-intents');

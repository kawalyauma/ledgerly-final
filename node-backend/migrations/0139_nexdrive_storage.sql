-- Files kept in NexDrive (STORAGE_DRIVER=nexdrive). NexDrive addresses files by node id, so Ledgerly keeps
-- the storage key -> node id map here. Folders mirror the key path so the drive stays browsable.
CREATE TABLE IF NOT EXISTS storage_nexdrive_objects (
  object_key TEXT PRIMARY KEY,
  node_id UUID NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  content_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS storage_nexdrive_folders (
  path TEXT PRIMARY KEY,
  node_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

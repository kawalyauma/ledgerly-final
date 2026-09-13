ALTER TABLE nvr_recordings ADD COLUMN IF NOT EXISTS upload_state text NOT NULL DEFAULT 'single' CHECK (upload_state IN ('single','chunked'));
ALTER TABLE nvr_recordings ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count>=0);
ALTER TABLE nvr_recordings ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE nvr_recordings ADD COLUMN IF NOT EXISTS purge_reason text;

CREATE TABLE nvr_recording_chunks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recording_id text NOT NULL REFERENCES nvr_recordings(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index>=0),
  object_key text NOT NULL,
  mime_type text NOT NULL DEFAULT 'video/mp4',
  size_bytes bigint NOT NULL CHECK (size_bytes>0),
  checksum_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,recording_id,chunk_index),
  UNIQUE(organization_id,object_key)
);
CREATE INDEX nvr_recording_chunks_recording_idx ON nvr_recording_chunks(organization_id,recording_id,chunk_index);

CREATE TABLE nvr_retention_policies (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  recording_days integer NOT NULL DEFAULT 14 CHECK (recording_days BETWEEN 0 AND 3650),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE lai_memories
  ADD COLUMN IF NOT EXISTS memory_kind TEXT NOT NULL DEFAULT 'fact',
  ADD COLUMN IF NOT EXISTS required_scope TEXT,
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS correction_of_id TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

DO $$ BEGIN
  ALTER TABLE lai_memories
    ADD CONSTRAINT lai_memories_kind_check
    CHECK (memory_kind IN ('fact','preference','instruction','task','summary','observation','operational'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lai_memory_expiry
  ON lai_memories(organization_id,status,expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lai_memory_kind
  ON lai_memories(organization_id,memory_kind,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lai_memory_search
  ON lai_memories
  USING GIN (to_tsvector('simple', COALESCE(title,'') || ' ' || content));

CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_memory_conversation_turn
  ON lai_memories(organization_id,scope_type,scope_id,source_type,source_id)
  WHERE source_type='conversation_turn' AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lai_memory_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  memory_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'created','updated','corrected','expired','deleted','retrieved','restored'
  )),
  scope_type TEXT,
  scope_id TEXT,
  correlation_id TEXT,
  reason TEXT,
  before_json JSONB,
  after_json JSONB,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lai_memory_audit_org_recent
  ON lai_memory_audit(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_memory_audit_memory
  ON lai_memory_audit(organization_id,memory_id,created_at DESC);

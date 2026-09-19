CREATE TABLE IF NOT EXISTS lai_custom_agent_shares (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user','role','department','organization')),
  subject_id TEXT NOT NULL DEFAULT '',
  can_manage BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(
    (subject_type='organization' AND subject_id='')
    OR (subject_type<>'organization' AND subject_id<>'')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_custom_agent_share_unique
  ON lai_custom_agent_shares(organization_id,agent_id,subject_type,subject_id);
CREATE INDEX IF NOT EXISTS idx_lai_custom_agent_share_subject
  ON lai_custom_agent_shares(organization_id,subject_type,subject_id,agent_id);

CREATE TABLE IF NOT EXISTS lai_custom_agent_triggers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('schedule','event')),
  label TEXT NOT NULL,
  cron_expression TEXT,
  event_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_fire_key TEXT,
  last_fired_at TIMESTAMPTZ,
  validation_error TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(
    (trigger_type='schedule' AND event_key IS NULL AND (cron_expression IS NOT NULL OR validation_error IS NOT NULL))
    OR (trigger_type='event' AND cron_expression IS NULL AND (event_key IS NOT NULL OR validation_error IS NOT NULL))
  )
);
CREATE INDEX IF NOT EXISTS idx_lai_custom_agent_triggers_enabled
  ON lai_custom_agent_triggers(organization_id,trigger_type,enabled,agent_id);

CREATE TABLE IF NOT EXISTS lai_custom_agent_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_custom_agent_event_dedupe
  ON lai_custom_agent_events(organization_id,event_key,source_module,source_record_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_lai_custom_agent_events_recent
  ON lai_custom_agent_events(organization_id,event_key,occurred_at DESC);

CREATE TABLE IF NOT EXISTS lai_custom_agent_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  trigger_id TEXT,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','schedule','event')),
  dedupe_key TEXT,
  requested_by TEXT NOT NULL,
  chat_id TEXT,
  job_id TEXT,
  dispatched_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','waiting_approval','completed','failed','cancelled')),
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  error_text TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lai_custom_agent_runs_dedupe
  ON lai_custom_agent_runs(organization_id,dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lai_custom_agent_runs_agent
  ON lai_custom_agent_runs(organization_id,agent_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lai_custom_agent_runs_status
  ON lai_custom_agent_runs(organization_id,status,created_at);

INSERT INTO lai_custom_agent_shares(
  id,organization_id,agent_id,subject_type,subject_id,can_manage,created_by
)
SELECT
  'laish_' || replace(gen_random_uuid()::text,'-',''),
  a.organization_id,a.id,'user',a.created_by,TRUE,a.created_by
FROM lai_agents a
WHERE a.kind='custom' AND a.created_by IS NOT NULL
ON CONFLICT(organization_id,agent_id,subject_type,subject_id) DO NOTHING;

-- "manual" provider: Ledgerly writes each AI prompt to lrn_manual_calls and waits; an operator (or an outside model) stores the reply.
ALTER TABLE lrn_engine_settings DROP CONSTRAINT IF EXISTS lrn_engine_settings_provider_check;
ALTER TABLE lrn_engine_settings ADD CONSTRAINT lrn_engine_settings_provider_check CHECK (provider = ANY (ARRAY['codex','claude-code','manual']));
CREATE TABLE IF NOT EXISTS lrn_manual_calls(
  task_id text NOT NULL,
  call_index integer NOT NULL,
  organization_id text NOT NULL,
  kind text NOT NULL,
  subject_ref text NOT NULL,
  prompt text NOT NULL,
  reply text,
  error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at timestamptz,
  PRIMARY KEY(task_id, call_index)
);
CREATE INDEX IF NOT EXISTS lrn_manual_calls_waiting ON lrn_manual_calls(created_at) WHERE reply IS NULL;

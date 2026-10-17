-- "git" provider: like "manual", but prompts are published as jobs in the Ledgerly Resources Bank repo
-- (github.com/kawalyauma/ledgerly-resources-bank) and answers are pulled back from it by the git desk.
ALTER TABLE lrn_engine_settings DROP CONSTRAINT IF EXISTS lrn_engine_settings_provider_check;
ALTER TABLE lrn_engine_settings ADD CONSTRAINT lrn_engine_settings_provider_check CHECK (provider = ANY (ARRAY['codex','claude-code','manual','git']));
ALTER TABLE lrn_manual_calls
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS job jsonb,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS exported_attempt integer,
  ADD COLUMN IF NOT EXISTS exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent text,
  ADD COLUMN IF NOT EXISTS problems jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE lrn_manual_calls DROP CONSTRAINT IF EXISTS lrn_manual_calls_channel_check;
ALTER TABLE lrn_manual_calls ADD CONSTRAINT lrn_manual_calls_channel_check CHECK (channel IN ('manual','git'));
CREATE INDEX IF NOT EXISTS lrn_manual_calls_git_open ON lrn_manual_calls(created_at) WHERE channel='git' AND closed_at IS NULL;
-- Which pack revision of each scheme is in the repo, so packs are only rewritten when their sources change.
CREATE TABLE IF NOT EXISTS lrn_git_packs(
  scheme_id text PRIMARY KEY,
  organization_id text NOT NULL,
  path text NOT NULL,
  fingerprint text NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

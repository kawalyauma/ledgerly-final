-- Per-school AI provider configuration for Agentic Employees.
-- API keys are encrypted by the application before they are persisted.
CREATE TABLE IF NOT EXISTS ae_ai_provider_settings (
  organization_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai'
    CHECK (provider IN ('openai', 'google', 'anthropic')),
  models_json TEXT NOT NULL DEFAULT '{}',
  api_key_ciphertext TEXT,
  api_key_hint TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ae_ai_provider_settings_provider
  ON ae_ai_provider_settings(provider);

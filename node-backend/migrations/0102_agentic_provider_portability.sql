ALTER TABLE ae_ai_provider_settings DROP CONSTRAINT IF EXISTS ae_ai_provider_settings_provider_check;
ALTER TABLE ae_ai_provider_settings ADD CONSTRAINT ae_ai_provider_settings_provider_check
  CHECK (provider IN ('openai', 'groq', 'google', 'anthropic', 'cloudflare', 'openrouter', 'ollama', 'custom'));

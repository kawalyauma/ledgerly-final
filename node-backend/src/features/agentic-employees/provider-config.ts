import { AppError } from "./shared.js";
import type { Env } from "./shared.js";
import type { ModelTier } from "./policy.js";

export type AiProviderId = "openai" | "google" | "anthropic" | "cloudflare";
export type ReasoningEffort = "default" | "low" | "medium" | "high" | "max";
export type TierModels = Record<ModelTier, string>;
export type AdvancedAiConfig = {
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort;
  /** Cloudflare account ID. Only meaningful when provider is "cloudflare": the
   * Workers AI OpenAI-compatible endpoint is scoped per account
   * (https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1). */
  accountId: string | null;
};

type AiEnv = Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };
type ProviderRow = {
  organizationId: string;
  provider: AiProviderId;
  modelsJson: string;
  apiKeyCiphertext: string | null;
  apiKeyHint: string | null;
  configJson: string;
  updatedAt: string;
};

export const AI_PROVIDER_CATALOG = {
  openai: {
    id: "openai" as const,
    label: "OpenAI / ChatGPT",
    description: "OpenAI models using the Responses API.",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra", tier: "sol" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", tier: "sol" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", tier: "terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", tier: "luna" },
    ],
    defaults: { luna: "gpt-5.6-luna", terra: "gpt-5.6-terra", sol: "gpt-5.6-sol" },
  },
  google: {
    id: "google" as const,
    label: "Google Gemini",
    description: "Gemini models through Google's OpenAI-compatible endpoint.",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", tier: "terra" },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", tier: "terra" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", tier: "terra" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", tier: "luna" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", tier: "sol" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "sol" },
    ],
    defaults: { luna: "gemini-3.5-flash-lite", terra: "gemini-3.8-flash", sol: "gemini-3.1-pro-preview" },
  },
  anthropic: {
    id: "anthropic" as const,
    label: "Anthropic Claude",
    description: "Claude models using Anthropic's native Messages API.",
    models: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", tier: "sol" },
      { id: "claude-opus-5", label: "Claude Opus 5", tier: "sol" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", tier: "terra" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "luna" },
    ],
    defaults: { luna: "claude-haiku-4-5-20251001", terra: "claude-sonnet-5", sol: "claude-opus-5" },
  },
  cloudflare: {
    id: "cloudflare" as const,
    label: "Cloudflare Workers AI",
    description: "Models hosted on Cloudflare's Workers AI, through its OpenAI-compatible endpoint. Requires this school's Cloudflare account ID.",
    // Not every Workers AI model supports OpenAI-style tool/function calling;
    // picking one that doesn't causes 400s from Cloudflare once tools are sent.
    // These are confirmed to support function calling.
    models: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B (fp8 fast)", tier: "sol" },
      { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", tier: "sol" },
      { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B", tier: "terra" },
      { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", tier: "terra" },
      { id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B", tier: "luna" },
    ],
    defaults: { luna: "@cf/openai/gpt-oss-20b", terra: "@cf/mistralai/mistral-small-3.1-24b-instruct", sol: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  },
} as const;

export const DEFAULT_ADVANCED_CONFIG: AdvancedAiConfig = {
  temperature: null,
  topP: null,
  maxOutputTokens: 4096,
  timeoutMs: 60000,
  reasoningEffort: "default",
  accountId: null,
};

function isProvider(value: unknown): value is AiProviderId {
  return value === "openai" || value === "google" || value === "anthropic" || value === "cloudflare";
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizeModelId(value: unknown, fallback: string) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model) return fallback;
  if (model.length > 160 || !/^[A-Za-z0-9._:/@-]+$/.test(model)) {
    throw new AppError(422, "VALIDATION_ERROR", "Model IDs may only contain letters, numbers, dot, underscore, colon, slash, at-sign and hyphen.");
  }
  return model;
}

export function normalizeModels(provider: AiProviderId, input?: Partial<TierModels> | null): TierModels {
  const defaults = AI_PROVIDER_CATALOG[provider].defaults;
  return {
    luna: normalizeModelId(input?.luna, defaults.luna),
    terra: normalizeModelId(input?.terra, defaults.terra),
    sol: normalizeModelId(input?.sol, defaults.sol),
  };
}

function nullableNumber(value: unknown, name: string, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new AppError(422, "VALIDATION_ERROR", `${name} must be between ${min} and ${max}.`);
  return number;
}

function requiredNumber(value: unknown, fallback: number, name: string, min: number, max: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new AppError(422, "VALIDATION_ERROR", `${name} must be between ${min} and ${max}.`);
  return Math.round(number);
}

function normalizeAccountId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const id = String(value).trim();
  if (id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new AppError(422, "VALIDATION_ERROR", "Cloudflare account ID looks invalid.");
  return id;
}

export function normalizeAdvancedConfig(input?: Partial<AdvancedAiConfig> | null): AdvancedAiConfig {
  const reasoning = input?.reasoningEffort ?? DEFAULT_ADVANCED_CONFIG.reasoningEffort;
  if (!["default", "low", "medium", "high", "max"].includes(reasoning)) throw new AppError(422, "VALIDATION_ERROR", "Invalid reasoning effort.");
  return {
    temperature: nullableNumber(input?.temperature, "Temperature", 0, 2),
    topP: nullableNumber(input?.topP, "Top P", 0, 1),
    maxOutputTokens: requiredNumber(input?.maxOutputTokens, DEFAULT_ADVANCED_CONFIG.maxOutputTokens, "Maximum output tokens", 128, 65536),
    timeoutMs: requiredNumber(input?.timeoutMs, DEFAULT_ADVANCED_CONFIG.timeoutMs, "Request timeout", 5000, 120000),
    reasoningEffort: reasoning as ReasoningEffort,
    accountId: normalizeAccountId(input?.accountId),
  };
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptApiKey(secret: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(plaintext));
  return `v1.${base64Encode(iv)}.${base64Encode(new Uint8Array(encrypted))}`;
}

async function decryptApiKey(secret: string, ciphertext: string) {
  const [version, ivText, encryptedText] = ciphertext.split(".");
  if (version !== "v1" || !ivText || !encryptedText) throw new AppError(500, "AI_SECRET_INVALID", "Stored AI provider credentials are invalid.");
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Decode(ivText) }, await encryptionKey(secret), base64Decode(encryptedText));
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new AppError(503, "AI_SECRET_UNAVAILABLE", "AI provider credentials cannot be decrypted. Check AI_PROVIDER_ENCRYPTION_KEY on the server.");
  }
}

async function loadRow(db: D1Database, organizationId: string) {
  return db.prepare(`SELECT organization_id AS organizationId, provider, models_json AS modelsJson,
    api_key_ciphertext AS apiKeyCiphertext, api_key_hint AS apiKeyHint, config_json AS configJson,
    updated_at AS updatedAt FROM ae_ai_provider_settings WHERE organization_id=?`)
    .bind(organizationId).first<ProviderRow>();
}

export async function getProviderSettings(db: D1Database, env: AiEnv, organizationId: string) {
  const row = await loadRow(db, organizationId);
  if (!row) {
    const provider: AiProviderId = "openai";
    const models = normalizeModels(provider, {
      luna: env.OPENAI_MODEL_LUNA || AI_PROVIDER_CATALOG.openai.defaults.luna,
      terra: env.OPENAI_MODEL_TERRA || AI_PROVIDER_CATALOG.openai.defaults.terra,
      sol: env.OPENAI_MODEL_SOL || AI_PROVIDER_CATALOG.openai.defaults.sol,
    });
    return {
      provider,
      source: "environment-default" as const,
      configured: Boolean(env.OPENAI_API_KEY),
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      apiKeyHint: env.OPENAI_API_KEY ? "Environment secret" : null,
      models,
      config: DEFAULT_ADVANCED_CONFIG,
      updatedAt: null,
    };
  }
  const provider = isProvider(row.provider) ? row.provider : "openai";
  const models = normalizeModels(provider, safeJson<Partial<TierModels>>(row.modelsJson, {}));
  const config = normalizeAdvancedConfig(safeJson<Partial<AdvancedAiConfig>>(row.configJson, {}));
  const environmentFallback = provider === "openai" && Boolean(env.OPENAI_API_KEY);
  return {
    provider,
    source: "school" as const,
    configured: Boolean(row.apiKeyCiphertext) || environmentFallback,
    apiKeyConfigured: Boolean(row.apiKeyCiphertext) || environmentFallback,
    apiKeyHint: row.apiKeyHint || (environmentFallback ? "Environment secret" : null),
    models,
    config,
    updatedAt: row.updatedAt,
  };
}

export async function saveProviderSettings(db: D1Database, env: AiEnv, organizationId: string, userId: string, input: {
  provider: AiProviderId;
  models?: Partial<TierModels>;
  apiKey?: string | null;
  clearApiKey?: boolean;
  config?: Partial<AdvancedAiConfig>;
}) {
  if (!isProvider(input.provider)) throw new AppError(422, "VALIDATION_ERROR", "Choose OpenAI, Google Gemini, Anthropic Claude or Cloudflare Workers AI.");
  const current = await loadRow(db, organizationId);
  const models = normalizeModels(input.provider, input.models);
  const config = normalizeAdvancedConfig(input.config);
  if (input.provider === "cloudflare" && !config.accountId) throw new AppError(422, "VALIDATION_ERROR", "A Cloudflare account ID is required for Cloudflare Workers AI.");
  let ciphertext = current?.apiKeyCiphertext ?? null;
  let hint = current?.apiKeyHint ?? null;
  if (input.clearApiKey) {
    ciphertext = null;
    hint = null;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const key = input.apiKey.trim();
    if (key.length < 12 || key.length > 512) throw new AppError(422, "VALIDATION_ERROR", "The API key format is invalid.");
    if (!env.AI_PROVIDER_ENCRYPTION_KEY || env.AI_PROVIDER_ENCRYPTION_KEY.length < 24) {
      throw new AppError(503, "AI_ENCRYPTION_NOT_CONFIGURED", "Set AI_PROVIDER_ENCRYPTION_KEY on the Ledgerly server before schools save AI API keys.");
    }
    ciphertext = await encryptApiKey(env.AI_PROVIDER_ENCRYPTION_KEY, key);
    hint = `••••${key.slice(-4)}`;
  }
  await db.prepare(`INSERT INTO ae_ai_provider_settings
      (organization_id, provider, models_json, api_key_ciphertext, api_key_hint, config_json, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET provider=excluded.provider, models_json=excluded.models_json,
        api_key_ciphertext=excluded.api_key_ciphertext, api_key_hint=excluded.api_key_hint,
        config_json=excluded.config_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
    .bind(organizationId, input.provider, JSON.stringify(models), ciphertext, hint, JSON.stringify(config), userId).run();
  return getProviderSettings(db, env, organizationId);
}

export async function resolveRuntimeProvider(db: D1Database, env: AiEnv, organizationId: string, tier: ModelTier) {
  const row = await loadRow(db, organizationId);
  if (!row) {
    if (!env.OPENAI_API_KEY) throw new AppError(503, "AI_NOT_CONFIGURED", "AI is not configured for this school. Add an API key in AI Workforce → AI Provider Configuration.");
    const models = normalizeModels("openai", { luna: env.OPENAI_MODEL_LUNA, terra: env.OPENAI_MODEL_TERRA, sol: env.OPENAI_MODEL_SOL });
    return { provider: "openai" as const, apiKey: env.OPENAI_API_KEY, model: models[tier], config: DEFAULT_ADVANCED_CONFIG, baseUrl: String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") };
  }
  const provider = isProvider(row.provider) ? row.provider : "openai";
  const models = normalizeModels(provider, safeJson<Partial<TierModels>>(row.modelsJson, {}));
  const config = normalizeAdvancedConfig(safeJson<Partial<AdvancedAiConfig>>(row.configJson, {}));
  let apiKey: string | undefined;
  if (row.apiKeyCiphertext) {
    if (!env.AI_PROVIDER_ENCRYPTION_KEY) throw new AppError(503, "AI_SECRET_UNAVAILABLE", "AI provider encryption key is missing on the server.");
    apiKey = await decryptApiKey(env.AI_PROVIDER_ENCRYPTION_KEY, row.apiKeyCiphertext);
  } else if (provider === "openai") apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError(503, "AI_NOT_CONFIGURED", `No API key has been saved for ${AI_PROVIDER_CATALOG[provider].label}.`);
  if (provider === "cloudflare" && !config.accountId) throw new AppError(503, "AI_NOT_CONFIGURED", "No Cloudflare account ID has been saved for this school.");
  const baseUrl = provider === "openai" ? String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
    : provider === "google" ? "https://generativelanguage.googleapis.com/v1beta/openai"
    : provider === "cloudflare" ? `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`
    : "https://api.anthropic.com/v1";
  return { provider, apiKey, model: models[tier], config, baseUrl };
}

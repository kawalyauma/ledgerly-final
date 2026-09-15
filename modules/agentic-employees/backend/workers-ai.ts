import { AppError } from "../../../src/lib/errors";
import type { Env } from "../../../src/types";

export const DEFAULT_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

export type WorkersAiImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
  name?: string;
};

type AiEnv = Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };
type Row = {
  organizationId: string;
  accountId: string;
  apiTokenCiphertext: string | null;
  apiTokenHint: string | null;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  updatedAt: string;
};

type ChatResponse = {
  id?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

function b64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  }
  return btoa(out);
}

function b64decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function cryptoKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(secret: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(secret),
    new TextEncoder().encode(plaintext),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}

async function decrypt(secret: string, ciphertext: string) {
  const [version, ivText, encryptedText] = ciphertext.split(".");
  if (version !== "v1" || !ivText || !encryptedText) throw new AppError(500, "AI_SECRET_INVALID", "Stored Workers AI credentials are invalid.");
  try {
    const value = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(ivText) },
      await cryptoKey(secret),
      b64decode(encryptedText),
    );
    return new TextDecoder().decode(value);
  } catch {
    throw new AppError(503, "AI_SECRET_UNAVAILABLE", "Workers AI credentials cannot be decrypted. Check AI_PROVIDER_ENCRYPTION_KEY.");
  }
}

async function loadRow(db: D1Database, organizationId: string) {
  return db.prepare(`SELECT organization_id AS organizationId,account_id AS accountId,
    api_token_ciphertext AS apiTokenCiphertext,api_token_hint AS apiTokenHint,model,
    max_output_tokens AS maxOutputTokens,timeout_ms AS timeoutMs,updated_at AS updatedAt
    FROM ae_workers_ai_settings WHERE organization_id=?`)
    .bind(organizationId).first<Row>();
}

function normalizeModel(value: unknown) {
  const model = String(value || DEFAULT_WORKERS_AI_MODEL).trim();
  if (!model.startsWith("@cf/") || model.length > 180 || !/^@cf\/[A-Za-z0-9._/-]+$/.test(model)) {
    throw new AppError(422, "VALIDATION_ERROR", "Workers AI model must be a valid @cf/... model ID.");
  }
  return model;
}

export function workersModelSupportsVision(model: string) {
  const known = new Set([
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/meta/llama-3.2-11b-vision-instruct",
    "@cf/meta/llama-4-scout-17b-16e-instruct",
  ]);
  return known.has(model);
}

export async function getWorkersAiSettings(db: D1Database, organizationId: string) {
  const row = await loadRow(db, organizationId);
  if (!row) {
    return {
      configured: false,
      accountId: "",
      apiTokenConfigured: false,
      apiTokenHint: null,
      model: DEFAULT_WORKERS_AI_MODEL,
      visionCapable: true,
      maxOutputTokens: 768,
      timeoutMs: 30000,
      alwaysOn: true,
      updatedAt: null,
    };
  }
  return {
    configured: Boolean(row.accountId && row.apiTokenCiphertext),
    accountId: row.accountId,
    apiTokenConfigured: Boolean(row.apiTokenCiphertext),
    apiTokenHint: row.apiTokenHint,
    model: row.model || DEFAULT_WORKERS_AI_MODEL,
    visionCapable: workersModelSupportsVision(row.model || DEFAULT_WORKERS_AI_MODEL),
    maxOutputTokens: Number(row.maxOutputTokens || 768),
    timeoutMs: Number(row.timeoutMs || 30000),
    alwaysOn: true,
    updatedAt: row.updatedAt,
  };
}

export async function saveWorkersAiSettings(
  db: D1Database,
  env: AiEnv,
  organizationId: string,
  userId: string,
  input: { accountId: string; apiToken?: string | null; model?: string; maxOutputTokens?: number; timeoutMs?: number },
) {
  const accountId = String(input.accountId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(accountId)) throw new AppError(422, "VALIDATION_ERROR", "Enter a valid Cloudflare Account ID.");
  const current = await loadRow(db, organizationId);
  let ciphertext = current?.apiTokenCiphertext ?? null;
  let hint = current?.apiTokenHint ?? null;
  const token = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
  if (token) {
    if (token.length < 20 || token.length > 1024) throw new AppError(422, "VALIDATION_ERROR", "The Cloudflare API token format is invalid.");
    if (!env.AI_PROVIDER_ENCRYPTION_KEY || env.AI_PROVIDER_ENCRYPTION_KEY.length < 24) {
      throw new AppError(503, "AI_ENCRYPTION_NOT_CONFIGURED", "Set AI_PROVIDER_ENCRYPTION_KEY before saving Workers AI credentials.");
    }
    ciphertext = await encrypt(env.AI_PROVIDER_ENCRYPTION_KEY, token);
    hint = `••••${token.slice(-4)}`;
  }
  if (!ciphertext) throw new AppError(422, "WORKERS_AI_TOKEN_REQUIRED", "Enter the school's Cloudflare Workers AI API token.");
  const model = normalizeModel(input.model);
  const maxOutputTokens = Math.max(128, Math.min(4096, Number(input.maxOutputTokens || 768)));
  const timeoutMs = Math.max(5000, Math.min(120000, Number(input.timeoutMs || 30000)));
  await db.prepare(`INSERT INTO ae_workers_ai_settings
    (organization_id,account_id,api_token_ciphertext,api_token_hint,model,max_output_tokens,timeout_ms,updated_by)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(organization_id) DO UPDATE SET account_id=excluded.account_id,
      api_token_ciphertext=excluded.api_token_ciphertext,api_token_hint=excluded.api_token_hint,
      model=excluded.model,max_output_tokens=excluded.max_output_tokens,timeout_ms=excluded.timeout_ms,
      updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(organizationId, accountId, ciphertext, hint, model, maxOutputTokens, timeoutMs, userId).run();
  return getWorkersAiSettings(db, organizationId);
}

async function runtime(db: D1Database, env: AiEnv, organizationId: string) {
  const row = await loadRow(db, organizationId);
  if (!row?.accountId || !row.apiTokenCiphertext) return null;
  if (!env.AI_PROVIDER_ENCRYPTION_KEY) throw new AppError(503, "AI_SECRET_UNAVAILABLE", "AI_PROVIDER_ENCRYPTION_KEY is missing.");
  return {
    accountId: row.accountId,
    apiToken: await decrypt(env.AI_PROVIDER_ENCRYPTION_KEY, row.apiTokenCiphertext),
    model: row.model || DEFAULT_WORKERS_AI_MODEL,
    maxOutputTokens: Number(row.maxOutputTokens || 768),
    timeoutMs: Number(row.timeoutMs || 30000),
  };
}

async function requestWorkers(runtimeConfig: NonNullable<Awaited<ReturnType<typeof runtime>>>, messages: any[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtimeConfig.accountId)}/ai/v1/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${runtimeConfig.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: runtimeConfig.model,
          messages,
          max_tokens: runtimeConfig.maxOutputTokens,
          temperature: 0.2,
        }),
      },
    );
    const payload = await response.json().catch(() => ({})) as ChatResponse;
    if (!response.ok) throw new Error(payload.error?.message || `Workers AI request failed (${response.status})`);
    return { text: payload.choices?.[0]?.message?.content?.trim() || "", responseId: payload.id || null };
  } finally {
    clearTimeout(timer);
  }
}

export async function runWorkersAiAdvisory(input: {
  db: D1Database;
  env: AiEnv;
  organizationId: string;
  agentName: string;
  agentTitle: string;
  userText: string;
  recentContext?: string;
  images?: WorkersAiImage[];
}) {
  let cfg: NonNullable<Awaited<ReturnType<typeof runtime>>> | null = null;
  try {
    cfg = await runtime(input.db, input.env, input.organizationId);
    if (!cfg) return { configured: false, ok: false, text: "", model: null, visionUsed: false, error: null };
    const images = input.images || [];
    if (images.length && !workersModelSupportsVision(cfg.model)) {
      return { configured: true, ok: false, text: "", model: cfg.model, visionUsed: false, error: "Configured Workers AI model does not have declared vision support." };
    }
    const prompt = [
      `You are the always-on secondary reasoning partner for ${input.agentName}, ${input.agentTitle}, inside Ledgerly.`,
      "Be concise. Cross-check the user's request, identify missing facts, risky assumptions, route/workflow dependencies, and useful evidence from attached images.",
      "You are advisory only. Never claim a Ledgerly write occurred and never invent school records. The primary AI employee remains the tool-calling orchestrator.",
      input.recentContext ? `RECENT CONTEXT:\n${input.recentContext.slice(-7000)}` : "",
      `CURRENT USER MESSAGE:\n${input.userText || "(image-only message)"}`,
    ].filter(Boolean).join("\n\n");
    const content: any[] = [{ type: "text", text: prompt }];
    for (const image of images) {
      content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${b64(image.bytes)}` } });
    }
    const result = await requestWorkers(cfg, [{ role: "user", content }]);
    return { configured: true, ok: true, text: result.text, model: cfg.model, visionUsed: images.length > 0, error: null };
  } catch (error) {
    return {
      configured: Boolean(cfg),
      ok: false,
      text: "",
      model: cfg?.model || null,
      visionUsed: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    };
  }
}

export async function testWorkersAi(db: D1Database, env: AiEnv, organizationId: string) {
  const cfg = await runtime(db, env, organizationId);
  if (!cfg) throw new AppError(422, "WORKERS_AI_NOT_CONFIGURED", "Save this school's Workers AI configuration first.");
  const started = Date.now();
  const result = await requestWorkers(cfg, [{ role: "user", content: "Reply with OK only." }]);
  return { ok: true, model: cfg.model, latencyMs: Date.now() - started, response: result.text.slice(0, 80), alwaysOn: true };
}

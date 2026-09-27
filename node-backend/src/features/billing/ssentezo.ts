import type { Runtime } from "../../runtime.js";
import { decryptSchoolPaySecret, encryptSchoolPaySecret } from "../schoolpay/service.js";

type SsentezoReply = { response?: string; data?: Record<string, unknown>; error?: { message?: string; code?: string } };
type Envelope = { ciphertext: string; iv: string; tag: string };
export type SsentezoConfig = { env: "sandbox" | "live"; apiUser?: string; apiKey?: string; publicUrl?: string; source: "portal" | "server" | "none" };

const masterKey = (runtime: Runtime) => runtime.config.BILLING_SECRET_ENCRYPTION_KEY ?? runtime.config.JWT_SECRET;
export const encryptApiKey = (runtime: Runtime, value: string) => encryptSchoolPaySecret(value, masterKey(runtime));

/** Credentials saved by the platform admin win; server env vars are a fallback. */
export async function loadSsentezoConfig(runtime: Runtime): Promise<SsentezoConfig> {
  const row = (await runtime.db.query<{ ssentezo_env: string; ssentezo_api_user: string | null; ssentezo_api_key_encrypted: Envelope | null; public_url: string | null }>(
    `SELECT ssentezo_env,ssentezo_api_user,ssentezo_api_key_encrypted,public_url FROM billing_settings WHERE id='default'`).catch(() => ({ rows: [] }))).rows[0];
  if (row?.ssentezo_api_user && row.ssentezo_api_key_encrypted) {
    let apiKey: string | undefined;
    try { apiKey = decryptSchoolPaySecret(row.ssentezo_api_key_encrypted, masterKey(runtime)); } catch { apiKey = undefined; }
    return { env: row.ssentezo_env === "live" ? "live" : "sandbox", apiUser: row.ssentezo_api_user, apiKey, publicUrl: row.public_url ?? runtime.config.LEDGERLY_PUBLIC_URL, source: "portal" };
  }
  const c = runtime.config;
  return { env: c.SSENTEZO_ENV, apiUser: c.SSENTEZO_API_USER, apiKey: c.SSENTEZO_API_KEY, publicUrl: row?.public_url ?? c.LEDGERLY_PUBLIC_URL, source: c.SSENTEZO_API_USER && c.SSENTEZO_API_KEY ? "server" : "none" };
}
export const isConfigured = (cfg: SsentezoConfig) => Boolean(cfg.apiUser && cfg.apiKey);

async function call(cfg: SsentezoConfig, path: string, body?: unknown): Promise<SsentezoReply> {
  if (!isConfigured(cfg)) throw new Error("Mobile money payments are not configured yet.");
  const base = cfg.env === "live" ? "https://wallet.ssentezo.com/api" : "https://devwallet.ssentezo.com/api";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await res.json().catch(() => ({})) as SsentezoReply;
  if (res.status === 401 || res.status === 403) throw new Error("Ssentezo rejected the API credentials saved in the admin portal.");
  if (res.status === 429) throw new Error("Ssentezo is rate limiting requests. Please try again shortly.");
  if (payload.response !== "OK") {
    const errors = (payload.error as { errors?: Record<string, string[]> } | undefined)?.errors;
    throw new Error(errors ? Object.values(errors).flat().join(" ") : payload.error?.message || `Ssentezo request failed (${res.status}).`);
  }
  return payload;
}

/** Ask the payer's phone for a mobile-money PIN prompt. Resolves with the PENDING transaction. */
export async function requestDeposit(cfg: SsentezoConfig, input: { externalReference: string; msisdn: string; amount: number; reason: string; name?: string; callbackUrl?: string }) {
  const reply = await call(cfg, "/deposit", {
    externalReference: input.externalReference, msisdn: input.msisdn, amount: input.amount, currency: "UGX", reason: input.reason,
    ...(input.name ? { name: input.name } : {}),
    ...(input.callbackUrl ? { success_callback: input.callbackUrl, failure_callback: input.callbackUrl } : {}),
  });
  return reply.data ?? {};
}

export async function transactionStatus(cfg: SsentezoConfig, externalReference: string) {
  return (await call(cfg, `/get_status/${encodeURIComponent(externalReference)}`)).data ?? {};
}

/** Wallet balance: used by the admin portal to test saved credentials. */
export async function walletBalance(cfg: SsentezoConfig) {
  return (await call(cfg, "/acc_balance", { currency: "UGX" })).data ?? {};
}

/** Uganda numbers in the international form Ssentezo expects (2567XXXXXXXX). */
export function normalizeMsisdn(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("256") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^7\d{8}$/.test(local) ? `256${local}` : null;
}

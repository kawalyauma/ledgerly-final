import { createHash } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";

export type SchoolPaySecurityEndpoint = "fees_webhook" | "adhoc_callback";
export type SchoolPaySecurityOutcome = "allowed" | "rejected_ip" | "invalid_payload" | "processed" | "failed";

export function normalizeIp(value: string | null | undefined) {
  if (!value) return null;
  let ip = value.trim();
  if (!ip) return null;
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

function ipv4ToBigInt(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8n) | BigInt(n);
  }
  return result;
}

export function ipMatchesRule(ipValue: string | null | undefined, ruleValue: string) {
  const ip = normalizeIp(ipValue);
  const rule = normalizeIp(ruleValue);
  if (!ip || !rule) return false;
  if (!rule.includes("/")) return ip.toLowerCase() === rule.toLowerCase();
  const [network, prefixText] = rule.split("/", 2);
  const ipNumber = ipv4ToBigInt(ip);
  const networkNumber = ipv4ToBigInt(network ?? "");
  const prefix = Number(prefixText);
  if (ipNumber === null || networkNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const all = (1n << 32n) - 1n;
  const mask = prefix === 0 ? 0n : (all << BigInt(32 - prefix)) & all;
  return (ipNumber & mask) === (networkNumber & mask);
}

function matchesAny(ip: string | null, rules: string[]) {
  return Boolean(ip && rules.some((rule) => ipMatchesRule(ip, rule)));
}

export function resolveSchoolPayRequestIp(runtime: Runtime, c: Context<AppEnv>) {
  const directPeerIp = normalizeIp(getConnInfo(c).remote.address);
  const forwardedFor = c.req.header("x-forwarded-for")?.trim() || null;
  const trustedDirectPeer = matchesAny(directPeerIp, runtime.config.SCHOOLPAY_TRUSTED_PROXY_IPS);
  if (!trustedDirectPeer || !forwardedFor) {
    return { sourceIp: directPeerIp, directPeerIp, forwardedFor, trustedProxy: false };
  }

  const chain = forwardedFor.split(",").map((item) => normalizeIp(item)).filter((item): item is string => Boolean(item));
  let sourceIp = chain[0] ?? directPeerIp;
  for (let index = chain.length - 1; index >= 0; index--) {
    const candidate = chain[index]!;
    if (matchesAny(candidate, runtime.config.SCHOOLPAY_TRUSTED_PROXY_IPS)) continue;
    sourceIp = candidate;
    break;
  }
  return { sourceIp, directPeerIp, forwardedFor, trustedProxy: true };
}

function webhookFingerprint(webhookKey: string) {
  return createHash("sha256").update(webhookKey, "utf8").digest("hex").slice(0, 20);
}

async function organizationByWebhookKey(runtime: Runtime, webhookKey: string) {
  return (await runtime.db.query<{ organizationId: string }>(
    `SELECT organization_id AS "organizationId" FROM schoolpay_configurations WHERE webhook_key=$1`,
    [webhookKey],
  )).rows[0]?.organizationId ?? null;
}

export async function recordSchoolPaySecurityAudit(runtime: Runtime, input: {
  webhookKey: string;
  endpointType: SchoolPaySecurityEndpoint;
  outcome: SchoolPaySecurityOutcome;
  sourceIp?: string | null;
  directPeerIp?: string | null;
  forwardedFor?: string | null;
  identifier?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
}) {
  const organizationId = input.organizationId === undefined
    ? await organizationByWebhookKey(runtime, input.webhookKey)
    : input.organizationId;
  await runtime.db.query(
    `INSERT INTO schoolpay_security_audit(
      organization_id,webhook_key_fingerprint,endpoint_type,outcome,source_ip,direct_peer_ip,forwarded_for,identifier,reason,metadata
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [organizationId, webhookFingerprint(input.webhookKey), input.endpointType, input.outcome,
      input.sourceIp ?? null, input.directPeerIp ?? null, input.forwardedFor ?? null,
      input.identifier ?? null, input.reason?.slice(0, 1000) ?? null, JSON.stringify(input.metadata ?? {})],
  );
}

export async function enforceSchoolPayWebhookNetwork(runtime: Runtime, c: Context<AppEnv>, webhookKey: string, endpointType: SchoolPaySecurityEndpoint) {
  const network = resolveSchoolPayRequestIp(runtime, c);
  const enforce = runtime.config.SCHOOLPAY_ENFORCE_WEBHOOK_IP_ALLOWLIST;
  const allowed = !enforce || matchesAny(network.sourceIp, runtime.config.SCHOOLPAY_WEBHOOK_IP_ALLOWLIST);
  if (!allowed) {
    await recordSchoolPaySecurityAudit(runtime, {
      webhookKey,
      endpointType,
      outcome: "rejected_ip",
      ...network,
      reason: "Source IP is not in SCHOOLPAY_WEBHOOK_IP_ALLOWLIST",
    });
    runtime.logger.warn({ endpointType, sourceIp: network.sourceIp, directPeerIp: network.directPeerIp }, "Rejected SchoolPay webhook source IP");
    throw new AppError(403, "SCHOOLPAY_SOURCE_IP_FORBIDDEN", "SchoolPay webhook source IP is not allowed");
  }
  return network;
}

export async function listSchoolPaySecurityAudit(runtime: Runtime, organizationId: string, limit = 100) {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  return (await runtime.db.query(
    `SELECT id,endpoint_type AS "endpointType",outcome,source_ip AS "sourceIp",direct_peer_ip AS "directPeerIp",
      forwarded_for AS "forwardedFor",identifier,reason,metadata,created_at AS "createdAt"
     FROM schoolpay_security_audit WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [organizationId, bounded],
  )).rows;
}

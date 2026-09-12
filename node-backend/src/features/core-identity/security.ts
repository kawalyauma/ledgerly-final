import { createHash, pbkdf2, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { jwtVerify, SignJWT } from "jose";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { AppEnv, AuthPrincipal, AuthRole } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;
const MAXMEM = 64 * 1024 * 1024;

export const allScopes = ["accounts:read","accounts:write","journals:read","journals:write","reports:read","reports:write","contacts:read","contacts:write","products:read","products:write","documents:read","documents:write","payments:read","payments:write","payroll:read","payroll:write","periods:read","periods:write","admin:read","admin:write","communications:read","communications:write","school:read","school:write"];

export function createId(prefix: string): string { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function deriveScrypt(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KEY_BYTES, { N: n, r, p, maxmem: MAXMEM }, (error, key) => error ? reject(error) : resolve(key)));
}
function derivePbkdf2(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(password, salt, iterations, KEY_BYTES, "sha256", (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16), key = await deriveScrypt(password, salt);
  return `scrypt-v1:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${key.toString("hex")}`;
}
export function passwordNeedsRehash(encoded: string): boolean {
  const [algorithm, n, r, p] = encoded.split(":");
  return algorithm !== "scrypt-v1" || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split(":");
  try {
    if (parts[0] === "scrypt-v1") {
      const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || n < 2 || n > 65536 || r < 1 || r > 32 || p < 1 || p > 16) return false;
      const salt = Buffer.from(parts[4] ?? "", "hex"), expected = Buffer.from(parts[5] ?? "", "hex");
      if (!salt.length || expected.length !== KEY_BYTES) return false;
      const actual = await deriveScrypt(password, salt, n, r, p);
      return timingSafeEqual(actual, expected);
    }
    if (parts[0] === "pbkdf2-sha256") {
      const iterations = Number(parts[1]);
      if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2_000_000) return false;
      const salt = Buffer.from(parts[2] ?? "", "hex"), expected = Buffer.from(parts[3] ?? "", "hex");
      if (!salt.length || expected.length !== KEY_BYTES) return false;
      return timingSafeEqual(await derivePbkdf2(password, salt, iterations), expected);
    }
  } catch { return false; }
  return false;
}

type Db = Pool | PoolClient;
export async function issueTokens(runtime: Runtime, db: Db, userId: string, organizationId: string, role: string, scopes: string[], meta: { ip?: string; userAgent?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({ org: organizationId, role, scopes })
    .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer(runtime.config.JWT_ISSUER).setAudience(runtime.config.JWT_AUDIENCE)
    .setIssuedAt(now).setExpirationTime(now + 900).sign(new TextEncoder().encode(runtime.config.JWT_SECRET));
  const refreshToken = randomToken(48), sessionId = createId("ses");
  await db.query(`INSERT INTO sessions(id,user_id,organization_id,refresh_token_hash,expires_at,ip_address,user_agent)
    VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP + INTERVAL '30 days',$5,$6)`, [sessionId,userId,organizationId,sha256(refreshToken),meta.ip ?? null,meta.userAgent ?? null]);
  return { accessToken, expiresIn: 900, refreshToken, sessionId };
}

export function requestIp(header: (name: string) => string | undefined): string | undefined {
  return header("CF-Connecting-IP") ?? header("X-Real-IP") ?? header("X-Forwarded-For")?.split(",")[0]?.trim();
}

export function requireAuth(runtime: Runtime): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (runtime.config.NODE_ENV === "development") {
      const organizationId = c.req.header("X-Organization-Id"), userId = c.req.header("X-User-Id");
      if (organizationId && userId) { c.set("principal", { organizationId, userId, role: "owner", scopes: allScopes }); await next(); return; }
    }
    const apiKey = c.req.header("X-API-Key");
    if (apiKey) {
      const result = await runtime.db.query<{id:string;organizationId:string;scopes:string[]}>(`SELECT id,organization_id AS "organizationId",scopes
        FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`, [sha256(apiKey)]);
      const key = result.rows[0];
      if (!key) throw new AppError(401, "INVALID_API_KEY", "API key is invalid or expired");
      c.set("principal", { userId: `apikey:${key.id}`, organizationId: key.organizationId, role: "integration", scopes: key.scopes });
      await runtime.db.query("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [key.id]);
      await next(); return;
    }
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new AppError(401, "UNAUTHENTICATED", "Bearer token required");
    let payload;
    try { ({ payload } = await jwtVerify(authorization.slice(7), new TextEncoder().encode(runtime.config.JWT_SECRET), { issuer: runtime.config.JWT_ISSUER, audience: runtime.config.JWT_AUDIENCE, algorithms: ["HS256"] })); }
    catch { throw new AppError(401, "INVALID_TOKEN", "Access token is invalid or expired"); }
    if (!payload.sub || typeof payload.org !== "string" || typeof payload.role !== "string") throw new AppError(401, "INVALID_TOKEN", "Token is missing required claims");
    const principal: AuthPrincipal = {
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role as AuthRole,
      scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((v): v is string => typeof v === "string") : [],
      mobileDeviceId: typeof payload.mobileDeviceId === "string" ? payload.mobileDeviceId : undefined,
    };
    c.set("principal", principal); await next();
  };
}

export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get("principal");
    if (principal.role !== "owner" && principal.role !== "admin" && !principal.scopes.includes(scope)) throw new AppError(403, "FORBIDDEN", `Missing required scope: ${scope}`);
    await next();
  };
}

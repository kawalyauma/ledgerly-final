// Adapted from ../../../../selfhost/system-gateway.ts for node-backend's own Hono app.
// Lets agentic-employees tools (system_catalog/system_read/prepare_system_action)
// re-invoke node-backend's own REST API in-process, scoped to the executing
// principal's real tenant/role/scopes and to a per-agent-role path allowlist.
import { SignJWT } from "jose";
import type { AuthPrincipal } from "../../http/types.js";

// Every AI employee can reach anything a real logged-in user with that same
// role/scopes could reach — Ledgerly's own permission checks (requireScope,
// role checks) still run for real on every delegated request underneath this,
// so this allowlist is about which *areas* of the product an employee should
// be poking around in, not a second, stricter permission system.
const profiles: Record<string, string[]> = {
  secretary: ["/api/v1/"],
  dos: ["/api/v1/"],
  bursar: ["/api/v1/"],
  headteacher: ["/api/v1/"],
  hr: ["/api/v1/"],
  librarian: ["/api/v1/"],
};
const blocked = ["/api/v1/agentic-employees", "/api/v1/admin", "/api/v1/integrations", "/api/v1/modules"];

function cleanPath(path: string) {
  if (!path.startsWith("/api/v1/") || path.includes("..") || path.includes("://") || /[\r\n]/.test(path)) throw new Error("Only internal /api/v1 Ledgerly paths are allowed");
  return path;
}
function prefixMatch(path: string, prefix: string) { return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`); }
export function agentPathAllowed(agentKey: string, path: string) {
  const p = (cleanPath(path).split("?")[0] || path).replace(/\/$/, "");
  if (blocked.some(x => prefixMatch(p, x))) return false;
  return (profiles[agentKey] || []).some(prefix => prefixMatch(p, prefix));
}

export type AgentSystemGateway = {
  catalog(agentKey: string, principal: AuthPrincipal): Promise<Array<{ method: string; path: string }>>;
  request(input: { agentKey: string; principal: AuthPrincipal; method: string; path: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: any }>;
};

export function createAgentSystemGateway(app: { fetch: (req: Request) => Promise<Response>; routes?: Array<{ method: string; path: string }> }, secret: string, issuer: string, audience: string): AgentSystemGateway {
  const key = new TextEncoder().encode(secret);
  async function token(p: AuthPrincipal) {
    return new SignJWT({ org: p.organizationId, role: p.role, scopes: p.scopes })
      .setProtectedHeader({ alg: "HS256" }).setSubject(p.userId).setIssuer(issuer).setAudience(audience)
      .setIssuedAt().setExpirationTime("90s").sign(key);
  }
  return {
    async catalog(agentKey) {
      const routes = (app.routes || []).map(r => ({ method: String(r.method || "GET").toUpperCase(), path: String(r.path || "") }))
        .filter(r => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method) && r.path.startsWith("/api/v1/") && agentPathAllowed(agentKey, r.path));
      // No cap here: system_tools' catalog handler applies the model's search
      // query against this full allowed set before truncating for the model.
      // Capping here first would silently hide legitimate routes from search.
      return Array.from(new Map(routes.map(r => [`${r.method} ${r.path}`, r])).values());
    },
    async request(input) {
      const method = String(input.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Unsupported delegated method");
      const path = cleanPath(input.path);
      if (!agentPathAllowed(input.agentKey, path)) return { ok: false, status: 403, data: { error: { code: "AGENT_ROLE_FORBIDDEN", message: `${input.agentKey} is not allowed to use this Ledgerly area` } } };
      const headers = new Headers({ Authorization: `Bearer ${await token(input.principal)}`, Accept: "application/json" });
      let body: BodyInit | undefined;
      if (method !== "GET" && input.body !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(input.body); }
      const response = await app.fetch(new Request(`http://ledgerly.internal${path}`, { method, headers, body }));
      const text = await response.text();
      let data: any = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      return { ok: response.ok, status: response.status, data };
    },
  };
}

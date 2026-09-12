import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { hashPassword, verifyPassword } from "../src/features/core-identity/security.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

it("uses the compatible Ledgerly scrypt password format", async () => {
  const encoded = await hashPassword("a-very-strong-password");
  expect(encoded.startsWith("scrypt-v1:16384:8:1:")).toBe(true);
  expect(await verifyPassword("a-very-strong-password", encoded)).toBe(true);
  expect(await verifyPassword("wrong-password", encoded)).toBe(false);
});

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration("core identity contracts", () => {
  let runtime: Runtime; let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE identity_login_events, identity_mfa, identity_aliases, api_keys, sessions, organization_membership_invites, audit_logs, backend_outbox_events, memberships, users, organizations CASCADE");
    app = createApp({ environment:"test", corsOrigins:["*"], health:new PlatformHealth(runtime), features, runtime });
  });
  afterAll(async () => { await runtime?.close(); });

  it("registers, authenticates, manages tenants, rotates refresh tokens and creates API keys", async () => {
    const register = await app.request("/auth/register", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({organizationName:"Test School",name:"Owner User",email:"owner@example.test",password:"a-secure-password-123"}) });
    expect(register.status).toBe(201); const registered = (await register.json()) as {data:{organizationId:string;userId:string}};

    const login = await app.request("/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:"owner@example.test",password:"a-secure-password-123"}) });
    expect(login.status).toBe(200); const tokens = (await login.json()) as {data:{accessToken:string;refreshToken:string}}; const bearer={Authorization:`Bearer ${tokens.data.accessToken}`};

    const current = await app.request("/api/v1/organizations/current", { headers:bearer }); expect(current.status).toBe(200);
    const list = await app.request("/api/v1/organizations/", { headers:bearer }); expect(list.status).toBe(200); expect(((await list.json()) as {data:unknown[]}).data).toHaveLength(1);

    const created = await app.request("/api/v1/organizations/", { method:"POST", headers:{...bearer,"Content-Type":"application/json"}, body:JSON.stringify({name:"Second Tenant",baseCurrency:"UGX",timezone:"Africa/Kampala",fiscalYearStartMonth:1,address:{},documentNumbering:{}}) });
    expect(created.status).toBe(201); const second = (await created.json()) as {data:{id:string}};
    const switched = await app.request("/api/v1/organizations/switch", { method:"POST", headers:{...bearer,"Content-Type":"application/json"}, body:JSON.stringify({organizationId:second.data.id}) }); expect(switched.status).toBe(200);

    const member = await app.request("/api/v1/admin/memberships", { method:"POST", headers:{...bearer,"Content-Type":"application/json"}, body:JSON.stringify({email:"manager@example.test",displayName:"Manager",role:"manager",scopes:["accounts:read"]}) }); expect(member.status).toBe(201);
    const key = await app.request("/api/v1/admin/api-keys", { method:"POST", headers:{...bearer,"Content-Type":"application/json"}, body:JSON.stringify({name:"integration",scopes:["accounts:read"]}) }); expect(key.status).toBe(201); const keyBody=(await key.json()) as {data:{secret:string}};
    const apiKeyCurrent = await app.request("/api/v1/organizations/current", { headers:{"X-API-Key":keyBody.data.secret} }); expect(apiKeyCurrent.status).toBe(200);

    const refresh = await app.request("/auth/refresh", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({refreshToken:tokens.data.refreshToken}) }); expect(refresh.status).toBe(200);
    const reused = await app.request("/auth/refresh", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({refreshToken:tokens.data.refreshToken}) }); expect(reused.status).toBe(401);
    expect((await runtime.db.query("SELECT count(*)::int AS count FROM backend_outbox_events WHERE topic='organization.created'")).rows[0].count).toBe(2);
    expect(registered.data.organizationId).toBeTruthy();
  });
});

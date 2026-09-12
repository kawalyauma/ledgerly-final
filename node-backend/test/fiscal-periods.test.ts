import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration("fiscal periods and posting controls", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    runtime = await createRuntime();
    app = createApp({ environment: "test", corsOrigins: ["*"], health: new PlatformHealth(runtime), features, runtime });
  });
  afterAll(async () => { await runtime?.close(); });

  it("blocks journal posting and reversal dates in closed or locked periods", async () => {
    const email = `period-owner-${Date.now()}@example.test`;
    const register = await app.request("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationName: "Period Test", name: "Owner", email, password: "a-secure-password-123" }) });
    expect(register.status).toBe(201);
    const login = await app.request("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "a-secure-password-123" }) });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const year = await app.request("/api/v1/fiscal-years/", { method: "POST", headers: auth, body: JSON.stringify({ name: "FY 2026", startsOn: "2026-01-01", endsOn: "2026-12-31" }) });
    expect(year.status).toBe(201);
    const yearId = ((await year.json()) as { data: { id: string } }).data.id;
    const period = await app.request("/api/v1/periods/", { method: "POST", headers: auth, body: JSON.stringify({ fiscalYearId: yearId, name: "September 2026", startsOn: "2026-09-01", endsOn: "2026-09-30" }) });
    expect(period.status).toBe(201);
    const periodId = ((await period.json()) as { data: { id: string } }).data.id;

    const accounts = await app.request("/api/v1/accounts/", { headers: { Authorization: `Bearer ${token}` } });
    const rows = ((await accounts.json()) as { data: Array<{ id: string; code: string }> }).data;
    const cash = rows.find((row) => row.code === "1000")!;
    const sales = rows.find((row) => row.code === "4000")!;
    const journal = await app.request("/api/v1/journals/", { method: "POST", headers: { ...auth, "Idempotency-Key": `period-test-${Date.now()}` }, body: JSON.stringify({ transactionDate: "2026-09-10", postingDate: "2026-09-10", description: "Period control test", currency: "UGX", lines: [{ accountId: cash.id, debitMinor: 10000 }, { accountId: sales.id, creditMinor: 10000 }] }) });
    expect(journal.status).toBe(201);
    const journalId = ((await journal.json()) as { data: { id: string } }).data.id;

    const closed = await app.request(`/api/v1/periods/${periodId}/status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "closed" }) });
    expect(closed.status).toBe(200);
    const blockedPost = await app.request(`/api/v1/journals/${journalId}/post`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(blockedPost.status).toBe(409);
    expect(((await blockedPost.json()) as { error: { code: string } }).error.code).toBe("FISCAL_PERIOD_CLOSED");

    const reopened = await app.request(`/api/v1/periods/${periodId}/status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "open" }) });
    expect(reopened.status).toBe(200);
    expect((await app.request(`/api/v1/journals/${journalId}/post`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

    expect((await app.request(`/api/v1/periods/${periodId}/status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "locked" }) })).status).toBe(200);
    const blockedReverse = await app.request(`/api/v1/journals/${journalId}/reverse`, { method: "POST", headers: auth, body: JSON.stringify({ postingDate: "2026-09-20", reason: "Testing locked period" }) });
    expect(blockedReverse.status).toBe(409);
    expect(((await blockedReverse.json()) as { error: { code: string } }).error.code).toBe("FISCAL_PERIOD_CLOSED");
  });
});

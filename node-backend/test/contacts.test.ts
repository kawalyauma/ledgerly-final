import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("contacts customers and suppliers", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  let bearer: { Authorization: string };
  let organizationId: string;

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    app = createApp({ environment: "test", corsOrigins: ["*"], health: new PlatformHealth(runtime), features, runtime });

    const register = await app.request("/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationName: "Contacts Test", name: "Owner", email: "contacts@example.test", password: "a-secure-password-123" }),
    });
    expect(register.status).toBe(201);
    organizationId = ((await register.json()) as { data: { organizationId: string } }).data.organizationId;

    const login = await app.request("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "contacts@example.test", password: "a-secure-password-123" }),
    });
    expect(login.status).toBe(200);
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    bearer = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => { await runtime?.close(); });

  it("manages customer and supplier master data safely", async () => {
    const create = async (body: Record<string, unknown>) => {
      const response = await app.request("/api/v1/contacts/", {
        method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { data: { id: string } };
    };

    const customer = await create({ type: "customer", code: "CUS-001", name: "Kampala Customer", email: "Customer@Example.Test", paymentTermsDays: 30, creditLimitMinor: 500000, pricingTier: "retail" });
    const supplier = await create({ type: "supplier", code: "SUP-001", name: "Main Supplier", paymentTermsDays: 14 });

    const customers = await app.request("/api/v1/contacts/?type=customer", { headers: bearer });
    expect(customers.status).toBe(200);
    const customersBody = (await customers.json()) as { data: Array<{ id: string; type: string; email: string }> };
    expect(customersBody.data).toHaveLength(1);
    expect(customersBody.data[0]?.id).toBe(customer.data.id);
    expect(customersBody.data[0]?.email).toBe("customer@example.test");

    const firstAddress = await app.request(`/api/v1/contacts/${customer.data.id}/addresses/manage`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "billing", line1: "Plot 1", city: "Kampala", country: "ug", isDefault: true }),
    });
    expect(firstAddress.status).toBe(201);
    const secondAddress = await app.request(`/api/v1/contacts/${customer.data.id}/addresses/manage`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "billing", line1: "Plot 2", city: "Kampala", country: "UG", isDefault: true }),
    });
    expect(secondAddress.status).toBe(201);

    await app.request(`/api/v1/contacts/${customer.data.id}/people/manage`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Accounts One", phone: "+256700000001", isPrimary: true }),
    });
    await app.request(`/api/v1/contacts/${customer.data.id}/people/manage`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Accounts Two", phone: "+256700000002", isPrimary: true }),
    });

    const detail = await app.request(`/api/v1/contacts/${customer.data.id}/detail`, { headers: bearer });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { data: { addresses: Array<{ isDefault: boolean }>; people: Array<{ isPrimary: boolean }> } };
    expect(detailBody.data.addresses.filter((item) => item.isDefault)).toHaveLength(1);
    expect(detailBody.data.people.filter((item) => item.isPrimary)).toHaveLength(1);

    const archive = await app.request(`/api/v1/contacts/${supplier.data.id}/archive`, { method: "POST", headers: bearer });
    expect(archive.status).toBe(200);
    const archived = await app.request("/api/v1/contacts/archived", { headers: bearer });
    expect(((await archived.json()) as { data: Array<{ id: string }> }).data.some((row) => row.id === supplier.data.id)).toBe(true);
    const restore = await app.request(`/api/v1/contacts/${supplier.data.id}/restore`, { method: "POST", headers: bearer });
    expect(restore.status).toBe(200);
  });

  it("moves accounting references when contacts are merged and blocks unsafe deletion", async () => {
    const createContact = async (code: string, name: string) => {
      const response = await app.request("/api/v1/contacts/", {
        method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "customer", code, name }),
      });
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    const sourceId = await createContact("CUS-MERGE-A", "Merge Source");
    const targetId = await createContact("CUS-MERGE-B", "Merge Target");

    const accounts = await app.request("/api/v1/accounts/", { headers: bearer });
    const rows = ((await accounts.json()) as { data: Array<{ id: string; code: string }> }).data;
    const cash = rows.find((row) => row.code === "1000")!;
    const revenue = rows.find((row) => row.code === "4000")!;
    const journal = await app.request("/api/v1/journals/", {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json", "Idempotency-Key": "contacts-merge-journal" },
      body: JSON.stringify({ transactionDate: "2026-09-12", postingDate: "2026-09-12", description: "Contact merge test", currency: "UGX", lines: [
        { accountId: cash.id, debitMinor: 1000, contactId: sourceId },
        { accountId: revenue.id, creditMinor: 1000, contactId: sourceId },
      ] }),
    });
    expect(journal.status).toBe(201);

    const blockedDelete = await app.request(`/api/v1/contacts/${sourceId}`, { method: "DELETE", headers: bearer });
    expect(blockedDelete.status).toBe(409);

    const merge = await app.request(`/api/v1/contacts/${sourceId}/merge`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ targetContactId: targetId }),
    });
    expect(merge.status).toBe(200);
    const moved = await runtime.db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM journal_lines WHERE organization_id=$1 AND contact_id=$2", [organizationId, targetId]);
    expect(Number(moved.rows[0]?.count ?? 0)).toBe(2);

    const detail = await app.request(`/api/v1/contacts/${sourceId}/detail`, { headers: bearer });
    expect(detail.status).toBe(200);
    const contact = ((await detail.json()) as { data: { contact: { archivedAt: string | null; mergedIntoContactId: string | null } } }).data.contact;
    expect(contact.archivedAt).toBeTruthy();
    expect(contact.mergedIntoContactId).toBe(targetId);
  });
});

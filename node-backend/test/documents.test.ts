import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("documents invoices bills and credits", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  let bearer: { Authorization: string };
  let organizationId: string;
  let customerId: string;
  let supplierId: string;
  let accounts: Record<string, string>;

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    app = createApp({ environment: "test", corsOrigins: ["*"], health: new PlatformHealth(runtime), features, runtime });

    const register = await app.request("/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationName: "Documents Test", name: "Owner", email: "documents@example.test", password: "a-secure-password-123" }),
    });
    expect(register.status).toBe(201);
    organizationId = ((await register.json()) as { data: { organizationId: string } }).data.organizationId;

    const login = await app.request("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "documents@example.test", password: "a-secure-password-123" }),
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    bearer = { Authorization: `Bearer ${token}` };

    const accountResponse = await app.request("/api/v1/accounts/", { headers: bearer });
    const accountRows = ((await accountResponse.json()) as { data: Array<{ id: string; code: string }> }).data;
    accounts = Object.fromEntries(accountRows.map((row) => [row.code, row.id]));

    const createContact = async (type: "customer" | "supplier", code: string, name: string) => {
      const response = await app.request("/api/v1/contacts/", {
        method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ type, code, name }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    customerId = await createContact("customer", "CUS-DOC", "Document Customer");
    supplierId = await createContact("supplier", "SUP-DOC", "Document Supplier");
  });

  afterAll(async () => { await runtime?.close(); });

  const createDocument = async (body: Record<string, unknown>) => {
    const response = await app.request("/api/v1/documents/", {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: { id: string; status: string; totalMinor: number } }).data;
  };

  it("posts invoices, bills and credits to balanced journals with automatic AR/AP controls", async () => {
    const invoice = await createDocument({
      type: "invoice", number: "INV-0001", contactId: customerId, issueDate: "2026-09-12", dueDate: "2026-10-12", currency: "UGX",
      lines: [{ accountId: accounts["4000"], taxAccountId: accounts["2100"], description: "Services", quantityMicros: 1_000_000, unitPriceMinor: 70_000, taxMinor: 5_000 }],
    });
    expect(invoice.totalMinor).toBe(75_000);
    const postedInvoice = await app.request(`/api/v1/documents/${invoice.id}/post`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: "{}",
    });
    expect(postedInvoice.status).toBe(200);
    const invoicePost = (await postedInvoice.json()) as { data: { status: string; journalEntryId: string; controlAccountId: string } };
    expect(invoicePost.data.status).toBe("open");
    expect(invoicePost.data.controlAccountId).toBe(accounts["1100"]);

    const invoiceLines = await runtime.db.query<{ accountId: string; debit: number; credit: number }>(
      `SELECT account_id AS "accountId",debit_minor::float8 AS debit,credit_minor::float8 AS credit FROM journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`,
      [organizationId, invoicePost.data.journalEntryId],
    );
    expect(invoiceLines.rows.reduce((sum, row) => sum + row.debit, 0)).toBe(75_000);
    expect(invoiceLines.rows.reduce((sum, row) => sum + row.credit, 0)).toBe(75_000);
    expect(invoiceLines.rows.find((row) => row.accountId === accounts["1100"])?.debit).toBe(75_000);

    const bill = await createDocument({
      type: "bill", number: "BILL-0001", contactId: supplierId, issueDate: "2026-09-12", currency: "UGX",
      lines: [{ accountId: accounts["6000"], description: "Utilities", quantityMicros: 1_000_000, unitPriceMinor: 40_000 }],
    });
    const postedBill = await app.request(`/api/v1/documents/${bill.id}/post`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: "{}" });
    expect(postedBill.status).toBe(200);
    expect(((await postedBill.json()) as { data: { controlAccountId: string } }).data.controlAccountId).toBe(accounts["2000"]);

    const credit = await createDocument({
      type: "credit_note", number: "CN-0001", contactId: customerId, issueDate: "2026-09-12", currency: "UGX",
      lines: [{ accountId: accounts["4000"], description: "Price adjustment", quantityMicros: 1_000_000, unitPriceMinor: 10_000 }],
    });
    const postedCredit = await app.request(`/api/v1/documents/${credit.id}/post`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: "{}" });
    expect(postedCredit.status).toBe(200);
    const creditJournalId = ((await postedCredit.json()) as { data: { journalEntryId: string } }).data.journalEntryId;
    const creditControl = (await runtime.db.query<{ debit: number; credit: number }>(
      `SELECT debit_minor::float8 AS debit,credit_minor::float8 AS credit FROM journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND account_id=$3`,
      [organizationId, creditJournalId, accounts["1100"]],
    )).rows[0];
    expect(creditControl?.credit).toBe(10_000);

    const reverse = await app.request(`/api/v1/documents/${invoice.id}/reverse`, {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ postingDate: "2026-09-12", reason: "Customer invoice cancelled" }),
    });
    expect(reverse.status).toBe(200);
    const reversed = (await reverse.json()) as { data: { status: string; reversalJournalId: string } };
    expect(reversed.data.status).toBe("void");
    const states = await runtime.db.query<{ original: string; reversal: string }>(
      `SELECT o.status AS original,r.status AS reversal FROM journal_entries o JOIN journal_entries r ON r.reversal_of_id=o.id AND r.organization_id=o.organization_id WHERE o.id=$1 AND o.organization_id=$2`,
      [invoicePost.data.journalEntryId, organizationId],
    );
    expect(states.rows[0]).toEqual({ original: "reversed", reversal: "posted" });
  });

  it("requires the correct customer/supplier type and obeys closed fiscal periods", async () => {
    const wrongContact = await app.request("/api/v1/documents/", {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invoice", number: "INV-WRONG", contactId: supplierId, issueDate: "2026-11-01", currency: "UGX", lines: [{ accountId: accounts["4000"], description: "Wrong contact", unitPriceMinor: 1000 }] }),
    });
    expect(wrongContact.status).toBe(422);

    const yearResponse = await app.request("/api/v1/fiscal-years/", {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "FY 2026", startsOn: "2026-01-01", endsOn: "2026-12-31" }),
    });
    expect(yearResponse.status).toBe(201);
    const yearId = ((await yearResponse.json()) as { data: { id: string } }).data.id;
    const periodResponse = await app.request("/api/v1/periods/", {
      method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({ fiscalYearId: yearId, name: "November 2026", startsOn: "2026-11-01", endsOn: "2026-11-30" }),
    });
    const periodId = ((await periodResponse.json()) as { data: { id: string } }).data.id;
    const close = await app.request(`/api/v1/periods/${periodId}/status`, {
      method: "PATCH", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed", reason: "Month end complete" }),
    });
    expect(close.status).toBe(200);

    const blocked = await createDocument({
      type: "invoice", number: "INV-CLOSED", contactId: customerId, issueDate: "2026-11-15", currency: "UGX",
      lines: [{ accountId: accounts["4000"], description: "Closed period sale", quantityMicros: 1_000_000, unitPriceMinor: 25_000 }],
    });
    const post = await app.request(`/api/v1/documents/${blocked.id}/post`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: "{}" });
    expect(post.status).toBe(409);
    const error = (await post.json()) as { error: { code: string } };
    expect(error.error.code).toBe("FISCAL_PERIOD_CLOSED");
    const row = (await runtime.db.query<{ status: string }>("SELECT status FROM documents WHERE id=$1 AND organization_id=$2", [blocked.id, organizationId])).rows[0];
    expect(row?.status).toBe("draft");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("payments and allocations", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  let bearer: { Authorization: string };
  let organizationId: string;
  let customerId: string;
  let supplierId: string;
  let cashId: string;
  let receivableId: string;
  let payableId: string;
  let revenueId: string;
  let expenseId: string;
  let invoiceId: string;
  let billId: string;

  const jsonHeaders = () => ({ ...bearer, "Content-Type": "application/json" });

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    app = createApp({ environment: "test", corsOrigins: ["*"], health: new PlatformHealth(runtime), features, runtime });

    const register = await app.request("/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationName: "Payments Test", name: "Owner", email: "payments@example.test", password: "a-secure-password-123" }),
    });
    expect(register.status).toBe(201);
    organizationId = ((await register.json()) as { data: { organizationId: string } }).data.organizationId;
    const login = await app.request("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "payments@example.test", password: "a-secure-password-123" }),
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    bearer = { Authorization: `Bearer ${token}` };

    const createContact = async (type: "customer" | "supplier", code: string, name: string) => {
      const response = await app.request("/api/v1/contacts/", {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ type, code, name }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    customerId = await createContact("customer", "CUS-PAY", "Payments Customer");
    supplierId = await createContact("supplier", "SUP-PAY", "Payments Supplier");

    const accounts = await app.request("/api/v1/accounts/", { headers: bearer });
    const rows = ((await accounts.json()) as { data: Array<{ id: string; code: string }> }).data;
    const byCode = (code: string) => rows.find((row) => row.code === code)!.id;
    cashId = byCode("1000"); receivableId = byCode("1100"); payableId = byCode("2000");
    revenueId = byCode("4000"); expenseId = byCode("6000");

    const createDocument = async (type: "invoice" | "bill", number: string, contactId: string, accountId: string, amountMinor: number) => {
      const response = await app.request("/api/v1/documents/", {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({
          type, number, contactId, issueDate: "2026-09-13", dueDate: "2026-09-30", currency: "UGX",
          lines: [{ accountId, description: `${number} line`, quantityMicros: 1_000_000, unitPriceMinor: amountMinor }],
        }),
      });
      expect(response.status).toBe(201);
      const id = ((await response.json()) as { data: { id: string } }).data.id;
      const post = await app.request(`/api/v1/documents/${id}/post`, { method: "POST", headers: jsonHeaders(), body: "{}" });
      expect(post.status).toBe(200);
      return id;
    };
    invoiceId = await createDocument("invoice", "INV-PAY-001", customerId, revenueId, 10_000);
    billId = await createDocument("bill", "BILL-PAY-001", supplierId, expenseId, 8_000);
  });

  afterAll(async () => { await runtime?.close(); });

  it("posts a partial customer receipt, allocates the remainder, and reverses cleanly", async () => {
    const create = await app.request("/api/v1/payments/", {
      method: "POST",
      headers: { ...jsonHeaders(), "Idempotency-Key": "receipt-payments-test-1" },
      body: JSON.stringify({
        type: "receipt", number: "RCT-0001", contactId: customerId, bankAccountId: cashId, controlAccountId: receivableId,
        paymentDate: "2026-09-13", currency: "UGX", amountMinor: 10_000, reference: "BANK-RCT-1",
      }),
    });
    expect(create.status).toBe(201);
    const paymentId = ((await create.json()) as { data: { id: string } }).data.id;

    const post = await app.request(`/api/v1/payments/${paymentId}/post`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: invoiceId, amountMinor: 4_000 }] }),
    });
    expect(post.status).toBe(200);
    const posted = (await post.json()) as { data: { allocatedMinor: number; unallocatedMinor: number; journalEntryId: string } };
    expect(posted.data.allocatedMinor).toBe(4_000);
    expect(posted.data.unallocatedMinor).toBe(6_000);

    let invoice = (await runtime.db.query<{ paid: number; status: string }>(
      `SELECT paid_minor::float8 AS paid,status FROM documents WHERE id=$1 AND organization_id=$2`, [invoiceId, organizationId],
    )).rows[0]!;
    expect(invoice.paid).toBe(4_000);
    expect(invoice.status).toBe("partially_paid");

    const journalLines = await runtime.db.query<{ code: string; debit: number; credit: number }>(
      `SELECT a.code,l.debit_minor::float8 AS debit,l.credit_minor::float8 AS credit FROM journal_lines l
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE l.journal_entry_id=$1 AND l.organization_id=$2 ORDER BY a.code`,
      [posted.data.journalEntryId, organizationId],
    );
    expect(journalLines.rows).toEqual([
      { code: "1000", debit: 10_000, credit: 0 },
      { code: "1100", debit: 0, credit: 10_000 },
    ]);

    const allocate = await app.request(`/api/v1/payments/${paymentId}/allocations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: invoiceId, amountMinor: 6_000 }] }),
    });
    expect(allocate.status).toBe(200);
    const allocationBody = (await allocate.json()) as { data: { allocatedMinor: number; totalAllocatedMinor: number; unallocatedMinor: number } };
    expect(allocationBody.data.allocatedMinor).toBe(6_000);
    expect(allocationBody.data.totalAllocatedMinor).toBe(10_000);
    expect(allocationBody.data.unallocatedMinor).toBe(0);

    invoice = (await runtime.db.query<{ paid: number; status: string }>(
      `SELECT paid_minor::float8 AS paid,status FROM documents WHERE id=$1 AND organization_id=$2`, [invoiceId, organizationId],
    )).rows[0]!;
    expect(invoice).toEqual({ paid: 10_000, status: "paid" });

    const balances = await app.request(`/api/v1/payments/balances?contactId=${customerId}&type=receipt`, { headers: bearer });
    expect(balances.status).toBe(200);
    const balanceBody = (await balances.json()) as { data: { documents: Array<{ id: string }> } };
    expect(balanceBody.data.documents.some((document) => document.id === invoiceId)).toBe(false);

    const over = await app.request(`/api/v1/payments/${paymentId}/allocations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: invoiceId, amountMinor: 1 }] }),
    });
    expect(over.status).toBe(422);

    const reverse = await app.request(`/api/v1/payments/${paymentId}/reverse`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ postingDate: "2026-09-13", reason: "Receipt entered in error" }),
    });
    expect(reverse.status).toBe(200);
    const reversed = (await reverse.json()) as { data: { status: string; reversalJournalId: string } };
    expect(reversed.data.status).toBe("reversed");

    invoice = (await runtime.db.query<{ paid: number; status: string }>(
      `SELECT paid_minor::float8 AS paid,status FROM documents WHERE id=$1 AND organization_id=$2`, [invoiceId, organizationId],
    )).rows[0]!;
    expect(invoice).toEqual({ paid: 0, status: "open" });
    const journals = await runtime.db.query<{ originalStatus: string; reversalStatus: string }>(
      `SELECT original.status AS "originalStatus",reversal.status AS "reversalStatus"
       FROM journal_entries original JOIN journal_entries reversal ON reversal.reversal_of_id=original.id AND reversal.organization_id=original.organization_id
       WHERE original.id=$1 AND original.organization_id=$2`,
      [posted.data.journalEntryId, organizationId],
    );
    expect(journals.rows[0]).toEqual({ originalStatus: "reversed", reversalStatus: "posted" });
  });

  it("supports partial supplier-payment allocations and rejects over-allocation", async () => {
    const create = await app.request("/api/v1/payments/", {
      method: "POST",
      headers: { ...jsonHeaders(), "Idempotency-Key": "supplier-payment-test-1" },
      body: JSON.stringify({
        type: "payment", number: "PAY-0001", contactId: supplierId, bankAccountId: cashId, controlAccountId: payableId,
        paymentDate: "2026-09-13", currency: "UGX", amountMinor: 8_000,
      }),
    });
    const paymentId = ((await create.json()) as { data: { id: string } }).data.id;
    const post = await app.request(`/api/v1/payments/${paymentId}/post`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: billId, amountMinor: 3_000 }] }),
    });
    expect(post.status).toBe(200);
    let bill = (await runtime.db.query<{ paid: number; status: string }>(
      `SELECT paid_minor::float8 AS paid,status FROM documents WHERE id=$1 AND organization_id=$2`, [billId, organizationId],
    )).rows[0]!;
    expect(bill).toEqual({ paid: 3_000, status: "partially_paid" });

    const tooMuch = await app.request(`/api/v1/payments/${paymentId}/allocations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: billId, amountMinor: 5_001 }] }),
    });
    expect(tooMuch.status).toBe(422);

    const rest = await app.request(`/api/v1/payments/${paymentId}/allocations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: billId, amountMinor: 5_000 }] }),
    });
    expect(rest.status).toBe(200);
    bill = (await runtime.db.query<{ paid: number; status: string }>(
      `SELECT paid_minor::float8 AS paid,status FROM documents WHERE id=$1 AND organization_id=$2`, [billId, organizationId],
    )).rows[0]!;
    expect(bill).toEqual({ paid: 8_000, status: "paid" });
  });

  it("blocks payment posting in a closed fiscal period", async () => {
    const year = await app.request("/api/v1/fiscal-years/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: "October 2026", startsOn: "2026-10-01", endsOn: "2026-10-31" }),
    });
    expect(year.status).toBe(201);
    const fiscalYearId = ((await year.json()) as { data: { id: string } }).data.id;
    const period = await app.request("/api/v1/periods/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ fiscalYearId, name: "October", startsOn: "2026-10-01", endsOn: "2026-10-31" }),
    });
    const periodId = ((await period.json()) as { data: { id: string } }).data.id;
    const close = await app.request(`/api/v1/periods/${periodId}/status`, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status: "closed", reason: "Month closed" }),
    });
    expect(close.status).toBe(200);

    const create = await app.request("/api/v1/payments/", {
      method: "POST",
      headers: { ...jsonHeaders(), "Idempotency-Key": "closed-period-receipt" },
      body: JSON.stringify({
        type: "receipt", number: "RCT-CLOSED", contactId: customerId, bankAccountId: cashId, controlAccountId: receivableId,
        paymentDate: "2026-10-05", currency: "UGX", amountMinor: 1_000,
      }),
    });
    expect(create.status).toBe(201);
    const paymentId = ((await create.json()) as { data: { id: string } }).data.id;
    const post = await app.request(`/api/v1/payments/${paymentId}/post`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [] }),
    });
    expect(post.status).toBe(409);
    const error = (await post.json()) as { error: { code: string } };
    expect(error.error.code).toBe("FISCAL_PERIOD_CLOSED");
    const payment = await runtime.db.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
    expect(payment.rows[0]?.status).toBe("draft");
  });
});

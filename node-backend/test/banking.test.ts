import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";
import { PlatformHealth } from "../src/health/service.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration.sequential("banking statements and reconciliation", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  let bearer: { Authorization: string };
  let organizationId: string;
  let cashId: string;
  let receivableId: string;
  let revenueId: string;
  let expenseId: string;
  let bankAccountId: string;
  let customerId: string;

  const jsonHeaders = () => ({ ...bearer, "Content-Type": "application/json" });

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    app = createApp({ environment: "test", corsOrigins: ["*"], health: new PlatformHealth(runtime), features, runtime });

    const register = await app.request("/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationName: "Banking Test", name: "Owner", email: "banking@example.test", password: "a-secure-password-123" }),
    });
    expect(register.status).toBe(201);
    organizationId = ((await register.json()) as { data: { organizationId: string } }).data.organizationId;
    const login = await app.request("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "banking@example.test", password: "a-secure-password-123" }),
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    bearer = { Authorization: `Bearer ${token}` };

    const accounts = await app.request("/api/v1/accounts/", { headers: bearer });
    const rows = ((await accounts.json()) as { data: Array<{ id: string; code: string }> }).data;
    cashId = rows.find((row) => row.code === "1000")!.id;
    receivableId = rows.find((row) => row.code === "1100")!.id;
    revenueId = rows.find((row) => row.code === "4000")!.id;
    expenseId = rows.find((row) => row.code === "6000")!.id;

    const bank = await app.request("/api/v1/banking/accounts", {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ ledgerAccountId: cashId, name: "Main Bank", bankName: "Test Bank", accountNumberMasked: "****1234", currency: "UGX", openingBalanceMinor: 0 }),
    });
    expect(bank.status).toBe(201);
    bankAccountId = ((await bank.json()) as { data: { id: string } }).data.id;

    const customer = await app.request("/api/v1/contacts/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ type: "customer", code: "BANK-CUS", name: "Banking Customer" }),
    });
    customerId = ((await customer.json()) as { data: { id: string } }).data.id;
  });

  afterAll(async () => { await runtime?.close(); });

  it("imports a receipt transaction, matches it and completes reconciliation", async () => {
    const invoice = await app.request("/api/v1/documents/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({
        type: "invoice", number: "INV-BANK-001", contactId: customerId, issueDate: "2026-09-13", currency: "UGX",
        lines: [{ accountId: revenueId, description: "Bank reconciliation sale", unitPriceMinor: 10000 }],
      }),
    });
    const invoiceId = ((await invoice.json()) as { data: { id: string } }).data.id;
    expect((await app.request(`/api/v1/documents/${invoiceId}/post`, { method: "POST", headers: jsonHeaders(), body: "{}" })).status).toBe(200);

    const payment = await app.request("/api/v1/payments/", {
      method: "POST", headers: { ...jsonHeaders(), "Idempotency-Key": "banking-receipt-1" },
      body: JSON.stringify({ type: "receipt", number: "RCPT-BANK-001", contactId: customerId, bankAccountId: cashId, controlAccountId: receivableId, paymentDate: "2026-09-13", currency: "UGX", amountMinor: 10000 }),
    });
    const paymentId = ((await payment.json()) as { data: { id: string } }).data.id;
    const posted = await app.request(`/api/v1/payments/${paymentId}/post`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ allocations: [{ documentId: invoiceId, amountMinor: 10000 }] }),
    });
    expect(posted.status).toBe(200);
    const journalEntryId = ((await posted.json()) as { data: { journalEntryId: string } }).data.journalEntryId;
    const cashLine = (await runtime.db.query<{ id: string }>(
      "SELECT id FROM journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND account_id=$3", [organizationId, journalEntryId, cashId],
    )).rows[0]!;

    const statementBody = {
      filename: "statement-2026-09-13.csv", statementStart: "2026-09-13", statementEnd: "2026-09-13", openingBalanceMinor: 0, closingBalanceMinor: 10000,
      transactions: [{ externalId: "BANK-TX-001", transactionDate: "2026-09-13", description: "Customer deposit", reference: "RCPT-BANK-001", amountMinor: 10000 }],
    };
    const imported = await app.request(`/api/v1/banking/accounts/${bankAccountId}/statements`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(statementBody) });
    expect(imported.status).toBe(201);
    const importedBody = (await imported.json()) as { data: { transactionCount: number; duplicateCount: number; balanceCheckDifferenceMinor: number | null } };
    expect(importedBody.data.transactionCount).toBe(1);
    expect(importedBody.data.duplicateCount).toBe(0);
    expect(importedBody.data.balanceCheckDifferenceMinor).toBe(0);

    const transactions = await app.request(`/api/v1/banking/accounts/${bankAccountId}/transactions`, { headers: bearer });
    const bankTxId = ((await transactions.json()) as { data: Array<{ id: string }> }).data[0]!.id;
    const matched = await app.request(`/api/v1/banking/transactions/${bankTxId}/match`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ journalLineId: cashLine.id }),
    });
    expect(matched.status).toBe(200);

    const preview = await app.request(`/api/v1/banking/accounts/${bankAccountId}/reconciliation-preview?statementDate=2026-09-13&statementBalanceMinor=10000`, { headers: bearer });
    const previewBody = (await preview.json()) as { data: { differenceMinor: number; matchedCount: number; unmatchedCount: number } };
    expect(previewBody.data).toMatchObject({ differenceMinor: 0, matchedCount: 1, unmatchedCount: 0 });

    const reconciliation = await app.request(`/api/v1/banking/accounts/${bankAccountId}/reconciliations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ statementDate: "2026-09-13", statementBalanceMinor: 10000, complete: true }),
    });
    expect(reconciliation.status).toBe(201);
    expect(((await reconciliation.json()) as { data: { status: string } }).data.status).toBe("completed");
    expect((await app.request(`/api/v1/banking/transactions/${bankTxId}/unmatch`, { method: "POST", headers: bearer })).status).toBe(409);

    const duplicate = await app.request(`/api/v1/banking/accounts/${bankAccountId}/statements`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(statementBody) });
    expect(duplicate.status).toBe(201);
    expect(((await duplicate.json()) as { data: { duplicateImport: boolean } }).data.duplicateImport).toBe(true);
  });

  it("posts bank charges, enforces signed matching and reconciles the next statement", async () => {
    const charge = await app.request(`/api/v1/banking/accounts/${bankAccountId}/charges`, {
      method: "POST", headers: { ...jsonHeaders(), "Idempotency-Key": "bank-charge-1" },
      body: JSON.stringify({ postingDate: "2026-09-14", amountMinor: 500, offsetAccountId: expenseId, description: "Bank service fee", reference: "FEE-001" }),
    });
    expect(charge.status).toBe(201);
    const journalEntryId = ((await charge.json()) as { data: { journalEntryId: string } }).data.journalEntryId;
    const bankLine = (await runtime.db.query<{ id: string }>(
      "SELECT id FROM journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND account_id=$3", [organizationId, journalEntryId, cashId],
    )).rows[0]!;

    await app.request(`/api/v1/banking/accounts/${bankAccountId}/statements`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({
        filename: "statement-2026-09-14.csv", statementStart: "2026-09-14", statementEnd: "2026-09-14", openingBalanceMinor: 10000, closingBalanceMinor: 9500,
        transactions: [{ externalId: "BANK-TX-FEE-001", transactionDate: "2026-09-14", description: "Bank service fee", amountMinor: -500 }],
      }),
    });
    const txs = await app.request(`/api/v1/banking/accounts/${bankAccountId}/transactions?status=unmatched`, { headers: bearer });
    const txId = ((await txs.json()) as { data: Array<{ id: string }> }).data.find(Boolean)!.id;
    const match = await app.request(`/api/v1/banking/transactions/${txId}/match`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ journalLineId: bankLine.id }) });
    expect(match.status).toBe(200);

    const rec = await app.request(`/api/v1/banking/accounts/${bankAccountId}/reconciliations`, {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ statementDate: "2026-09-14", statementBalanceMinor: 9500, complete: true }),
    });
    expect(rec.status).toBe(201);
    expect(((await rec.json()) as { data: { differenceMinor: number } }).data.differenceMinor).toBe(0);
  });

  it("supports same-currency transfers and respects closed fiscal periods", async () => {
    const secondLedger = await app.request("/api/v1/accounts/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ code: "1010", name: "Savings Bank", type: "asset", subtype: "cash", normalBalance: "debit", currency: "UGX", allowPosting: true, active: true }),
    });
    const secondLedgerId = ((await secondLedger.json()) as { data: { id: string } }).data.id;
    const secondBank = await app.request("/api/v1/banking/accounts", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ledgerAccountId: secondLedgerId, name: "Savings", currency: "UGX" }),
    });
    const secondBankId = ((await secondBank.json()) as { data: { id: string } }).data.id;
    const transfer = await app.request("/api/v1/banking/transfers", {
      method: "POST", headers: { ...jsonHeaders(), "Idempotency-Key": "bank-transfer-1" },
      body: JSON.stringify({ fromBankAccountId: bankAccountId, toBankAccountId: secondBankId, postingDate: "2026-09-15", amountMinor: 1000, reference: "MOVE-001" }),
    });
    expect(transfer.status).toBe(201);

    const period = await app.request("/api/v1/periods/", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: "Closed October", startsOn: "2026-10-01", endsOn: "2026-10-31" }),
    });
    const periodId = ((await period.json()) as { data: { id: string } }).data.id;
    expect((await app.request(`/api/v1/periods/${periodId}/status`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status: "closed", reason: "Month closed" }) })).status).toBe(200);
    const blocked = await app.request(`/api/v1/banking/accounts/${bankAccountId}/charges`, {
      method: "POST", headers: { ...jsonHeaders(), "Idempotency-Key": "closed-bank-charge" },
      body: JSON.stringify({ postingDate: "2026-10-10", amountMinor: 100, offsetAccountId: expenseId, description: "Blocked fee" }),
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("FISCAL_PERIOD_CLOSED");
  });
});

import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import {
  createBankCharge, createBankTransfer, createReconciliation, getBankAccount, importBankStatement,
  matchBankTransaction, reconciliationPreview, unmatchBankTransaction, validateBankLedgerAccount,
} from "./service.js";

const accountInput = z.object({
  ledgerAccountId: z.string().min(1), name: z.string().trim().min(1).max(160), bankName: z.string().trim().max(160).optional(),
  accountNumberMasked: z.string().trim().max(40).optional(), currency: z.string().length(3).transform((v) => v.toUpperCase()),
  openingBalanceMinor: z.number().int().default(0), active: z.boolean().default(true),
});
const accountPatch = accountInput.partial();
const statementInput = z.object({
  filename: z.string().trim().min(1).max(255), statementStart: z.iso.date().optional(), statementEnd: z.iso.date().optional(),
  openingBalanceMinor: z.number().int().optional(), closingBalanceMinor: z.number().int().optional(),
  transactions: z.array(z.object({
    externalId: z.string().trim().max(160).optional(), transactionDate: z.iso.date(), description: z.string().trim().min(1).max(1000),
    reference: z.string().trim().max(200).optional(), amountMinor: z.number().int().refine((value) => value !== 0, "amountMinor cannot be zero"),
  })).min(1).max(5000),
});
const matchInput = z.object({ journalLineId: z.string().min(1) });
const reconciliationInput = z.object({ statementDate: z.iso.date(), statementBalanceMinor: z.number().int(), complete: z.boolean().default(false) });
const cashInput = z.object({ postingDate: z.iso.date(), amountMinor: z.number().int().positive(), offsetAccountId: z.string().min(1), description: z.string().trim().min(1).max(500), reference: z.string().trim().max(100).optional() });
const transferInput = z.object({ fromBankAccountId: z.string().min(1), toBankAccountId: z.string().min(1), postingDate: z.iso.date(), amountMinor: z.number().int().positive(), reference: z.string().trim().max(100).optional() });

function pagination(c: { req: { query: (name: string) => string | undefined } }) {
  const rawLimit = Number(c.req.query("limit") ?? 100), rawOffset = Number(c.req.query("offset") ?? 0);
  return { limit: Number.isSafeInteger(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 100, offset: Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0 };
}

export function createBankingRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();

  router.get("/accounts", requireScope("accounts:read"), async (c) => {
    const p = c.get("principal");
    const rows = await runtime.db.query(
      `SELECT b.id,b.ledger_account_id AS "ledgerAccountId",b.name,b.bank_name AS "bankName",b.account_number_masked AS "accountNumberMasked",
        b.currency,b.opening_balance_minor::float8 AS "openingBalanceMinor",b.active,a.code AS "ledgerAccountCode",a.name AS "ledgerAccountName",
        (b.opening_balance_minor+COALESCE((SELECT SUM(l.debit_minor-l.credit_minor) FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id WHERE l.organization_id=b.organization_id AND l.account_id=b.ledger_account_id AND j.status IN ('posted','reversed')),0))::float8 AS "ledgerBalanceMinor"
       FROM bank_accounts b JOIN accounts a ON a.id=b.ledger_account_id AND a.organization_id=b.organization_id
       WHERE b.organization_id=$1 ORDER BY b.name`, [p.organizationId],
    );
    return c.json({ data: rows.rows });
  });

  router.post("/accounts", requireScope("accounts:write"), async (c) => {
    const parsed = accountInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid bank account", parsed.error.flatten());
    const p = c.get("principal"), v = parsed.data, id = createId("bnk");
    await validateBankLedgerAccount(runtime.db, p.organizationId, v.ledgerAccountId, v.currency);
    await runtime.db.query(
      `INSERT INTO bank_accounts(id,organization_id,ledger_account_id,name,bank_name,account_number_masked,currency,opening_balance_minor,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, p.organizationId, v.ledgerAccountId, v.name, v.bankName ?? null, v.accountNumberMasked ?? null, v.currency, v.openingBalanceMinor, v.active],
    );
    return c.json({ data: { id, ...v } }, 201);
  });

  router.get("/accounts/:id", requireScope("accounts:read"), async (c) => {
    const p = c.get("principal"), bank = await getBankAccount(runtime.db, p.organizationId, c.req.param("id"));
    const stats = (await runtime.db.query<{ unmatched: number; matched: number; reconciled: number }>(
      `SELECT COUNT(*) FILTER (WHERE status='unmatched')::int AS unmatched,COUNT(*) FILTER (WHERE status='matched')::int AS matched,
        COUNT(*) FILTER (WHERE status='reconciled')::int AS reconciled FROM bank_transactions WHERE organization_id=$1 AND bank_account_id=$2`,
      [p.organizationId, bank.id],
    )).rows[0] ?? { unmatched: 0, matched: 0, reconciled: 0 };
    return c.json({ data: { ...bank, transactionStats: stats } });
  });

  router.patch("/accounts/:id", requireScope("accounts:write"), async (c) => {
    const parsed = accountPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) throw new AppError(422, "VALIDATION_ERROR", "Invalid bank account update", parsed.success ? undefined : parsed.error.flatten());
    const p = c.get("principal"), id = c.req.param("id"), current = await getBankAccount(runtime.db, p.organizationId, id), v = parsed.data;
    const nextLedger = v.ledgerAccountId ?? current.ledgerAccountId, nextCurrency = v.currency ?? current.currency;
    await validateBankLedgerAccount(runtime.db, p.organizationId, nextLedger, nextCurrency);
    if ((nextLedger !== current.ledgerAccountId || nextCurrency !== current.currency || (v.openingBalanceMinor !== undefined && v.openingBalanceMinor !== current.openingBalanceMinor))) {
      const used = await runtime.db.query(`SELECT 1 FROM bank_transactions WHERE organization_id=$1 AND bank_account_id=$2 LIMIT 1`, [p.organizationId, id]);
      if (used.rowCount) throw new AppError(409, "BANK_ACCOUNT_IN_USE", "Ledger account, currency and opening balance cannot change after statement transactions exist");
    }
    await runtime.db.query(
      `UPDATE bank_accounts SET ledger_account_id=$1,name=$2,bank_name=$3,account_number_masked=$4,currency=$5,opening_balance_minor=$6,active=$7,updated_at=CURRENT_TIMESTAMP
       WHERE id=$8 AND organization_id=$9`,
      [nextLedger, v.name ?? current.name, v.bankName === undefined ? current.bankName : v.bankName ?? null,
        v.accountNumberMasked === undefined ? current.accountNumberMasked : v.accountNumberMasked ?? null, nextCurrency,
        v.openingBalanceMinor ?? current.openingBalanceMinor, v.active ?? current.active, id, p.organizationId],
    );
    return c.json({ data: await getBankAccount(runtime.db, p.organizationId, id) });
  });

  router.post("/accounts/:id/statements", requireScope("payments:write"), async (c) => {
    const parsed = statementInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid bank statement", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await importBankStatement(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data) }, 201);
  });

  router.get("/accounts/:id/statements", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id"); await getBankAccount(runtime.db, p.organizationId, id);
    const rows = await runtime.db.query(
      `SELECT id,filename,statement_start::text AS "statementStart",statement_end::text AS "statementEnd",opening_balance_minor::float8 AS "openingBalanceMinor",
        closing_balance_minor::float8 AS "closingBalanceMinor",transaction_count AS "transactionCount",duplicate_count AS "duplicateCount",status,
        imported_by AS "importedBy",created_at AS "createdAt" FROM bank_statement_imports
       WHERE organization_id=$1 AND bank_account_id=$2 ORDER BY created_at DESC`, [p.organizationId, id],
    );
    return c.json({ data: rows.rows });
  });

  router.get("/statements/:id", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id");
    const statement = (await runtime.db.query(
      `SELECT id,bank_account_id AS "bankAccountId",filename,statement_start::text AS "statementStart",statement_end::text AS "statementEnd",
        opening_balance_minor::float8 AS "openingBalanceMinor",closing_balance_minor::float8 AS "closingBalanceMinor",transaction_count AS "transactionCount",
        duplicate_count AS "duplicateCount",status,imported_by AS "importedBy",created_at AS "createdAt"
       FROM bank_statement_imports WHERE id=$1 AND organization_id=$2`, [id, p.organizationId],
    )).rows[0];
    if (!statement) throw new AppError(404, "NOT_FOUND", "Bank statement import not found");
    const counts = await runtime.db.query(`SELECT status,COUNT(*)::int AS count FROM bank_transactions WHERE import_id=$1 AND organization_id=$2 GROUP BY status`, [id, p.organizationId]);
    return c.json({ data: { ...statement, transactionStatusCounts: counts.rows } });
  });

  router.get("/accounts/:id/transactions", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), bankId = c.req.param("id"), { limit, offset } = pagination(c), status = c.req.query("status"), from = c.req.query("from"), to = c.req.query("to");
    await getBankAccount(runtime.db, p.organizationId, bankId);
    if (status && !["unmatched", "matched", "reconciled"].includes(status)) throw new AppError(422, "VALIDATION_ERROR", "Invalid transaction status");
    const params: unknown[] = [p.organizationId, bankId]; const where = ["t.organization_id=$1", "t.bank_account_id=$2"];
    if (status) { params.push(status); where.push(`t.status=$${params.length}`); }
    if (from) { params.push(from); where.push(`t.transaction_date>=$${params.length}::date`); }
    if (to) { params.push(to); where.push(`t.transaction_date<=$${params.length}::date`); }
    params.push(limit, offset);
    const rows = await runtime.db.query(
      `SELECT t.id,t.import_id AS "importId",t.external_id AS "externalId",t.transaction_date::text AS "transactionDate",t.description,t.reference,
        t.amount_minor::float8 AS "amountMinor",t.status,t.matched_journal_line_id AS "matchedJournalLineId",t.matched_at AS "matchedAt",
        t.reconciliation_id AS "reconciliationId",t.reconciled_at AS "reconciledAt"
       FROM bank_transactions t WHERE ${where.join(" AND ")} ORDER BY t.transaction_date DESC,t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return c.json({ data: rows.rows, pagination: { limit, offset } });
  });

  router.post("/transactions/:id/match", requireScope("payments:write"), async (c) => {
    const parsed = matchInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Journal line required", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await matchBankTransaction(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.journalLineId) });
  });

  router.post("/transactions/:id/unmatch", requireScope("payments:write"), async (c) => {
    const p = c.get("principal");
    return c.json({ data: await unmatchBankTransaction(runtime, p.organizationId, p.userId, c.req.param("id")) });
  });

  router.get("/accounts/:id/reconciliation-preview", requireScope("payments:read"), async (c) => {
    const parsed = z.object({ statementDate: z.iso.date(), statementBalanceMinor: z.coerce.number().int() }).safeParse({ statementDate: c.req.query("statementDate"), statementBalanceMinor: c.req.query("statementBalanceMinor") });
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "statementDate and statementBalanceMinor are required", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await reconciliationPreview(runtime, p.organizationId, c.req.param("id"), parsed.data.statementDate, parsed.data.statementBalanceMinor) });
  });

  router.post("/accounts/:id/reconciliations", requireScope("payments:write"), async (c) => {
    const parsed = reconciliationInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid reconciliation", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createReconciliation(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.statementDate, parsed.data.statementBalanceMinor, parsed.data.complete) }, 201);
  });

  router.get("/accounts/:id/reconciliation-statement", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id"); await getBankAccount(runtime.db, p.organizationId, id);
    const rows = await runtime.db.query(
      `SELECT id,statement_date::text AS "statementDate",statement_balance_minor::float8 AS "statementBalanceMinor",ledger_balance_minor::float8 AS "ledgerBalanceMinor",
        difference_minor::float8 AS "differenceMinor",matched_count AS "matchedCount",unmatched_count AS "unmatchedCount",status,completed_at AS "completedAt",created_at AS "createdAt"
       FROM bank_reconciliations WHERE organization_id=$1 AND bank_account_id=$2 ORDER BY statement_date DESC,created_at DESC`, [p.organizationId, id],
    );
    return c.json({ data: rows.rows });
  });

  router.post("/accounts/:id/charges", requireScope("payments:write"), async (c) => {
    const parsed = cashInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid bank charge", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createBankCharge(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data, c.req.header("Idempotency-Key")) }, 201);
  });

  router.post("/transfers", requireScope("payments:write"), async (c) => {
    const parsed = transferInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid transfer", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createBankTransfer(runtime, p.organizationId, p.userId, parsed.data, c.req.header("Idempotency-Key")) }, 201);
  });

  return router;
}

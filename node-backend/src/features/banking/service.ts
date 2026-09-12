import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { createJournal, postJournal } from "../finance-core/service.js";

type Db = Pool | PoolClient;
export type BankStatementTransactionInput = {
  externalId?: string;
  transactionDate: string;
  description: string;
  reference?: string;
  amountMinor: number;
};
export type StatementImportInput = {
  filename: string;
  statementStart?: string;
  statementEnd?: string;
  openingBalanceMinor?: number;
  closingBalanceMinor?: number;
  transactions: BankStatementTransactionInput[];
};

type BankAccountRow = {
  id: string;
  ledgerAccountId: string;
  name: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  currency: string;
  openingBalanceMinor: number;
  active: boolean;
};

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityType: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityType, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

async function outbox(db: Db, topic: string, aggregateId: string, payload: unknown) {
  await db.query(
    `INSERT INTO backend_outbox_events(id,topic,aggregate_type,aggregate_id,payload)
     VALUES($1,$2,'banking',$3,$4::jsonb)`,
    [createId("evt"), topic, aggregateId, JSON.stringify(payload)],
  );
}

export async function getBankAccount(db: Db, organizationId: string, id: string, forUpdate = false): Promise<BankAccountRow> {
  const row = (await db.query<BankAccountRow>(
    `SELECT id,ledger_account_id AS "ledgerAccountId",name,bank_name AS "bankName",account_number_masked AS "accountNumberMasked",
      currency,opening_balance_minor::float8 AS "openingBalanceMinor",active
     FROM bank_accounts WHERE id=$1 AND organization_id=$2${forUpdate ? " FOR UPDATE" : ""}`,
    [id, organizationId],
  )).rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Bank account not found");
  return row;
}

export async function validateBankLedgerAccount(db: Db, organizationId: string, ledgerAccountId: string, currency: string) {
  const row = (await db.query<{ type: string; currency: string | null; active: boolean; allowPosting: boolean }>(
    `SELECT type,currency,active,allow_posting AS "allowPosting" FROM accounts WHERE id=$1 AND organization_id=$2`,
    [ledgerAccountId, organizationId],
  )).rows[0];
  if (!row || row.type !== "asset" || !row.active || !row.allowPosting) {
    throw new AppError(422, "INVALID_LEDGER_ACCOUNT", "An active posting asset ledger account is required");
  }
  if (row.currency && row.currency !== currency) {
    throw new AppError(422, "BANK_CURRENCY_MISMATCH", "Bank account currency must match the linked ledger account currency");
  }
}

function statementFingerprint(input: StatementImportInput) {
  const transactions = input.transactions.map((row) => [row.externalId ?? "", row.transactionDate, row.description.trim(), row.reference ?? "", row.amountMinor].join("\u001f")).sort();
  return createHash("sha256").update(JSON.stringify({
    filename: input.filename.trim(), statementStart: input.statementStart ?? null, statementEnd: input.statementEnd ?? null,
    openingBalanceMinor: input.openingBalanceMinor ?? null, closingBalanceMinor: input.closingBalanceMinor ?? null, transactions,
  })).digest("hex");
}

export async function importBankStatement(runtime: Runtime, organizationId: string, actorId: string, bankAccountId: string, input: StatementImportInput) {
  if (input.statementStart && input.statementEnd && input.statementStart > input.statementEnd) {
    throw new AppError(422, "INVALID_STATEMENT_RANGE", "statementStart cannot be after statementEnd");
  }
  const fingerprint = statementFingerprint(input);
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await getBankAccount(client, organizationId, bankAccountId, true);
    const existing = (await client.query<{ id: string; transactionCount: number; duplicateCount: number; status: string }>(
      `SELECT id,transaction_count AS "transactionCount",duplicate_count AS "duplicateCount",status
       FROM bank_statement_imports WHERE organization_id=$1 AND bank_account_id=$2 AND import_fingerprint=$3`,
      [organizationId, bankAccountId, fingerprint],
    )).rows[0];
    if (existing) {
      await client.query("COMMIT");
      return { ...existing, duplicateImport: true };
    }

    const id = createId("bsi");
    await client.query(
      `INSERT INTO bank_statement_imports(id,organization_id,bank_account_id,filename,statement_start,statement_end,opening_balance_minor,
        closing_balance_minor,import_fingerprint,imported_by)
       VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10)`,
      [id, organizationId, bankAccountId, input.filename.trim(), input.statementStart ?? null, input.statementEnd ?? null,
        input.openingBalanceMinor ?? null, input.closingBalanceMinor ?? null, fingerprint, actorId],
    );

    let inserted = 0, duplicates = 0;
    const seen = new Set<string>();
    for (const row of input.transactions) {
      const localKey = row.externalId ? `external:${row.externalId}` : `row:${row.transactionDate}|${row.description}|${row.reference ?? ""}|${row.amountMinor}`;
      if (seen.has(localKey)) { duplicates += 1; continue; }
      seen.add(localKey);
      const result = row.externalId
        ? await client.query(
          `INSERT INTO bank_transactions(id,organization_id,bank_account_id,import_id,external_id,transaction_date,description,reference,amount_minor)
           VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9)
           ON CONFLICT (organization_id,bank_account_id,external_id) WHERE external_id IS NOT NULL DO NOTHING`,
          [createId("btx"), organizationId, bankAccountId, id, row.externalId, row.transactionDate, row.description.trim(), row.reference ?? null, row.amountMinor],
        )
        : await client.query(
          `INSERT INTO bank_transactions(id,organization_id,bank_account_id,import_id,external_id,transaction_date,description,reference,amount_minor)
           VALUES($1,$2,$3,$4,NULL,$5::date,$6,$7,$8)`,
          [createId("btx"), organizationId, bankAccountId, id, row.transactionDate, row.description.trim(), row.reference ?? null, row.amountMinor],
        );
      if (result.rowCount) inserted += 1; else duplicates += 1;
    }
    await client.query(
      `UPDATE bank_statement_imports SET transaction_count=$1,duplicate_count=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4`,
      [inserted, duplicates, id, organizationId],
    );
    const movementMinor = input.transactions.reduce((sum, row) => sum + row.amountMinor, 0);
    const balanceCheckDifferenceMinor = input.openingBalanceMinor !== undefined && input.closingBalanceMinor !== undefined
      ? input.closingBalanceMinor - input.openingBalanceMinor - movementMinor : null;
    await audit(client, organizationId, actorId, "bank.statement_imported", "bank_statement_import", id, { bankAccountId, inserted, duplicates });
    await outbox(client, "bank.statement_imported", id, { importId: id, bankAccountId, transactionCount: inserted, duplicateCount: duplicates });
    await client.query("COMMIT");
    return { id, transactionCount: inserted, duplicateCount: duplicates, status: "imported" as const, movementMinor, balanceCheckDifferenceMinor, duplicateImport: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function matchBankTransaction(runtime: Runtime, organizationId: string, actorId: string, transactionId: string, journalLineId: string) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const transaction = (await client.query<{ id: string; bankAccountId: string; amountMinor: number; status: string }>(
      `SELECT id,bank_account_id AS "bankAccountId",amount_minor::float8 AS "amountMinor",status
       FROM bank_transactions WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [transactionId, organizationId],
    )).rows[0];
    if (!transaction) throw new AppError(404, "NOT_FOUND", "Bank transaction not found");
    if (transaction.status !== "unmatched") throw new AppError(409, "MATCH_FAILED", "Bank transaction is already matched or reconciled");
    const bank = await getBankAccount(client, organizationId, transaction.bankAccountId);
    const line = (await client.query<{ accountId: string; amountMinor: number; currency: string; status: string }>(
      `SELECT l.account_id AS "accountId",(l.debit_minor-l.credit_minor)::float8 AS "amountMinor",j.currency,j.status
       FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       WHERE l.id=$1 AND l.organization_id=$2`,
      [journalLineId, organizationId],
    )).rows[0];
    if (!line || line.status !== "posted") throw new AppError(422, "BANK_MATCH_LINE_INVALID", "A posted journal line is required");
    if (line.accountId !== bank.ledgerAccountId) throw new AppError(422, "BANK_MATCH_ACCOUNT_MISMATCH", "Journal line must use the bank account's linked ledger account");
    if (line.currency !== bank.currency) throw new AppError(422, "BANK_MATCH_CURRENCY_MISMATCH", "Journal currency must match the bank account currency");
    if (line.amountMinor !== transaction.amountMinor) throw new AppError(422, "BANK_MATCH_AMOUNT_MISMATCH", "Journal line amount must equal the signed bank transaction amount", { bankAmountMinor: transaction.amountMinor, journalAmountMinor: line.amountMinor });
    const result = await client.query(
      `UPDATE bank_transactions SET status='matched',matched_journal_line_id=$1,matched_at=CURRENT_TIMESTAMP,matched_by=$2,updated_at=CURRENT_TIMESTAMP
       WHERE id=$3 AND organization_id=$4 AND status='unmatched'`,
      [journalLineId, actorId, transactionId, organizationId],
    );
    if (!result.rowCount) throw new AppError(409, "MATCH_FAILED", "Bank transaction was matched by another request");
    await audit(client, organizationId, actorId, "bank.transaction_matched", "bank_transaction", transactionId, { journalLineId });
    await client.query("COMMIT");
    return { id: transactionId, status: "matched" as const, matchedJournalLineId: journalLineId };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function unmatchBankTransaction(runtime: Runtime, organizationId: string, actorId: string, transactionId: string) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query<{ status: string }>("SELECT status FROM bank_transactions WHERE id=$1 AND organization_id=$2 FOR UPDATE", [transactionId, organizationId])).rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Bank transaction not found");
    if (row.status === "reconciled") throw new AppError(409, "RECONCILED_TRANSACTION_IMMUTABLE", "A reconciled bank transaction cannot be unmatched");
    if (row.status !== "matched") throw new AppError(409, "INVALID_STATE", "Only a matched bank transaction can be unmatched");
    await client.query(
      `UPDATE bank_transactions SET status='unmatched',matched_journal_line_id=NULL,matched_at=NULL,matched_by=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND organization_id=$2`, [transactionId, organizationId],
    );
    await audit(client, organizationId, actorId, "bank.transaction_unmatched", "bank_transaction", transactionId);
    await client.query("COMMIT");
    return { id: transactionId, status: "unmatched" as const };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function reconciliationPreviewWithDb(db: Db, organizationId: string, bankAccountId: string, statementDate: string, statementBalanceMinor: number) {
  const bank = await getBankAccount(db, organizationId, bankAccountId);
  const movement = Number((await db.query<{ amount: number }>(
    `SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0)::float8 AS amount
     FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
     WHERE l.organization_id=$1 AND l.account_id=$2 AND j.status IN ('posted','reversed') AND j.posting_date<=$3::date`,
    [organizationId, bank.ledgerAccountId, statementDate],
  )).rows[0]?.amount ?? 0);
  const ledgerBalanceMinor = bank.openingBalanceMinor + movement;
  const counts = (await db.query<{ matched: number; unmatched: number }>(
    `SELECT COUNT(*) FILTER (WHERE status='matched')::int AS matched,COUNT(*) FILTER (WHERE status='unmatched')::int AS unmatched
     FROM bank_transactions WHERE organization_id=$1 AND bank_account_id=$2 AND transaction_date<=$3::date AND status IN ('matched','unmatched')`,
    [organizationId, bankAccountId, statementDate],
  )).rows[0] ?? { matched: 0, unmatched: 0 };
  const statementMovementMinor = Number((await db.query<{ amount: number }>(
    `SELECT COALESCE(SUM(amount_minor),0)::float8 AS amount FROM bank_transactions
     WHERE organization_id=$1 AND bank_account_id=$2 AND transaction_date<=$3::date`,
    [organizationId, bankAccountId, statementDate],
  )).rows[0]?.amount ?? 0);
  return {
    bankAccountId, statementDate, statementBalanceMinor, ledgerBalanceMinor,
    differenceMinor: statementBalanceMinor - ledgerBalanceMinor,
    matchedCount: Number(counts.matched ?? 0), unmatchedCount: Number(counts.unmatched ?? 0),
    importedStatementBalanceMinor: bank.openingBalanceMinor + statementMovementMinor,
  };
}

export async function reconciliationPreview(runtime: Runtime, organizationId: string, bankAccountId: string, statementDate: string, statementBalanceMinor: number) {
  return reconciliationPreviewWithDb(runtime.db, organizationId, bankAccountId, statementDate, statementBalanceMinor);
}

export async function createReconciliation(runtime: Runtime, organizationId: string, actorId: string, bankAccountId: string, statementDate: string, statementBalanceMinor: number, complete: boolean) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`bank-reconcile:${organizationId}:${bankAccountId}`]);
    await getBankAccount(client, organizationId, bankAccountId, true);
    const preview = await reconciliationPreviewWithDb(client, organizationId, bankAccountId, statementDate, statementBalanceMinor);
    if (complete && preview.differenceMinor !== 0) {
      throw new AppError(409, "RECONCILIATION_DIFFERENCE", "A reconciliation can only complete at zero difference", { differenceMinor: preview.differenceMinor });
    }
    if (complete && preview.unmatchedCount !== 0) {
      throw new AppError(409, "RECONCILIATION_UNMATCHED_TRANSACTIONS", "Match all imported bank transactions through the statement date before completing reconciliation", { unmatchedCount: preview.unmatchedCount });
    }
    const id = createId("rec");
    await client.query(
      `INSERT INTO bank_reconciliations(id,organization_id,bank_account_id,statement_date,statement_balance_minor,ledger_balance_minor,difference_minor,
        matched_count,unmatched_count,status,prepared_by,completed_at)
       VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, organizationId, bankAccountId, statementDate, statementBalanceMinor, preview.ledgerBalanceMinor, preview.differenceMinor,
        preview.matchedCount, preview.unmatchedCount, complete ? "completed" : "draft", actorId, complete ? new Date().toISOString() : null],
    );
    if (complete) {
      await client.query(
        `INSERT INTO bank_reconciliation_items(id,organization_id,reconciliation_id,bank_transaction_id,journal_line_id,amount_minor)
         SELECT 'rci_'||replace(gen_random_uuid()::text,'-',''),organization_id,$1,id,matched_journal_line_id,amount_minor
         FROM bank_transactions
         WHERE organization_id=$2 AND bank_account_id=$3 AND transaction_date<=$4::date AND status='matched'`,
        [id, organizationId, bankAccountId, statementDate],
      );
      await client.query(
        `UPDATE bank_transactions SET status='reconciled',reconciliation_id=$1,reconciled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE organization_id=$2 AND bank_account_id=$3 AND transaction_date<=$4::date AND status='matched'`,
        [id, organizationId, bankAccountId, statementDate],
      );
      await client.query(
        `UPDATE bank_statement_imports i SET status='reconciled',updated_at=CURRENT_TIMESTAMP
         WHERE i.organization_id=$1 AND i.bank_account_id=$2
           AND EXISTS(SELECT 1 FROM bank_transactions t WHERE t.import_id=i.id)
           AND NOT EXISTS(SELECT 1 FROM bank_transactions t WHERE t.import_id=i.id AND t.status<>'reconciled')`,
        [organizationId, bankAccountId],
      );
      await outbox(client, "bank.reconciliation.completed", id, { reconciliationId: id, bankAccountId, statementDate, statementBalanceMinor });
    }
    await audit(client, organizationId, actorId, complete ? "bank.reconciliation_completed" : "bank.reconciliation_created", "bank_reconciliation", id, preview);
    await client.query("COMMIT");
    return { id, ...preview, status: complete ? "completed" as const : "draft" as const };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function createBankCharge(runtime: Runtime, organizationId: string, actorId: string, bankAccountId: string, input: { postingDate: string; amountMinor: number; offsetAccountId: string; description: string; reference?: string }, idempotencyKey?: string) {
  const bank = await getBankAccount(runtime.db, organizationId, bankAccountId);
  if (!bank.active) throw new AppError(409, "BANK_ACCOUNT_INACTIVE", "Bank account is inactive");
  const journal = await createJournal(runtime, organizationId, actorId, {
    transactionDate: input.postingDate, postingDate: input.postingDate, description: input.description, reference: input.reference,
    currency: bank.currency, sourceType: "bank_charge", sourceId: bankAccountId,
    lines: [
      { accountId: input.offsetAccountId, debitMinor: input.amountMinor, description: input.description },
      { accountId: bank.ledgerAccountId, creditMinor: input.amountMinor, description: input.description },
    ],
  }, `bank-charge:${idempotencyKey ?? createId("key")}`);
  if (journal.status === "draft") await postJournal(runtime, organizationId, actorId, journal.id);
  return { journalEntryId: journal.id, status: "posted" as const };
}

export async function createBankTransfer(runtime: Runtime, organizationId: string, actorId: string, input: { fromBankAccountId: string; toBankAccountId: string; postingDate: string; amountMinor: number; reference?: string }, idempotencyKey?: string) {
  if (input.fromBankAccountId === input.toBankAccountId) throw new AppError(422, "VALIDATION_ERROR", "Source and destination bank accounts must differ");
  const rows = await runtime.db.query<BankAccountRow>(
    `SELECT id,ledger_account_id AS "ledgerAccountId",name,bank_name AS "bankName",account_number_masked AS "accountNumberMasked",currency,
      opening_balance_minor::float8 AS "openingBalanceMinor",active FROM bank_accounts
     WHERE organization_id=$1 AND id=ANY($2::text[])`, [organizationId, [input.fromBankAccountId, input.toBankAccountId]],
  );
  if (rows.rows.length !== 2 || rows.rows.some((row) => !row.active)) throw new AppError(422, "INVALID_BANK_ACCOUNTS", "Both bank accounts must exist and be active");
  const from = rows.rows.find((row) => row.id === input.fromBankAccountId)!;
  const to = rows.rows.find((row) => row.id === input.toBankAccountId)!;
  if (from.currency !== to.currency) throw new AppError(422, "INVALID_BANK_ACCOUNTS", "Bank accounts must share a currency");
  const journal = await createJournal(runtime, organizationId, actorId, {
    transactionDate: input.postingDate, postingDate: input.postingDate, description: "Bank transfer", reference: input.reference,
    currency: from.currency, sourceType: "bank_transfer", sourceId: `${from.id}:${to.id}`,
    lines: [
      { accountId: to.ledgerAccountId, debitMinor: input.amountMinor, description: `Transfer from ${from.name}` },
      { accountId: from.ledgerAccountId, creditMinor: input.amountMinor, description: `Transfer to ${to.name}` },
    ],
  }, `bank-transfer:${idempotencyKey ?? createId("key")}`);
  if (journal.status === "draft") await postJournal(runtime, organizationId, actorId, journal.id);
  return { journalEntryId: journal.id, status: "posted" as const };
}

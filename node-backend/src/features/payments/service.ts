import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { createJournal, postJournal, type JournalLineInput } from "../finance-core/service.js";

type Db = Pool | PoolClient;
export type PaymentType = "receipt" | "payment";
export type PaymentInput = {
  type: PaymentType;
  number: string;
  contactId: string;
  bankAccountId: string;
  controlAccountId: string;
  paymentDate: string;
  currency: string;
  amountMinor: number;
  reference?: string;
};
export type AllocationInput = { documentId: string; amountMinor: number };

type PaymentRow = {
  id: string;
  type: PaymentType;
  number: string;
  contactId: string;
  bankAccountId: string;
  controlAccountId: string;
  paymentDate: string;
  currency: string;
  amountMinor: number;
  reference: string | null;
  status: "draft" | "posted" | "reversed";
  journalEntryId: string | null;
  reversalJournalId: string | null;
};

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,'payment',$5,$6::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

async function outbox(db: Db, topic: string, paymentId: string, payload: unknown) {
  await db.query(
    `INSERT INTO backend_outbox_events(id,topic,aggregate_type,aggregate_id,payload)
     VALUES($1,$2,'payment',$3,$4::jsonb)`,
    [createId("evt"), topic, paymentId, JSON.stringify(payload)],
  );
}

async function fetchPayment(db: Db, organizationId: string, id: string, forUpdate = false): Promise<PaymentRow | undefined> {
  return (await db.query<PaymentRow>(
    `SELECT id,type,number,contact_id AS "contactId",bank_account_id AS "bankAccountId",control_account_id AS "controlAccountId",
      payment_date::text AS "paymentDate",currency,amount_minor::float8 AS "amountMinor",reference,status,
      journal_entry_id AS "journalEntryId",reversal_journal_id AS "reversalJournalId"
     FROM payments WHERE id=$1 AND organization_id=$2${forUpdate ? " FOR UPDATE" : ""}`,
    [id, organizationId],
  )).rows[0];
}

export async function paymentBalance(runtime: Runtime, organizationId: string, id: string) {
  const row = (await runtime.db.query<{
    amountMinor: number; allocatedMinor: number; status: string;
  }>(
    `SELECT p.amount_minor::float8 AS "amountMinor",p.status,
      COALESCE(SUM(a.amount_minor) FILTER (WHERE a.reversed_at IS NULL),0)::float8 AS "allocatedMinor"
     FROM payments p LEFT JOIN payment_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id
     WHERE p.id=$1 AND p.organization_id=$2 GROUP BY p.id,p.amount_minor,p.status`,
    [id, organizationId],
  )).rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Payment not found");
  return { ...row, unallocatedMinor: row.amountMinor - row.allocatedMinor };
}

export async function createPayment(runtime: Runtime, organizationId: string, actorId: string, input: PaymentInput, idempotencyKey: string) {
  const existing = (await runtime.db.query<{ id: string; number: string; status: string }>(
    `SELECT id,number,status FROM payments WHERE organization_id=$1 AND idempotency_key=$2`,
    [organizationId, idempotencyKey],
  )).rows[0];
  if (existing) return existing;

  const allowedContacts = input.type === "receipt" ? ["customer"] : ["supplier", "employee"];
  const contact = (await runtime.db.query<{ type: string }>(
    `SELECT type FROM contacts WHERE id=$1 AND organization_id=$2 AND active=true AND archived_at IS NULL`,
    [input.contactId, organizationId],
  )).rows[0];
  if (!contact || !allowedContacts.includes(contact.type)) {
    throw new AppError(422, "INVALID_CONTACT", input.type === "receipt" ? "An active customer contact is required" : "An active supplier or employee contact is required");
  }

  const accountIds = [...new Set([input.bankAccountId, input.controlAccountId])];
  const accounts = await runtime.db.query<{ id: string; subtype: string | null }>(
    `SELECT id,subtype FROM accounts WHERE organization_id=$1 AND id=ANY($2::text[]) AND active=true AND allow_posting=true`,
    [organizationId, accountIds],
  );
  if (accounts.rows.length !== accountIds.length) throw new AppError(422, "INVALID_ACCOUNT", "Payment accounts must be active posting accounts");
  if (!accounts.rows.some((account) => account.id === input.bankAccountId && account.subtype === "cash")) {
    throw new AppError(422, "INVALID_BANK_ACCOUNT", "Bank account must use the cash subtype");
  }
  const controlSubtype = input.type === "receipt" ? "receivable" : "payable";
  if (!accounts.rows.some((account) => account.id === input.controlAccountId && account.subtype === controlSubtype)) {
    throw new AppError(422, "INVALID_CONTROL_ACCOUNT", `Control account must use the ${controlSubtype} subtype`);
  }

  const id = createId("pay");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO payments(id,organization_id,type,number,contact_id,bank_account_id,control_account_id,payment_date,currency,amount_minor,reference,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12)`,
      [id, organizationId, input.type, input.number, input.contactId, input.bankAccountId, input.controlAccountId, input.paymentDate, input.currency, input.amountMinor, input.reference ?? null, idempotencyKey],
    );
    await audit(client, organizationId, actorId, "payment.created", id, { type: input.type, number: input.number, amountMinor: input.amountMinor });
    await client.query("COMMIT");
    return { id, number: input.number, status: "draft" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "23505") {
      const retry = (await runtime.db.query<{ id: string; number: string; status: string }>(
        `SELECT id,number,status FROM payments WHERE organization_id=$1 AND idempotency_key=$2`,
        [organizationId, idempotencyKey],
      )).rows[0];
      if (retry) return retry;
    }
    throw error;
  } finally {
    client.release();
  }
}

function validateAllocationShape(allocations: AllocationInput[]) {
  const ids = new Set(allocations.map((allocation) => allocation.documentId));
  if (ids.size !== allocations.length) throw new AppError(422, "DUPLICATE_ALLOCATION", "Each document may appear once per allocation request");
  if (allocations.some((allocation) => !Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor <= 0)) {
    throw new AppError(422, "INVALID_ALLOCATION", "Allocation amounts must be positive safe integers");
  }
}

async function validateAllocations(client: PoolClient, organizationId: string, payment: PaymentRow, allocations: AllocationInput[]) {
  validateAllocationShape(allocations);
  const used = Number((await client.query<{ amount: number }>(
    `SELECT COALESCE(SUM(amount_minor),0)::float8 AS amount FROM payment_allocations
     WHERE organization_id=$1 AND payment_id=$2 AND reversed_at IS NULL`,
    [organizationId, payment.id],
  )).rows[0]?.amount ?? 0);
  const requested = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (!Number.isSafeInteger(requested) || requested > payment.amountMinor - used) {
    throw new AppError(422, "INVALID_ALLOCATION", "Allocations exceed the unallocated payment balance", { unallocatedMinor: payment.amountMinor - used });
  }

  const expectedType = payment.type === "receipt" ? "invoice" : "bill";
  for (const allocation of allocations) {
    const document = (await client.query<{ id: string; totalMinor: number; paidMinor: number }>(
      `SELECT id,total_minor::float8 AS "totalMinor",paid_minor::float8 AS "paidMinor" FROM documents
       WHERE id=$1 AND organization_id=$2 AND contact_id=$3 AND type=$4 AND currency=$5
         AND status IN ('open','partially_paid') FOR UPDATE`,
      [allocation.documentId, organizationId, payment.contactId, expectedType, payment.currency],
    )).rows[0];
    if (!document) throw new AppError(422, "INVALID_ALLOCATION_DOCUMENT", "Allocation document is not open or does not match the payment", { documentId: allocation.documentId });
    const outstanding = document.totalMinor - document.paidMinor;
    if (allocation.amountMinor > outstanding) {
      throw new AppError(422, "OVER_ALLOCATION", "Allocation exceeds the document outstanding balance", { documentId: document.id, outstandingMinor: outstanding });
    }
  }
  return { usedMinor: used, requestedMinor: requested };
}

async function acquirePaymentLock(runtime: Runtime, organizationId: string, id: string, purpose: string) {
  const client = await runtime.db.connect();
  const key = `payment:${purpose}:${organizationId}:${id}`;
  await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [key]);
  return { client, key };
}

async function releasePaymentLock(client: PoolClient, key: string) {
  try { await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [key]); } finally { client.release(); }
}

export async function postPayment(runtime: Runtime, organizationId: string, actorId: string, id: string, allocations: AllocationInput[]) {
  const lock = await acquirePaymentLock(runtime, organizationId, id, "post");
  try {
    await lock.client.query("BEGIN");
    const payment = await fetchPayment(lock.client, organizationId, id, true);
    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    if (payment.status === "posted") {
      await lock.client.query("COMMIT");
      const balance = await paymentBalance(runtime, organizationId, id);
      return { id, status: "posted", journalEntryId: payment.journalEntryId, ...balance };
    }
    if (payment.status !== "draft") throw new AppError(409, "INVALID_STATE", "Only draft payments can be posted");
    const allocationState = await validateAllocations(lock.client, organizationId, payment, allocations);

    const receipt = payment.type === "receipt";
    const narration = `${receipt ? "Receipt" : "Payment"} ${payment.number}`;
    const lines: JournalLineInput[] = [
      { accountId: payment.bankAccountId, description: narration, contactId: payment.contactId, ...(receipt ? { debitMinor: payment.amountMinor } : { creditMinor: payment.amountMinor }) },
      { accountId: payment.controlAccountId, description: narration, contactId: payment.contactId, ...(receipt ? { creditMinor: payment.amountMinor } : { debitMinor: payment.amountMinor }) },
    ];
    const journal = await createJournal(runtime, organizationId, actorId, {
      transactionDate: payment.paymentDate,
      postingDate: payment.paymentDate,
      description: narration,
      reference: payment.reference ?? payment.number,
      currency: payment.currency,
      sourceType: payment.type,
      sourceId: id,
      lines,
    }, `payment:${id}:post`);
    if (journal.status === "draft") await postJournal(runtime, organizationId, actorId, journal.id);

    const updated = await lock.client.query(
      `UPDATE payments SET status='posted',journal_entry_id=$1,updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 AND organization_id=$3 AND status='draft'`,
      [journal.id, id, organizationId],
    );
    if (!updated.rowCount) throw new AppError(409, "PAYMENT_POST_CONFLICT", "Payment state changed while posting");
    for (const allocation of allocations) {
      await lock.client.query(
        `INSERT INTO payment_allocations(id,organization_id,payment_id,document_id,amount_minor) VALUES($1,$2,$3,$4,$5)`,
        [createId("pal"), organizationId, id, allocation.documentId, allocation.amountMinor],
      );
    }
    await audit(lock.client, organizationId, actorId, "payment.posted", id, { journalEntryId: journal.id, allocatedMinor: allocationState.requestedMinor });
    await outbox(lock.client, "payment.posted", id, { paymentId: id, journalEntryId: journal.id, allocatedMinor: allocationState.requestedMinor });
    await lock.client.query("COMMIT");
    const balance = await paymentBalance(runtime, organizationId, id);
    return { id, status: "posted", journalEntryId: journal.id, allocatedMinor: balance.allocatedMinor, unallocatedMinor: balance.unallocatedMinor };
  } catch (error) {
    try { await lock.client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    await releasePaymentLock(lock.client, lock.key);
  }
}

export async function allocatePostedPayment(runtime: Runtime, organizationId: string, actorId: string, id: string, allocations: AllocationInput[]) {
  if (!allocations.length) throw new AppError(422, "INVALID_ALLOCATION", "At least one allocation is required");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`payment:allocate:${organizationId}:${id}`]);
    const payment = await fetchPayment(client, organizationId, id, true);
    if (!payment || payment.status !== "posted") throw new AppError(409, "INVALID_STATE", "Posted payment not found");
    const allocationState = await validateAllocations(client, organizationId, payment, allocations);
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO payment_allocations(id,organization_id,payment_id,document_id,amount_minor) VALUES($1,$2,$3,$4,$5)`,
        [createId("pal"), organizationId, id, allocation.documentId, allocation.amountMinor],
      );
    }
    await audit(client, organizationId, actorId, "payment.allocated", id, { allocatedMinor: allocationState.requestedMinor });
    await outbox(client, "payment.allocated", id, { paymentId: id, allocatedMinor: allocationState.requestedMinor });
    await client.query("COMMIT");
    const balance = await paymentBalance(runtime, organizationId, id);
    return { id, allocatedMinor: allocationState.requestedMinor, totalAllocatedMinor: balance.allocatedMinor, unallocatedMinor: balance.unallocatedMinor };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function existingReversal(runtime: Runtime, organizationId: string, originalJournalId: string) {
  return (await runtime.db.query<{ id: string; entryNumber: string; status: string }>(
    `SELECT id,entry_number AS "entryNumber",status FROM journal_entries WHERE organization_id=$1 AND reversal_of_id=$2 LIMIT 1`,
    [organizationId, originalJournalId],
  )).rows[0];
}

export async function reversePayment(runtime: Runtime, organizationId: string, actorId: string, id: string, postingDate: string, reason: string) {
  const lock = await acquirePaymentLock(runtime, organizationId, id, "reverse");
  try {
    const payment = await fetchPayment(runtime.db, organizationId, id);
    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    if (payment.status === "reversed") {
      return { id, status: "reversed", reversalJournalId: payment.reversalJournalId };
    }
    if (payment.status !== "posted" || !payment.journalEntryId) throw new AppError(409, "INVALID_STATE", "Only an unreversed posted payment can be reversed");

    const original = (await runtime.db.query<{ entryNumber: string; currency: string; exchangeRateMicros: number; status: string }>(
      `SELECT entry_number AS "entryNumber",currency,exchange_rate_micros::float8 AS "exchangeRateMicros",status
       FROM journal_entries WHERE id=$1 AND organization_id=$2`,
      [payment.journalEntryId, organizationId],
    )).rows[0];
    if (!original) throw new AppError(409, "MISSING_JOURNAL", "The payment journal no longer exists");

    let reversal = await existingReversal(runtime, organizationId, payment.journalEntryId);
    if (!reversal) {
      if (original.status !== "posted") throw new AppError(409, "INVALID_STATE", "The payment journal is not posted");
      const raw = await runtime.db.query<{
        accountId: string; description?: string; debitMinor: number; creditMinor: number; contactId?: string;
        projectId?: string; classId?: string; departmentId?: string; locationId?: string; taxCode?: string;
        dimensions: Record<string, string | number | boolean | null>;
      }>(
        `SELECT account_id AS "accountId",description,debit_minor::float8 AS "debitMinor",credit_minor::float8 AS "creditMinor",
          contact_id AS "contactId",project_id AS "projectId",class_id AS "classId",department_id AS "departmentId",
          location_id AS "locationId",tax_code AS "taxCode",dimensions_json AS dimensions
         FROM journal_lines WHERE journal_entry_id=$1 AND organization_id=$2 ORDER BY id`,
        [payment.journalEntryId, organizationId],
      );
      const created = await createJournal(runtime, organizationId, actorId, {
        transactionDate: postingDate,
        postingDate,
        description: `Reversal of ${payment.type} ${payment.number}: ${reason}`,
        reference: original.entryNumber,
        currency: original.currency,
        exchangeRateMicros: original.exchangeRateMicros,
        sourceType: "payment_reversal",
        sourceId: id,
        lines: raw.rows.map((line) => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor })),
      }, `payment:${id}:reversal`);
      await runtime.db.query(
        `UPDATE journal_entries SET reversal_of_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND reversal_of_id IS NULL`,
        [payment.journalEntryId, created.id, organizationId],
      );
      if (created.status === "draft") await postJournal(runtime, organizationId, actorId, created.id);
      reversal = { id: created.id, entryNumber: created.entryNumber, status: "posted" };
    } else if (reversal.status === "draft") {
      await postJournal(runtime, organizationId, actorId, reversal.id);
      reversal.status = "posted";
    }

    await runtime.db.query(
      `UPDATE journal_entries SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='posted'`,
      [payment.journalEntryId, organizationId],
    );

    await lock.client.query("BEGIN");
    await lock.client.query(
      `UPDATE payment_allocations SET reversed_at=CURRENT_TIMESTAMP,reversed_by=$1,reversal_reason=$2,updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=$3 AND payment_id=$4 AND reversed_at IS NULL`,
      [actorId, reason, organizationId, id],
    );
    const updated = await lock.client.query(
      `UPDATE payments SET status='reversed',reversal_journal_id=$1,reversed_at=CURRENT_TIMESTAMP,reversed_by=$2,reversal_reason=$3,updated_at=CURRENT_TIMESTAMP
       WHERE id=$4 AND organization_id=$5 AND status='posted'`,
      [reversal.id, actorId, reason, id, organizationId],
    );
    if (!updated.rowCount) {
      const current = await fetchPayment(lock.client, organizationId, id, true);
      if (current?.status !== "reversed") throw new AppError(409, "PAYMENT_REVERSE_CONFLICT", "Payment state changed while reversing");
    }
    await audit(lock.client, organizationId, actorId, "payment.reversed", id, { reversalJournalId: reversal.id, reason });
    await outbox(lock.client, "payment.reversed", id, { paymentId: id, reversalJournalId: reversal.id, reason });
    await lock.client.query("COMMIT");
    return { id, status: "reversed", reversalJournalId: reversal.id };
  } catch (error) {
    try { await lock.client.query("ROLLBACK"); } catch { /* no active transaction */ }
    throw error;
  } finally {
    await releasePaymentLock(lock.client, lock.key);
  }
}

export async function listOutstandingBalances(runtime: Runtime, organizationId: string, contactId?: string, paymentType?: PaymentType) {
  const params: unknown[] = [organizationId];
  const conditions = ["d.organization_id=$1", "d.status IN ('open','partially_paid')", "d.type IN ('invoice','bill')"];
  if (contactId) { params.push(contactId); conditions.push(`d.contact_id=$${params.length}`); }
  if (paymentType) { params.push(paymentType === "receipt" ? "invoice" : "bill"); conditions.push(`d.type=$${params.length}`); }
  const rows = await runtime.db.query<{
    id: string; type: string; number: string; contactId: string; contact: string; issueDate: string; dueDate: string | null;
    currency: string; totalMinor: number; paidMinor: number; outstandingMinor: number;
  }>(
    `SELECT d.id,d.type,d.number,d.contact_id AS "contactId",c.name AS contact,d.issue_date::text AS "issueDate",d.due_date::text AS "dueDate",
      d.currency,d.total_minor::float8 AS "totalMinor",d.paid_minor::float8 AS "paidMinor",(d.total_minor-d.paid_minor)::float8 AS "outstandingMinor"
     FROM documents d JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
     WHERE ${conditions.join(" AND ")} ORDER BY d.due_date NULLS LAST,d.issue_date,d.number`,
    params,
  );
  const totals = rows.rows.reduce<Record<string, number>>((result, row) => {
    result[row.currency] = (result[row.currency] ?? 0) + row.outstandingMinor;
    return result;
  }, {});
  return { documents: rows.rows, totalsByCurrency: totals };
}

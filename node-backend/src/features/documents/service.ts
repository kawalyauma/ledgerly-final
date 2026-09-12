import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { createJournal, postJournal, type JournalLineInput } from "../finance-core/service.js";

type Db = Pool | PoolClient;
export type DocumentType = "invoice" | "bill" | "credit_note" | "supplier_credit";
export type DocumentLineInput = {
  productId?: string;
  accountId: string;
  taxAccountId?: string;
  description: string;
  quantityMicros: number;
  unitPriceMinor: number;
  taxMinor: number;
  projectId?: string;
  classId?: string;
  departmentId?: string;
  locationId?: string;
  dimensions?: Record<string, string | number | boolean | null | undefined>;
};
export type DocumentInput = {
  type: DocumentType;
  number: string;
  contactId: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  customFields?: Record<string, unknown>;
  lines: DocumentLineInput[];
};

type CalculatedLine = DocumentLineInput & { subtotalMinor: number; totalMinor: number };

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,'document',$5,$6::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

function roundedLineSubtotal(quantityMicros: number, unitPriceMinor: number): number {
  if (!Number.isSafeInteger(quantityMicros) || quantityMicros <= 0 || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new AppError(422, "INVALID_AMOUNT", "Document quantities and prices must use safe integer minor/micro units");
  }
  const rounded = (BigInt(quantityMicros) * BigInt(unitPriceMinor) + 500_000n) / 1_000_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError(422, "INVALID_AMOUNT", "Document amount exceeds the supported safe integer range");
  return Number(rounded);
}

function calculate(input: DocumentInput) {
  const lines: CalculatedLine[] = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.taxMinor) || line.taxMinor < 0) throw new AppError(422, "INVALID_AMOUNT", "Tax must be a non-negative safe integer");
    const subtotalMinor = roundedLineSubtotal(line.quantityMicros, line.unitPriceMinor);
    const totalMinor = subtotalMinor + line.taxMinor;
    if (!Number.isSafeInteger(totalMinor)) throw new AppError(422, "INVALID_AMOUNT", "Document amount exceeds the supported safe integer range");
    return { ...line, subtotalMinor, totalMinor };
  });
  const subtotalMinor = lines.reduce((sum, line) => sum + line.subtotalMinor, 0);
  const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0);
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  if (![subtotalMinor, taxMinor, totalMinor].every(Number.isSafeInteger) || totalMinor <= 0) {
    throw new AppError(422, "INVALID_TOTAL", "Document total must be a positive safe integer");
  }
  return { lines, subtotalMinor, taxMinor, totalMinor };
}

async function validateDocumentAccounts(db: Db, organizationId: string, lines: DocumentLineInput[]) {
  const ids = [...new Set(lines.flatMap((line) => [line.accountId, line.taxAccountId].filter((value): value is string => Boolean(value))))];
  const result = await db.query<{ id: string; active: boolean; allowPosting: boolean }>(
    `SELECT id,active,allow_posting AS "allowPosting" FROM accounts WHERE organization_id=$1 AND id=ANY($2::text[])`,
    [organizationId, ids],
  );
  if (result.rows.length !== ids.length || result.rows.some((row) => !row.active || !row.allowPosting)) {
    throw new AppError(422, "INVALID_ACCOUNT", "All document line accounts must be active posting accounts in the organization");
  }
}

async function expectedContactType(db: Db, organizationId: string, contactId: string, type: DocumentType) {
  const expected = type === "invoice" || type === "credit_note" ? "customer" : "supplier";
  const contact = (await db.query<{ type: string; active: boolean; archivedAt: string | null }>(
    `SELECT type,active,archived_at AS "archivedAt" FROM contacts WHERE id=$1 AND organization_id=$2`,
    [contactId, organizationId],
  )).rows[0];
  if (!contact || contact.type !== expected || !contact.active || contact.archivedAt) {
    throw new AppError(422, "INVALID_CONTACT", `A ${expected} contact is required`);
  }
}

export async function createDocument(runtime: Runtime, organizationId: string, actorId: string, input: DocumentInput) {
  await expectedContactType(runtime.db, organizationId, input.contactId, input.type);
  await validateDocumentAccounts(runtime.db, organizationId, input.lines);
  const totals = calculate(input);
  const id = createId("doc");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO documents(id,organization_id,type,number,contact_id,issue_date,due_date,status,currency,subtotal_minor,tax_minor,total_minor,custom_fields)
       VALUES($1,$2,$3,$4,$5,$6::date,$7::date,'draft',$8,$9,$10,$11,$12::jsonb)`,
      [id, organizationId, input.type, input.number, input.contactId, input.issueDate, input.dueDate ?? input.issueDate, input.currency, totals.subtotalMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(input.customFields ?? {})],
    );
    for (const line of totals.lines) {
      await client.query(
        `INSERT INTO document_lines(id,organization_id,document_id,product_id,account_id,tax_account_id,description,quantity_micros,unit_price_minor,subtotal_minor,tax_minor,total_minor,project_id,class_id,department_id,location_id,dimensions_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
        [createId("dln"), organizationId, id, line.productId ?? null, line.accountId, line.taxAccountId ?? null, line.description, line.quantityMicros, line.unitPriceMinor, line.subtotalMinor, line.taxMinor, line.totalMinor, line.projectId ?? null, line.classId ?? null, line.departmentId ?? null, line.locationId ?? null, JSON.stringify(line.dimensions ?? {})],
      );
    }
    await audit(client, organizationId, actorId, "document.created", id, { type: input.type, number: input.number, totalMinor: totals.totalMinor });
    await client.query("COMMIT");
    return { id, status: "draft" as const, ...totals };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveControlAccount(runtime: Runtime, organizationId: string, type: DocumentType, requested?: string) {
  const subtype = type === "invoice" || type === "credit_note" ? "receivable" : "payable";
  if (requested) {
    const account = (await runtime.db.query<{ id: string; subtype: string | null }>(
      `SELECT id,subtype FROM accounts WHERE id=$1 AND organization_id=$2 AND active=true AND allow_posting=true`,
      [requested, organizationId],
    )).rows[0];
    if (!account || account.subtype !== subtype) throw new AppError(422, "INVALID_CONTROL_ACCOUNT", `A valid accounts ${subtype} control account is required`);
    return account.id;
  }
  const candidates = await runtime.db.query<{ id: string }>(
    `SELECT id FROM accounts WHERE organization_id=$1 AND active=true AND allow_posting=true AND subtype=$2 ORDER BY code LIMIT 2`,
    [organizationId, subtype],
  );
  if (candidates.rows.length !== 1) {
    throw new AppError(422, "CONTROL_ACCOUNT_REQUIRED", `Unable to choose a unique ${subtype} control account automatically; supply controlAccountId`);
  }
  return candidates.rows[0]!.id;
}

async function acquireDocumentLock(runtime: Runtime, organizationId: string, id: string, purpose: string) {
  const client = await runtime.db.connect();
  const key = `document:${purpose}:${organizationId}:${id}`;
  await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [key]);
  return { client, key };
}

async function releaseDocumentLock(client: PoolClient, key: string) {
  try { await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [key]); } finally { client.release(); }
}

function documentNarration(type: DocumentType, number: string, descriptions: string[]) {
  const labels: Record<DocumentType, string> = { invoice: "Invoice", bill: "Bill", credit_note: "Credit note", supplier_credit: "Supplier credit" };
  const summary = descriptions.map((value) => value.trim()).filter(Boolean).slice(0, 3).join("; ");
  return `${labels[type]} ${number}${summary ? ` — ${summary}` : ""}`;
}

export async function postDocument(runtime: Runtime, organizationId: string, actorId: string, id: string, requestedControlAccountId?: string) {
  const lock = await acquireDocumentLock(runtime, organizationId, id, "post");
  try {
    const doc = (await runtime.db.query<{
      id: string; type: DocumentType; number: string; contactId: string; issueDate: string; currency: string;
      totalMinor: number; status: string; journalEntryId: string | null; approvalStatus: string;
    }>(
      `SELECT id,type,number,contact_id AS "contactId",issue_date::text AS "issueDate",currency,total_minor::float8 AS "totalMinor",status,
       journal_entry_id AS "journalEntryId",approval_status AS "approvalStatus" FROM documents WHERE id=$1 AND organization_id=$2`,
      [id, organizationId],
    )).rows[0];
    if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
    if (doc.status !== "draft") {
      if (doc.journalEntryId && ["open", "partially_paid", "paid"].includes(doc.status)) return { id, status: doc.status, journalEntryId: doc.journalEntryId };
      throw new AppError(409, "INVALID_STATE", "Only draft documents can be posted");
    }
    if (!["not_required", "approved"].includes(doc.approvalStatus)) throw new AppError(409, "APPROVAL_REQUIRED", "Document must complete its approval workflow before posting");

    const controlAccountId = await resolveControlAccount(runtime, organizationId, doc.type, requestedControlAccountId);
    const raw = await runtime.db.query<{
      accountId: string; taxAccountId: string | null; description: string; subtotalMinor: number; taxMinor: number;
      projectId: string | null; classId: string | null; departmentId: string | null; locationId: string | null;
      dimensions: Record<string, string | number | boolean | null>;
    }>(
      `SELECT account_id AS "accountId",tax_account_id AS "taxAccountId",description,subtotal_minor::float8 AS "subtotalMinor",
       tax_minor::float8 AS "taxMinor",project_id AS "projectId",class_id AS "classId",department_id AS "departmentId",
       location_id AS "locationId",dimensions_json AS dimensions FROM document_lines WHERE document_id=$1 AND organization_id=$2 ORDER BY id`,
      [id, organizationId],
    );
    if (!raw.rowCount) throw new AppError(409, "INVALID_STATE", "Document has no lines");
    const narration = documentNarration(doc.type, doc.number, raw.rows.map((line) => line.description));
    const lines: JournalLineInput[] = [];
    const controlDebit = doc.type === "invoice" || doc.type === "supplier_credit";
    lines.push({ accountId: controlAccountId, contactId: doc.contactId, description: narration, ...(controlDebit ? { debitMinor: doc.totalMinor } : { creditMinor: doc.totalMinor }) });
    const detailDebit = doc.type === "bill" || doc.type === "credit_note";
    for (const line of raw.rows) {
      lines.push({
        accountId: line.accountId, contactId: doc.contactId, description: line.description, projectId: line.projectId ?? undefined,
        classId: line.classId ?? undefined, departmentId: line.departmentId ?? undefined, locationId: line.locationId ?? undefined,
        dimensions: line.dimensions, ...(detailDebit ? { debitMinor: line.subtotalMinor } : { creditMinor: line.subtotalMinor }),
      });
      if (line.taxMinor > 0) {
        if (!line.taxAccountId) throw new AppError(422, "TAX_ACCOUNT_REQUIRED", "Every taxed line requires a tax account");
        lines.push({ accountId: line.taxAccountId, contactId: doc.contactId, description: `Tax: ${line.description}`, dimensions: line.dimensions, ...(detailDebit ? { debitMinor: line.taxMinor } : { creditMinor: line.taxMinor }) });
      }
    }
    const journal = await createJournal(runtime, organizationId, actorId, {
      transactionDate: doc.issueDate, postingDate: doc.issueDate, description: narration, reference: doc.number,
      currency: doc.currency, sourceType: doc.type, sourceId: id, lines,
    }, `document:${id}:post`);
    if (journal.status === "draft") await postJournal(runtime, organizationId, actorId, journal.id);
    const updated = await runtime.db.query(
      `UPDATE documents SET status='open',journal_entry_id=$1,updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 AND organization_id=$3 AND status='draft'`,
      [journal.id, id, organizationId],
    );
    if (!updated.rowCount) throw new AppError(409, "DOCUMENT_POST_CONFLICT", "Document state changed while posting");
    await audit(runtime.db, organizationId, actorId, "document.posted", id, { journalEntryId: journal.id, controlAccountId });
    return { id, status: "open", journalEntryId: journal.id, controlAccountId };
  } finally {
    await releaseDocumentLock(lock.client, lock.key);
  }
}

async function existingReversal(runtime: Runtime, organizationId: string, originalJournalId: string) {
  return (await runtime.db.query<{ id: string; entryNumber: string; status: string }>(
    `SELECT id,entry_number AS "entryNumber",status FROM journal_entries WHERE organization_id=$1 AND reversal_of_id=$2 LIMIT 1`,
    [organizationId, originalJournalId],
  )).rows[0];
}

export async function reverseDocument(runtime: Runtime, organizationId: string, actorId: string, id: string, postingDate: string, reason: string) {
  const lock = await acquireDocumentLock(runtime, organizationId, id, "reverse");
  try {
    const doc = (await runtime.db.query<{ type: DocumentType; number: string; status: string; paidMinor: number; journalEntryId: string | null }>(
      `SELECT type,number,status,paid_minor::float8 AS "paidMinor",journal_entry_id AS "journalEntryId" FROM documents WHERE id=$1 AND organization_id=$2`,
      [id, organizationId],
    )).rows[0];
    if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
    if (!doc.journalEntryId) throw new AppError(409, "INVALID_STATE", "Only a posted document can be reversed");
    if (doc.paidMinor !== 0) throw new AppError(409, "DOCUMENT_HAS_PAYMENTS", "Reverse allocated payments before reversing this document");
    if (doc.status === "void") {
      const reversal = await existingReversal(runtime, organizationId, doc.journalEntryId);
      return { id, status: "void", reversalJournalId: reversal?.id ?? null };
    }
    if (!["open", "partially_paid", "paid"].includes(doc.status)) throw new AppError(409, "INVALID_STATE", "Only a posted document can be reversed");

    const original = (await runtime.db.query<{ entryNumber: string; currency: string; exchangeRateMicros: number; status: string }>(
      `SELECT entry_number AS "entryNumber",currency,exchange_rate_micros::float8 AS "exchangeRateMicros",status FROM journal_entries WHERE id=$1 AND organization_id=$2`,
      [doc.journalEntryId, organizationId],
    )).rows[0];
    if (!original) throw new AppError(409, "MISSING_JOURNAL", "The document journal no longer exists");
    let reversal = await existingReversal(runtime, organizationId, doc.journalEntryId);
    if (!reversal) {
      if (original.status !== "posted") throw new AppError(409, "INVALID_STATE", "The document journal is not posted");
      const raw = await runtime.db.query<{
        accountId: string; description?: string; debitMinor: number; creditMinor: number; contactId?: string; projectId?: string;
        classId?: string; departmentId?: string; locationId?: string; taxCode?: string; dimensions: Record<string, string | number | boolean | null>;
      }>(
        `SELECT account_id AS "accountId",description,debit_minor::float8 AS "debitMinor",credit_minor::float8 AS "creditMinor",
         contact_id AS "contactId",project_id AS "projectId",class_id AS "classId",department_id AS "departmentId",location_id AS "locationId",
         tax_code AS "taxCode",dimensions_json AS dimensions FROM journal_lines WHERE journal_entry_id=$1 AND organization_id=$2 ORDER BY id`,
        [doc.journalEntryId, organizationId],
      );
      const created = await createJournal(runtime, organizationId, actorId, {
        transactionDate: postingDate, postingDate, description: `Reversal of ${doc.number}: ${reason}`, reference: original.entryNumber,
        currency: original.currency, exchangeRateMicros: original.exchangeRateMicros, sourceType: "document_reversal", sourceId: id,
        lines: raw.rows.map((line) => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor })),
      }, `document:${id}:reversal`);
      await runtime.db.query(
        `UPDATE journal_entries SET reversal_of_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND reversal_of_id IS NULL`,
        [doc.journalEntryId, created.id, organizationId],
      );
      if (created.status === "draft") await postJournal(runtime, organizationId, actorId, created.id);
      reversal = { id: created.id, entryNumber: created.entryNumber, status: "posted" };
    } else if (reversal.status === "draft") {
      await postJournal(runtime, organizationId, actorId, reversal.id);
      reversal.status = "posted";
    }
    await runtime.db.query(
      `UPDATE journal_entries SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='posted'`,
      [doc.journalEntryId, organizationId],
    );
    const updated = await runtime.db.query(
      `UPDATE documents SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND paid_minor=0 AND status IN ('open','partially_paid','paid')`,
      [id, organizationId],
    );
    if (!updated.rowCount) {
      const current = (await runtime.db.query<{ status: string }>("SELECT status FROM documents WHERE id=$1 AND organization_id=$2", [id, organizationId])).rows[0];
      if (current?.status !== "void") throw new AppError(409, "DOCUMENT_REVERSE_CONFLICT", "Document state changed while reversing");
    }
    await audit(runtime.db, organizationId, actorId, "document.reversed", id, { reversalJournalId: reversal.id, reason });
    return { id, status: "void", reversalJournalId: reversal.id };
  } finally {
    await releaseDocumentLock(lock.client, lock.key);
  }
}

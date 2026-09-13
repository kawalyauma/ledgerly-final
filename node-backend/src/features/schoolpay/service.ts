import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { createPayment, postPayment, type AllocationInput } from "../payments/service.js";

export type SchoolPaySecretEnvelope = { ciphertext: string; iv: string; tag: string };
export type SchoolPayEventType = "SCHOOL_FEES" | "OTHER_FEES";
export type SchoolPayCaptureSource = "webhook" | "sync" | "adhoc";

export type SchoolPayConfigRow = {
  organizationId: string;
  schoolCode: string;
  apiPasswordCiphertext: string;
  apiPasswordIv: string;
  apiPasswordTag: string;
  webhookKey: string;
  bankAccountId: string;
  controlAccountId: string;
  enabled: boolean;
  autoAllocate: boolean;
  lastWebhookAt: string | null;
  lastReconciledAt: string | null;
};

export type SchoolPayFeePayment = {
  amount: string | number;
  paymentDateAndTime: string;
  schoolpayReceiptNumber: string;
  sourceChannelTransactionId?: string | null;
  sourcePaymentChannel?: string | null;
  studentPaymentCode: string;
  studentName?: string | null;
  studentRegistrationNumber?: string | null;
  transactionCompletionStatus?: string | null;
  supplementaryFeeDescription?: string | null;
  supplementaryFeeId?: string | null;
  [key: string]: unknown;
};

export type SchoolPayWebhookPayload = {
  signature: string;
  type: SchoolPayEventType;
  payment: SchoolPayFeePayment;
  [key: string]: unknown;
};

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSchoolPaySecret(value: string, masterKey: string): SchoolPaySecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(masterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function decryptSchoolPaySecret(envelope: SchoolPaySecretEnvelope, masterKey: string) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(masterKey), Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function schoolPayWebhookSignature(apiPassword: string, receiptNumber: string) {
  return createHash("sha256").update(`${apiPassword}${receiptNumber}`, "utf8").digest("hex");
}

export function verifySchoolPayWebhookSignature(apiPassword: string, receiptNumber: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = Buffer.from(schoolPayWebhookSignature(apiPassword, receiptNumber), "hex");
  const actual = Buffer.from(supplied, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireMasterKey(runtime: Runtime) {
  const key = runtime.config.SCHOOLPAY_SECRET_ENCRYPTION_KEY;
  if (!key) throw new AppError(500, "SCHOOLPAY_ENCRYPTION_KEY_REQUIRED", "SCHOOLPAY_SECRET_ENCRYPTION_KEY must be configured before SchoolPay can be enabled");
  return key;
}

function paymentDate(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) throw new AppError(422, "INVALID_SCHOOLPAY_DATE", "SchoolPay paymentDateAndTime is invalid");
  return match[1]!;
}

function paymentAmountMinor(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value.replace(/,/g, "").trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(422, "INVALID_SCHOOLPAY_AMOUNT", "SchoolPay amount must be a positive whole UGX amount");
  return parsed;
}

function completedStatus(value: string | null | undefined) {
  if (!value?.trim()) return true;
  return ["completed", "paid", "success", "successful"].includes(value.trim().toLowerCase());
}

async function configByWebhookKey(runtime: Runtime, webhookKey: string): Promise<SchoolPayConfigRow | undefined> {
  return (await runtime.db.query<SchoolPayConfigRow>(
    `SELECT organization_id AS "organizationId",school_code AS "schoolCode",
      api_password_ciphertext AS "apiPasswordCiphertext",api_password_iv AS "apiPasswordIv",api_password_tag AS "apiPasswordTag",
      webhook_key AS "webhookKey",bank_account_id AS "bankAccountId",control_account_id AS "controlAccountId",
      enabled,auto_allocate AS "autoAllocate",last_webhook_at AS "lastWebhookAt",last_reconciled_at AS "lastReconciledAt"
     FROM schoolpay_configurations WHERE webhook_key=$1 AND enabled=true`, [webhookKey])).rows[0];
}

export async function schoolPayConfigByOrganization(runtime: Runtime, organizationId: string, enabledOnly = true): Promise<SchoolPayConfigRow | undefined> {
  return (await runtime.db.query<SchoolPayConfigRow>(
    `SELECT organization_id AS "organizationId",school_code AS "schoolCode",
      api_password_ciphertext AS "apiPasswordCiphertext",api_password_iv AS "apiPasswordIv",api_password_tag AS "apiPasswordTag",
      webhook_key AS "webhookKey",bank_account_id AS "bankAccountId",control_account_id AS "controlAccountId",
      enabled,auto_allocate AS "autoAllocate",last_webhook_at AS "lastWebhookAt",last_reconciled_at AS "lastReconciledAt"
     FROM schoolpay_configurations WHERE organization_id=$1${enabledOnly ? " AND enabled=true" : ""}`, [organizationId])).rows[0];
}

export function schoolPayApiPassword(runtime: Runtime, config: SchoolPayConfigRow) {
  return decryptSchoolPaySecret({ ciphertext: config.apiPasswordCiphertext, iv: config.apiPasswordIv, tag: config.apiPasswordTag }, requireMasterKey(runtime));
}

export async function schoolPayConfigSummary(runtime: Runtime, organizationId: string) {
  const row = await schoolPayConfigByOrganization(runtime, organizationId, false);
  if (!row) return { configured: false } as const;
  return { configured: true, schoolCode: row.schoolCode, bankAccountId: row.bankAccountId, controlAccountId: row.controlAccountId,
    enabled: row.enabled, autoAllocate: row.autoAllocate, webhookPath: `/webhooks/schoolpay/${row.webhookKey}`,
    lastWebhookAt: row.lastWebhookAt, lastReconciledAt: row.lastReconciledAt } as const;
}

export async function configureSchoolPay(runtime: Runtime, organizationId: string, actorId: string, input: {
  schoolCode: string; apiPassword: string; bankAccountId: string; controlAccountId: string; enabled: boolean; autoAllocate: boolean;
}) {
  const accountIds = [...new Set([input.bankAccountId, input.controlAccountId])];
  const accounts = await runtime.db.query<{ id: string; subtype: string | null }>(
    `SELECT id,subtype FROM accounts WHERE organization_id=$1 AND id=ANY($2::text[]) AND active=true AND allow_posting=true`, [organizationId, accountIds]);
  if (!accounts.rows.some((row) => row.id === input.bankAccountId && row.subtype === "cash")) {
    throw new AppError(422, "INVALID_SCHOOLPAY_BANK_ACCOUNT", "SchoolPay bank account must be an active cash posting account");
  }
  if (!accounts.rows.some((row) => row.id === input.controlAccountId && row.subtype === "receivable")) {
    throw new AppError(422, "INVALID_SCHOOLPAY_CONTROL_ACCOUNT", "SchoolPay control account must be an active receivable posting account");
  }
  const encrypted = encryptSchoolPaySecret(input.apiPassword, requireMasterKey(runtime));
  const existing = (await runtime.db.query<{ webhookKey: string }>(`SELECT webhook_key AS "webhookKey" FROM schoolpay_configurations WHERE organization_id=$1`, [organizationId])).rows[0];
  const webhookKey = existing?.webhookKey ?? `spwh_${randomBytes(24).toString("base64url")}`;
  await runtime.db.query(
    `INSERT INTO schoolpay_configurations(organization_id,school_code,api_password_ciphertext,api_password_iv,api_password_tag,webhook_key,
       bank_account_id,control_account_id,enabled,auto_allocate,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(organization_id) DO UPDATE SET school_code=EXCLUDED.school_code,api_password_ciphertext=EXCLUDED.api_password_ciphertext,
       api_password_iv=EXCLUDED.api_password_iv,api_password_tag=EXCLUDED.api_password_tag,bank_account_id=EXCLUDED.bank_account_id,
       control_account_id=EXCLUDED.control_account_id,enabled=EXCLUDED.enabled,auto_allocate=EXCLUDED.auto_allocate,updated_at=CURRENT_TIMESTAMP`,
    [organizationId, input.schoolCode.trim(), encrypted.ciphertext, encrypted.iv, encrypted.tag, webhookKey,
      input.bankAccountId, input.controlAccountId, input.enabled, input.autoAllocate, actorId]);
  return schoolPayConfigSummary(runtime, organizationId);
}

async function oldestFeeAllocations(runtime: Runtime, organizationId: string, studentId: string, amountMinor: number): Promise<AllocationInput[]> {
  const documents = await runtime.db.query<{ id: string; outstandingMinor: number }>(
    `SELECT d.id,(d.total_minor-d.paid_minor)::float8 AS "outstandingMinor" FROM documents d
     WHERE d.organization_id=$1 AND d.type='invoice' AND d.status IN ('open','partially_paid') AND d.currency='UGX'
       AND d.id IN (SELECT DISTINCT document_id FROM school_student_fee_charges WHERE organization_id=$1 AND student_id=$2)
     ORDER BY d.due_date NULLS LAST,d.issue_date,d.number,d.id`, [organizationId, studentId]);
  let remaining = amountMinor; const allocations: AllocationInput[] = [];
  for (const document of documents.rows) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, Number(document.outstandingMinor));
    if (applied > 0) allocations.push({ documentId: document.id, amountMinor: applied });
    remaining -= applied;
  }
  return allocations;
}

async function markEvent(runtime: Runtime, organizationId: string, eventId: string, status: "posted" | "unmatched" | "failed" | "ignored", update: {
  paymentId?: string; schoolFeeReceiptId?: string; error?: string;
} = {}) {
  await runtime.db.query(
    `UPDATE schoolpay_events SET status=$1,payment_id=COALESCE($2,payment_id),school_fee_receipt_id=COALESCE($3,school_fee_receipt_id),error=$4,
       processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND organization_id=$6`,
    [status, update.paymentId ?? null, update.schoolFeeReceiptId ?? null, update.error ?? null, eventId, organizationId]);
}

async function postCapturedEvent(runtime: Runtime, config: SchoolPayConfigRow, eventId: string) {
  const event = (await runtime.db.query<{
    id: string; status: string; receiptNumber: string; sourceTransactionId: string | null; studentPaymentCode: string;
    amountMinor: number; paymentDate: string; eventType: SchoolPayEventType;
  }>(`SELECT id,status,schoolpay_receipt_number AS "receiptNumber",source_transaction_id AS "sourceTransactionId",
      student_payment_code AS "studentPaymentCode",amount_minor::float8 AS "amountMinor",payment_date::text AS "paymentDate",event_type AS "eventType"
     FROM schoolpay_events WHERE id=$1 AND organization_id=$2`, [eventId, config.organizationId])).rows[0];
  if (!event) throw new AppError(404, "SCHOOLPAY_EVENT_NOT_FOUND", "SchoolPay event was not found");
  if (event.status === "posted") return { status: "posted" as const, duplicate: true };
  if (event.status === "ignored") return { status: "ignored" as const };

  const student = (await runtime.db.query<{ id: string; contactId: string | null }>(
    `SELECT id,contact_id AS "contactId" FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL AND status='active'`,
    [event.studentPaymentCode, config.organizationId])).rows[0];
  if (!student?.contactId) {
    await markEvent(runtime, config.organizationId, event.id, "unmatched", { error: "No active Ledgerly student with this SchoolPay payment code and finance contact" });
    return { status: "unmatched" as const, studentPaymentCode: event.studentPaymentCode };
  }

  const allocations = config.autoAllocate && event.eventType === "SCHOOL_FEES"
    ? await oldestFeeAllocations(runtime, config.organizationId, student.id, Number(event.amountMinor)) : [];
  const actorId = `schoolpay:${config.organizationId}`;
  const payment = await createPayment(runtime, config.organizationId, actorId, {
    type: "receipt", number: `SP-${event.receiptNumber}`, contactId: student.contactId,
    bankAccountId: config.bankAccountId, controlAccountId: config.controlAccountId, paymentDate: event.paymentDate,
    currency: "UGX", amountMinor: Number(event.amountMinor),
    reference: event.sourceTransactionId ? `SchoolPay ${event.receiptNumber} / ${event.sourceTransactionId}` : `SchoolPay ${event.receiptNumber}`,
  }, `schoolpay:${config.organizationId}:${event.receiptNumber}`);
  await postPayment(runtime, config.organizationId, actorId, payment.id, allocations);

  let receipt = (await runtime.db.query<{ id: string }>(`SELECT id FROM school_fee_receipts WHERE organization_id=$1 AND payment_id=$2`, [config.organizationId, payment.id])).rows[0];
  if (!receipt) {
    const receiptId = createId("sfr");
    const inserted = await runtime.db.query<{ id: string }>(
      `INSERT INTO school_fee_receipts(id,organization_id,student_id,payment_id,receipt_number,amount_minor,payment_date,reference,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT(organization_id,payment_id) DO NOTHING RETURNING id`,
      [receiptId, config.organizationId, student.id, payment.id, event.receiptNumber, event.amountMinor, event.paymentDate, event.sourceTransactionId]);
    receipt = inserted.rows[0] ?? (await runtime.db.query<{ id: string }>(`SELECT id FROM school_fee_receipts WHERE organization_id=$1 AND payment_id=$2`, [config.organizationId, payment.id])).rows[0];
  }
  if (!receipt) throw new Error("SchoolPay payment posted but the school fee receipt could not be resolved");
  await markEvent(runtime, config.organizationId, event.id, "posted", { paymentId: payment.id, schoolFeeReceiptId: receipt.id });
  return { status: "posted" as const, paymentId: payment.id, receiptId: receipt.id,
    allocatedMinor: allocations.reduce((sum, item) => sum + item.amountMinor, 0) };
}

export async function captureSchoolPayProviderPayment(runtime: Runtime, config: SchoolPayConfigRow, eventType: SchoolPayEventType,
  payment: SchoolPayFeePayment, rawPayload: unknown, source: SchoolPayCaptureSource, reconciliationRunId?: string | null) {
  const receiptNumber = payment.schoolpayReceiptNumber.trim();
  const studentPaymentCode = payment.studentPaymentCode.trim();
  if (!receiptNumber) throw new AppError(422, "INVALID_SCHOOLPAY_RECEIPT", "SchoolPay receipt number is required");
  if (!studentPaymentCode) throw new AppError(422, "INVALID_STUDENT_PAYMENT_CODE", "SchoolPay studentPaymentCode is required");
  const amountMinor = paymentAmountMinor(payment.amount);
  const date = paymentDate(payment.paymentDateAndTime);
  const completed = completedStatus(payment.transactionCompletionStatus);
  const eventId = createId("spe");
  const inserted = await runtime.db.query<{ id: string }>(
    `INSERT INTO schoolpay_events(id,organization_id,schoolpay_receipt_number,source_transaction_id,source_payment_channel,
       student_payment_code,amount_minor,payment_date,payment_timestamp,event_type,status,payload,capture_source,reconciliation_run_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT(organization_id,schoolpay_receipt_number) DO NOTHING RETURNING id`,
    [eventId, config.organizationId, receiptNumber, payment.sourceChannelTransactionId ?? null, payment.sourcePaymentChannel ?? null,
      studentPaymentCode, amountMinor, date, payment.paymentDateAndTime, eventType, completed ? "received" : "ignored",
      JSON.stringify(rawPayload), source, reconciliationRunId ?? null]);
  const duplicate = !inserted.rowCount;
  const resolvedEventId = inserted.rows[0]?.id ?? (await runtime.db.query<{ id: string }>(
    `SELECT id FROM schoolpay_events WHERE organization_id=$1 AND schoolpay_receipt_number=$2`, [config.organizationId, receiptNumber])).rows[0]?.id;
  if (!resolvedEventId) throw new Error("SchoolPay event could not be captured");

  if (duplicate) {
    await runtime.db.query(
      `UPDATE schoolpay_events SET source_transaction_id=COALESCE($1,source_transaction_id),source_payment_channel=COALESCE($2,source_payment_channel),
       payment_timestamp=$3,payload=$4::jsonb,last_seen_at=CURRENT_TIMESTAMP,reconciliation_run_id=COALESCE($5,reconciliation_run_id),
       status=CASE WHEN status='posted' THEN 'posted' WHEN $6 THEN 'received' ELSE 'ignored' END,
       error=CASE WHEN status='posted' THEN error WHEN $6 THEN NULL ELSE 'SchoolPay transaction is not completed' END,updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 AND organization_id=$8`,
      [payment.sourceChannelTransactionId ?? null, payment.sourcePaymentChannel ?? null, payment.paymentDateAndTime,
        JSON.stringify(rawPayload), reconciliationRunId ?? null, completed, resolvedEventId, config.organizationId]);
  } else if (!completed) {
    await markEvent(runtime, config.organizationId, resolvedEventId, "ignored", { error: "SchoolPay transaction is not completed" });
  }
  if (!completed) return { accepted: true, duplicate, eventId: resolvedEventId, status: "ignored" as const };

  const lock = await runtime.db.connect();
  const lockKey = `schoolpay:${config.organizationId}:${receiptNumber}`;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    try {
      const posted = await postCapturedEvent(runtime, config, resolvedEventId);
      return { accepted: true, duplicate, eventId: resolvedEventId, ...posted };
    } catch (error) {
      await markEvent(runtime, config.organizationId, resolvedEventId, "failed", { error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) });
      runtime.logger.error({ err: error, organizationId: config.organizationId, eventId: resolvedEventId, source }, "SchoolPay payment posting failed after durable capture");
      return { accepted: true, duplicate, eventId: resolvedEventId, status: "failed" as const };
    }
  } finally {
    try { await lock.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } finally { lock.release(); }
  }
}

export async function captureSchoolPayWebhook(runtime: Runtime, webhookKey: string, payload: SchoolPayWebhookPayload) {
  const config = await configByWebhookKey(runtime, webhookKey);
  if (!config) throw new AppError(404, "SCHOOLPAY_WEBHOOK_NOT_FOUND", "SchoolPay webhook endpoint is not configured");
  if (payload.type !== "SCHOOL_FEES" && payload.type !== "OTHER_FEES") throw new AppError(422, "UNSUPPORTED_SCHOOLPAY_EVENT", "Unsupported SchoolPay webhook type");
  const receiptNumber = payload.payment.schoolpayReceiptNumber.trim();
  if (!verifySchoolPayWebhookSignature(schoolPayApiPassword(runtime, config), receiptNumber, payload.signature)) {
    throw new AppError(401, "INVALID_SCHOOLPAY_SIGNATURE", "SchoolPay signature validation failed");
  }
  const result = await captureSchoolPayProviderPayment(runtime, config, payload.type, payload.payment, payload, "webhook");
  await runtime.db.query(`UPDATE schoolpay_configurations SET last_webhook_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`, [config.organizationId]);
  return result;
}

export async function retrySchoolPayEvent(runtime: Runtime, organizationId: string, eventId: string) {
  const config = await schoolPayConfigByOrganization(runtime, organizationId);
  if (!config) throw new AppError(409, "SCHOOLPAY_NOT_CONFIGURED", "SchoolPay is not enabled for this school");
  const event = (await runtime.db.query<{ receiptNumber: string }>(
    `SELECT schoolpay_receipt_number AS "receiptNumber" FROM schoolpay_events WHERE id=$1 AND organization_id=$2`, [eventId, organizationId])).rows[0];
  if (!event) throw new AppError(404, "SCHOOLPAY_EVENT_NOT_FOUND", "SchoolPay event was not found");
  const lock = await runtime.db.connect(); const lockKey = `schoolpay:${organizationId}:${event.receiptNumber}`;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    try {
      await runtime.db.query(`UPDATE schoolpay_events SET status=CASE WHEN status='posted' THEN 'posted' ELSE 'received' END,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [eventId, organizationId]);
      return await postCapturedEvent(runtime, config, eventId);
    } catch (error) {
      await markEvent(runtime, organizationId, eventId, "failed", { error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) });
      throw error;
    }
  } finally {
    try { await lock.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } finally { lock.release(); }
  }
}

export async function listSchoolPayEvents(runtime: Runtime, organizationId: string, limit = 100) {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  const rows = await runtime.db.query(
    `SELECT id,schoolpay_receipt_number AS "schoolpayReceiptNumber",source_transaction_id AS "sourceTransactionId",
      source_payment_channel AS "sourcePaymentChannel",student_payment_code AS "studentPaymentCode",event_type AS "eventType",
      amount_minor::float8 AS "amountMinor",payment_date::text AS "paymentDate",status,capture_source AS "captureSource",
      reconciliation_run_id AS "reconciliationRunId",payment_id AS "paymentId",school_fee_receipt_id AS "schoolFeeReceiptId",
      error,processed_at AS "processedAt",last_seen_at AS "lastSeenAt",created_at AS "createdAt"
     FROM schoolpay_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`, [organizationId, bounded]);
  return rows.rows;
}

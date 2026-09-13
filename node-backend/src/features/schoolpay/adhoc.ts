import { createHash } from "node:crypto";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import {
  captureSchoolPayProviderPayment,
  schoolPayApiPassword,
  schoolPayConfigByOrganization,
  type SchoolPayConfigRow,
  type SchoolPayEventType,
} from "./service.js";

export type SchoolPayAdhocMethod = "register" | "request";

type SchoolPayAdhocIntentRow = {
  id: string;
  organizationId: string;
  studentPaymentCode: string;
  method: SchoolPayAdhocMethod;
  eventType: SchoolPayEventType;
  externalReference: string;
  paymentReference: string | null;
  amountMinor: number;
  phoneNumber: string | null;
  firstName: string;
  lastName: string;
  reason: string;
  callbackUrl: string;
  status: "initiating" | "pending" | "paid" | "posting_failed" | "failed";
  providerStatus: string | null;
  returnCode: number | null;
  returnMessage: string | null;
  receiptNumber: string | null;
  transactionId: string | null;
  channelName: string | null;
  schoolpayEventId: string | null;
  error: string | null;
};

type ProviderResponse = {
  paymentReference?: string;
  paymentCode?: string;
  receiptNumber?: string;
  transactionId?: string;
  status?: string;
  returnCode?: number | string;
  returnMessage?: string;
  paymentDateAndTime?: string;
  [key: string]: unknown;
};

export type SchoolPayAdhocCallback = {
  amount: string | number;
  channelName?: string | null;
  paymentReference: string;
  receiptNumber?: string | null;
  status: string;
  transactionId?: string | null;
  returnCode: string | number;
  [key: string]: unknown;
};

function amountMinor(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value.replace(/,/g, "").trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(422, "INVALID_SCHOOLPAY_AMOUNT", "SchoolPay amount must be a positive whole UGX amount");
  }
  return parsed;
}

function returnCode(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function publicBaseUrl(runtime: Runtime) {
  const value = runtime.config.SCHOOLPAY_PUBLIC_BASE_URL;
  if (!value) {
    throw new AppError(
      409,
      "SCHOOLPAY_PUBLIC_BASE_URL_REQUIRED",
      "SCHOOLPAY_PUBLIC_BASE_URL must be configured before using SchoolPay ad-hoc payments",
    );
  }
  return value.replace(/\/+$/, "");
}

function providerTimestamp(runtime: Runtime) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: runtime.config.SCHEDULER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function schoolPayAdhocHash(schoolCode: string, identifyingReference: string, apiPassword: string) {
  return createHash("md5")
    .update(`${schoolCode}${identifyingReference}${apiPassword}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function providerJson(runtime: Runtime, url: string, init: RequestInit): Promise<ProviderResponse> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "User-Agent": "Ledgerly-SchoolPay/1.2",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(502, "SCHOOLPAY_ADHOC_HTTP_ERROR", `SchoolPay ad-hoc API returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(text) as ProviderResponse;
  } catch {
    throw new AppError(502, "SCHOOLPAY_ADHOC_INVALID_RESPONSE", "SchoolPay ad-hoc API returned invalid JSON");
  }
}

async function intentByExternalReference(runtime: Runtime, organizationId: string, externalReference: string) {
  return (await runtime.db.query<SchoolPayAdhocIntentRow>(
    `SELECT id,organization_id AS "organizationId",student_payment_code AS "studentPaymentCode",method,event_type AS "eventType",
      external_reference AS "externalReference",payment_reference AS "paymentReference",amount_minor::float8 AS "amountMinor",
      phone_number AS "phoneNumber",first_name AS "firstName",last_name AS "lastName",reason,callback_url AS "callbackUrl",
      status,provider_status AS "providerStatus",return_code AS "returnCode",return_message AS "returnMessage",
      receipt_number AS "receiptNumber",transaction_id AS "transactionId",channel_name AS "channelName",
      schoolpay_event_id AS "schoolpayEventId",error
     FROM schoolpay_adhoc_intents WHERE organization_id=$1 AND external_reference=$2`,
    [organizationId, externalReference],
  )).rows[0];
}

async function intentByPaymentReference(runtime: Runtime, organizationId: string, paymentReference: string) {
  return (await runtime.db.query<SchoolPayAdhocIntentRow>(
    `SELECT id,organization_id AS "organizationId",student_payment_code AS "studentPaymentCode",method,event_type AS "eventType",
      external_reference AS "externalReference",payment_reference AS "paymentReference",amount_minor::float8 AS "amountMinor",
      phone_number AS "phoneNumber",first_name AS "firstName",last_name AS "lastName",reason,callback_url AS "callbackUrl",
      status,provider_status AS "providerStatus",return_code AS "returnCode",return_message AS "returnMessage",
      receipt_number AS "receiptNumber",transaction_id AS "transactionId",channel_name AS "channelName",
      schoolpay_event_id AS "schoolpayEventId",error
     FROM schoolpay_adhoc_intents WHERE organization_id=$1 AND payment_reference=$2`,
    [organizationId, paymentReference],
  )).rows[0];
}

async function configByWebhookKey(runtime: Runtime, webhookKey: string): Promise<SchoolPayConfigRow | undefined> {
  const organization = (await runtime.db.query<{ organizationId: string }>(
    `SELECT organization_id AS "organizationId" FROM schoolpay_configurations WHERE webhook_key=$1 AND enabled=true`,
    [webhookKey],
  )).rows[0];
  return organization ? schoolPayConfigByOrganization(runtime, organization.organizationId) : undefined;
}

function sameIntent(existing: SchoolPayAdhocIntentRow, input: {
  studentPaymentCode: string;
  method: SchoolPayAdhocMethod;
  eventType: SchoolPayEventType;
  amountMinor: number;
  phoneNumber?: string | null;
  reason: string;
}) {
  return existing.studentPaymentCode === input.studentPaymentCode
    && existing.method === input.method
    && existing.eventType === input.eventType
    && Number(existing.amountMinor) === input.amountMinor
    && (existing.phoneNumber ?? null) === (input.phoneNumber ?? null)
    && existing.reason === input.reason;
}

export async function initiateSchoolPayAdhoc(runtime: Runtime, organizationId: string, actorId: string, input: {
  method: SchoolPayAdhocMethod;
  eventType: SchoolPayEventType;
  studentPaymentCode: string;
  externalReference: string;
  amount: string | number;
  reason: string;
  phoneNumber?: string | null;
}) {
  const config = await schoolPayConfigByOrganization(runtime, organizationId);
  if (!config) throw new AppError(409, "SCHOOLPAY_NOT_CONFIGURED", "SchoolPay is not enabled for this school");

  const studentPaymentCode = input.studentPaymentCode.trim();
  const externalReference = input.externalReference.trim();
  const reason = input.reason.trim();
  const phoneNumber = input.phoneNumber?.trim() || null;
  const valueMinor = amountMinor(input.amount);
  if (!studentPaymentCode || !externalReference || !reason) {
    throw new AppError(422, "INVALID_SCHOOLPAY_ADHOC_REQUEST", "studentPaymentCode, externalReference and reason are required");
  }
  if (input.method === "request" && !phoneNumber) {
    throw new AppError(422, "SCHOOLPAY_PHONE_REQUIRED", "phoneNumber is required for an instant SchoolPay debit request");
  }

  const student = (await runtime.db.query<{ firstName: string; lastName: string }>(
    `SELECT first_name AS "firstName",last_name AS "lastName" FROM school_students
     WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL AND status='active'`,
    [studentPaymentCode, organizationId],
  )).rows[0];
  if (!student) {
    throw new AppError(404, "SCHOOLPAY_STUDENT_NOT_FOUND", "No active student exists with this SchoolPay studentPaymentCode");
  }

  const callbackUrl = `${publicBaseUrl(runtime)}/webhooks/schoolpay/${config.webhookKey}/adhoc`;
  const lock = await runtime.db.connect();
  const lockKey = `schoolpay:adhoc:${organizationId}:${externalReference}`;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    let intent = await intentByExternalReference(runtime, organizationId, externalReference);
    if (intent && !sameIntent(intent, {
      studentPaymentCode,
      method: input.method,
      eventType: input.eventType,
      amountMinor: valueMinor,
      phoneNumber,
      reason,
    })) {
      throw new AppError(409, "SCHOOLPAY_EXTERNAL_REFERENCE_CONFLICT", "This externalReference was already used with different payment details");
    }
    if (intent?.paymentReference) {
      return { ...intent, duplicate: true };
    }

    const requestBody = {
      amount: valueMinor,
      externalReference,
      ...(input.method === "request" ? { phoneNumber } : {}),
      firstName: student.firstName,
      lastName: student.lastName,
      reason,
      callBackUrl: callbackUrl,
    };

    if (!intent) {
      const id = createId("spa");
      await runtime.db.query(
        `INSERT INTO schoolpay_adhoc_intents(
          id,organization_id,student_payment_code,method,event_type,external_reference,amount_minor,phone_number,
          first_name,last_name,reason,callback_url,status,request_payload,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'initiating',$13::jsonb,$14)`,
        [id, organizationId, studentPaymentCode, input.method, input.eventType, externalReference, valueMinor, phoneNumber,
          student.firstName, student.lastName, reason, callbackUrl, JSON.stringify(requestBody), actorId],
      );
      intent = await intentByExternalReference(runtime, organizationId, externalReference);
    } else {
      await runtime.db.query(
        `UPDATE schoolpay_adhoc_intents SET status='initiating',error=NULL,request_payload=$1::jsonb,updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND organization_id=$3`,
        [JSON.stringify(requestBody), intent.id, organizationId],
      );
    }
    if (!intent) throw new Error("SchoolPay ad-hoc intent could not be created");

    const hash = schoolPayAdhocHash(config.schoolCode, externalReference, schoolPayApiPassword(runtime, config));
    const endpoint = input.method === "register" ? "Register" : "Request";
    let provider: ProviderResponse;
    try {
      provider = await providerJson(
        runtime,
        `${runtime.config.SCHOOLPAY_API_BASE_URL.replace(/\/+$/, "")}/paymentapi/AndroidRS/AdhocPayments/${endpoint}/${encodeURIComponent(config.schoolCode)}/${hash}`,
        { method: "POST", body: JSON.stringify(requestBody) },
      );
    } catch (error) {
      await runtime.db.query(
        `UPDATE schoolpay_adhoc_intents SET status='failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,
        [error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), intent.id, organizationId],
      );
      throw error;
    }

    const code = returnCode(provider.returnCode);
    const paymentReference = typeof provider.paymentReference === "string" ? provider.paymentReference.trim() : "";
    const providerStatus = typeof provider.status === "string" ? provider.status.trim() : null;
    const failed = code !== 0 || !paymentReference;
    await runtime.db.query(
      `UPDATE schoolpay_adhoc_intents SET payment_reference=NULLIF($1,''),provider_status=$2,return_code=$3,return_message=$4,
       provider_response=$5::jsonb,status=$6,error=$7,updated_at=CURRENT_TIMESTAMP WHERE id=$8 AND organization_id=$9`,
      [paymentReference, providerStatus, code, provider.returnMessage ?? null, JSON.stringify(provider), failed ? "failed" : "pending",
        failed ? (provider.returnMessage ?? "SchoolPay did not return a paymentReference") : null, intent.id, organizationId],
    );
    if (failed) {
      throw new AppError(502, "SCHOOLPAY_ADHOC_REJECTED", provider.returnMessage || "SchoolPay rejected the ad-hoc payment request");
    }
    const created = await intentByExternalReference(runtime, organizationId, externalReference);
    if (!created) throw new Error("SchoolPay ad-hoc intent could not be resolved after provider response");
    return { ...created, duplicate: false };
  } finally {
    try { await lock.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } finally { lock.release(); }
  }
}

async function verifyAndPostPaidIntent(runtime: Runtime, config: SchoolPayConfigRow, intent: SchoolPayAdhocIntentRow, provider: ProviderResponse) {
  const code = returnCode(provider.returnCode);
  const providerStatus = typeof provider.status === "string" ? provider.status.trim() : "";
  const receiptNumber = typeof provider.receiptNumber === "string" ? provider.receiptNumber.trim() : intent.receiptNumber ?? "";
  const transactionId = typeof provider.transactionId === "string" ? provider.transactionId.trim() : intent.transactionId;

  await runtime.db.query(
    `UPDATE schoolpay_adhoc_intents SET provider_status=$1,return_code=$2,return_message=$3,last_check_payload=$4::jsonb,
     receipt_number=COALESCE(NULLIF($5,''),receipt_number),transaction_id=COALESCE($6,transaction_id),last_checked_at=CURRENT_TIMESTAMP,
     updated_at=CURRENT_TIMESTAMP WHERE id=$7 AND organization_id=$8`,
    [providerStatus || null, code, provider.returnMessage ?? null, JSON.stringify(provider), receiptNumber, transactionId ?? null, intent.id, intent.organizationId],
  );

  if (code !== 0) {
    throw new AppError(502, "SCHOOLPAY_ADHOC_CHECK_REJECTED", provider.returnMessage || `SchoolPay status check returned code ${code}`);
  }
  if (providerStatus.toUpperCase() !== "PAID") {
    await runtime.db.query(
      `UPDATE schoolpay_adhoc_intents SET status=CASE WHEN status='paid' THEN 'paid' ELSE 'pending' END,error=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND organization_id=$2`, [intent.id, intent.organizationId],
    );
    return { paymentReference: intent.paymentReference, providerStatus: providerStatus || null, status: "pending" as const };
  }
  if (!receiptNumber) {
    await runtime.db.query(
      `UPDATE schoolpay_adhoc_intents SET status='posting_failed',error='SchoolPay reported PAID without a receipt number',updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND organization_id=$2`, [intent.id, intent.organizationId],
    );
    throw new AppError(502, "SCHOOLPAY_ADHOC_RECEIPT_MISSING", "SchoolPay reported PAID without a receipt number");
  }

  const paymentDateAndTime = typeof provider.paymentDateAndTime === "string" && provider.paymentDateAndTime.trim()
    ? provider.paymentDateAndTime.trim()
    : providerTimestamp(runtime);
  const capture = await captureSchoolPayProviderPayment(
    runtime,
    config,
    intent.eventType,
    {
      amount: Number(intent.amountMinor),
      paymentDateAndTime,
      schoolpayReceiptNumber: receiptNumber,
      sourceChannelTransactionId: transactionId ?? null,
      sourcePaymentChannel: intent.channelName ?? "SchoolPay Adhoc",
      studentPaymentCode: intent.studentPaymentCode,
      studentName: `${intent.firstName} ${intent.lastName}`.trim(),
      transactionCompletionStatus: "Completed",
    },
    { adhocIntentId: intent.id, provider },
    "adhoc",
  );

  const posted = capture.status === "posted";
  await runtime.db.query(
    `UPDATE schoolpay_adhoc_intents SET status=$1,provider_status='PAID',receipt_number=$2,transaction_id=COALESCE($3,transaction_id),
     schoolpay_event_id=$4,error=$5,paid_at=CASE WHEN $1='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END,
     updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND organization_id=$7`,
    [posted ? "paid" : "posting_failed", receiptNumber, transactionId ?? null, capture.eventId,
      posted ? null : `Ledgerly posting status: ${capture.status}`, intent.id, intent.organizationId],
  );
  return {
    paymentReference: intent.paymentReference,
    providerStatus: "PAID",
    status: posted ? "paid" as const : "posting_failed" as const,
    eventId: capture.eventId,
    postingStatus: capture.status,
  };
}

export async function refreshSchoolPayAdhocStatus(runtime: Runtime, organizationId: string, paymentReference: string) {
  const reference = paymentReference.trim();
  const intent = await intentByPaymentReference(runtime, organizationId, reference);
  if (!intent) throw new AppError(404, "SCHOOLPAY_ADHOC_NOT_FOUND", "SchoolPay ad-hoc payment was not found");
  if (intent.status === "paid") {
    return { paymentReference: reference, providerStatus: intent.providerStatus, status: "paid" as const, eventId: intent.schoolpayEventId };
  }
  const config = await schoolPayConfigByOrganization(runtime, organizationId);
  if (!config) throw new AppError(409, "SCHOOLPAY_NOT_CONFIGURED", "SchoolPay is not enabled for this school");
  const hash = schoolPayAdhocHash(config.schoolCode, reference, schoolPayApiPassword(runtime, config));
  const provider = await providerJson(
    runtime,
    `${runtime.config.SCHOOLPAY_API_BASE_URL.replace(/\/+$/, "")}/paymentapi/AndroidRS/AdhocPayments/Check/${encodeURIComponent(config.schoolCode)}/${hash}/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
  return verifyAndPostPaidIntent(runtime, config, intent, provider);
}

export async function captureSchoolPayAdhocCallback(runtime: Runtime, webhookKey: string, payload: SchoolPayAdhocCallback) {
  const config = await configByWebhookKey(runtime, webhookKey);
  if (!config) throw new AppError(404, "SCHOOLPAY_WEBHOOK_NOT_FOUND", "SchoolPay webhook endpoint is not configured");
  const paymentReference = payload.paymentReference.trim();
  const intent = await intentByPaymentReference(runtime, config.organizationId, paymentReference);
  if (!intent) throw new AppError(404, "SCHOOLPAY_ADHOC_NOT_FOUND", "SchoolPay ad-hoc payment reference is unknown");

  const callbackAmount = amountMinor(payload.amount);
  await runtime.db.query(
    `UPDATE schoolpay_adhoc_intents SET last_callback_payload=$1::jsonb,callback_received_at=CURRENT_TIMESTAMP,
     channel_name=COALESCE($2,channel_name),receipt_number=COALESCE($3,receipt_number),transaction_id=COALESCE($4,transaction_id),
     provider_status=$5,return_code=$6,updated_at=CURRENT_TIMESTAMP WHERE id=$7 AND organization_id=$8`,
    [JSON.stringify(payload), payload.channelName?.trim() || null, payload.receiptNumber?.trim() || null,
      payload.transactionId?.trim() || null, payload.status.trim(), returnCode(payload.returnCode), intent.id, config.organizationId],
  );

  if (callbackAmount !== Number(intent.amountMinor)) {
    await runtime.db.query(
      `UPDATE schoolpay_adhoc_intents SET status='posting_failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,
      [`SchoolPay callback amount ${callbackAmount} does not match registered amount ${intent.amountMinor}`, intent.id, config.organizationId],
    );
    return { accepted: true, verified: false, status: "amount_mismatch" as const };
  }
  if (payload.status.trim().toUpperCase() !== "PAID" || returnCode(payload.returnCode) !== 0) {
    return { accepted: true, verified: false, status: "ignored" as const };
  }

  const refreshed = await refreshSchoolPayAdhocStatus(runtime, config.organizationId, paymentReference);
  return { accepted: true, verified: refreshed.providerStatus === "PAID", ...refreshed };
}

export async function listSchoolPayAdhocIntents(runtime: Runtime, organizationId: string, limit = 100) {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  const rows = await runtime.db.query(
    `SELECT id,student_payment_code AS "studentPaymentCode",method,event_type AS "eventType",external_reference AS "externalReference",
      payment_reference AS "paymentReference",amount_minor::float8 AS "amountMinor",phone_number AS "phoneNumber",
      first_name AS "firstName",last_name AS "lastName",reason,status,provider_status AS "providerStatus",
      return_code AS "returnCode",return_message AS "returnMessage",receipt_number AS "receiptNumber",
      transaction_id AS "transactionId",channel_name AS "channelName",schoolpay_event_id AS "schoolpayEventId",error,
      callback_received_at AS "callbackReceivedAt",last_checked_at AS "lastCheckedAt",paid_at AS "paidAt",created_at AS "createdAt"
     FROM schoolpay_adhoc_intents WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [organizationId, bounded],
  );
  return rows.rows;
}

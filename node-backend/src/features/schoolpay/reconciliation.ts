import { createHash } from "node:crypto";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import {
  captureSchoolPayProviderPayment,
  schoolPayApiPassword,
  schoolPayConfigByOrganization,
  type SchoolPayEventType,
  type SchoolPayFeePayment,
} from "./service.js";

type SchoolPaySyncResponse = {
  returnCode?: number | string;
  returnMessage?: string;
  transactions?: SchoolPayFeePayment[] | null;
  supplementaryFeePayments?: SchoolPayFeePayment[] | null;
};

export function schoolPaySyncHash(schoolCode: string, identifyingDate: string, apiPassword: string) {
  return createHash("md5").update(`${schoolCode}${identifyingDate}${apiPassword}`, "utf8").digest("hex").toUpperCase();
}

function dateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(422, "INVALID_SCHOOLPAY_DATE", "SchoolPay reconciliation dates must use YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const millis = Date.UTC(year!, month! - 1, day!);
  if (new Date(millis).toISOString().slice(0, 10) !== value) throw new AppError(422, "INVALID_SCHOOLPAY_DATE", "SchoolPay reconciliation date is invalid");
  return millis;
}

export function validateSchoolPayDateRange(fromDate: string, toDate: string) {
  const from = dateValue(fromDate), to = dateValue(toDate);
  if (to < from) throw new AppError(422, "INVALID_SCHOOLPAY_DATE_RANGE", "SchoolPay reconciliation toDate cannot be before fromDate");
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days > 31) throw new AppError(422, "SCHOOLPAY_DATE_RANGE_TOO_LARGE", "SchoolPay reconciliation is limited to 31 days per request");
  return { days };
}

async function finishFailedRun(runtime: Runtime, organizationId: string, runId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
  await runtime.db.query(
    `UPDATE schoolpay_reconciliation_runs SET status='failed',error=$1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 AND organization_id=$3`, [message, runId, organizationId]);
}

export async function reconcileSchoolPayTransactions(runtime: Runtime, organizationId: string, actorId: string, fromDate: string, toDate = fromDate) {
  validateSchoolPayDateRange(fromDate, toDate);
  const config = await schoolPayConfigByOrganization(runtime, organizationId);
  if (!config) throw new AppError(409, "SCHOOLPAY_NOT_CONFIGURED", "SchoolPay is not enabled for this school");
  if (fromDate < config.importStartDate) {
    throw new AppError(
      422,
      "SCHOOLPAY_BEFORE_IMPORT_START_DATE",
      `SchoolPay reconciliation cannot start before the configured import start date ${config.importStartDate}`,
      { importStartDate: config.importStartDate, requestedFromDate: fromDate },
    );
  }
  const runId = createId("spr");
  await runtime.db.query(
    `INSERT INTO schoolpay_reconciliation_runs(id,organization_id,from_date,to_date,status,created_by)
     VALUES($1,$2,$3,$4,'running',$5)`, [runId, organizationId, fromDate, toDate, actorId]);

  try {
    const password = schoolPayApiPassword(runtime, config);
    const hash = schoolPaySyncHash(config.schoolCode, fromDate, password);
    const base = runtime.config.SCHOOLPAY_API_BASE_URL.replace(/\/+$/, "");
    const school = encodeURIComponent(config.schoolCode), from = encodeURIComponent(fromDate), to = encodeURIComponent(toDate);
    const path = fromDate === toDate
      ? `/paymentapi/AndroidRS/SyncSchoolTransactions/${school}/${from}/${hash}`
      : `/paymentapi/AndroidRS/SchoolRangeTransactions/${school}/${from}/${to}/${hash}`;
    const response = await fetch(`${base}${path}`, {
      method: "GET", redirect: "error", headers: { Accept: "application/json", "User-Agent": "Ledgerly-SchoolPay/1.1" },
      signal: AbortSignal.timeout(20_000),
    });
    const bodyText = await response.text();
    if (!response.ok) throw new AppError(500, "SCHOOLPAY_SYNC_HTTP_ERROR", `SchoolPay reconciliation returned HTTP ${response.status}`);
    let body: SchoolPaySyncResponse;
    try { body = JSON.parse(bodyText) as SchoolPaySyncResponse; }
    catch { throw new AppError(500, "SCHOOLPAY_SYNC_INVALID_RESPONSE", "SchoolPay reconciliation returned invalid JSON"); }
    const returnCode = Number(body.returnCode ?? -1);
    if (returnCode !== 0) throw new AppError(500, "SCHOOLPAY_SYNC_REJECTED", body.returnMessage || `SchoolPay returned code ${String(body.returnCode)}`);

    const regular = Array.isArray(body.transactions) ? body.transactions : [];
    const supplementary = Array.isArray(body.supplementaryFeePayments) ? body.supplementaryFeePayments : [];
    const items: Array<{ type: SchoolPayEventType; payment: SchoolPayFeePayment }> = [
      ...regular.map((payment) => ({ type: "SCHOOL_FEES" as const, payment })),
      ...supplementary.map((payment) => ({ type: "OTHER_FEES" as const, payment })),
    ];
    const counts = { fetched: items.length, fresh: 0, duplicate: 0, posted: 0, unmatched: 0, failed: 0, ignored: 0 };
    for (const item of items) {
      const result = await captureSchoolPayProviderPayment(runtime, config, item.type, item.payment, item.payment, "sync", runId);
      if (result.duplicate) counts.duplicate++; else counts.fresh++;
      if (result.status === "posted") counts.posted++;
      else if (result.status === "unmatched") counts.unmatched++;
      else if (result.status === "failed") counts.failed++;
      else if (result.status === "ignored") counts.ignored++;
    }
    await runtime.db.query(
      `UPDATE schoolpay_reconciliation_runs SET status='completed',fetched_count=$1,new_count=$2,duplicate_count=$3,posted_count=$4,
       unmatched_count=$5,failed_count=$6,ignored_count=$7,return_code=$8,return_message=$9,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 AND organization_id=$11`,
      [counts.fetched, counts.fresh, counts.duplicate, counts.posted, counts.unmatched, counts.failed, counts.ignored,
        returnCode, body.returnMessage ?? null, runId, organizationId]);
    await runtime.db.query(`UPDATE schoolpay_configurations SET last_reconciled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`, [organizationId]);
    return { id: runId, organizationId, fromDate, toDate, status: "completed" as const, ...counts, returnCode, returnMessage: body.returnMessage ?? null };
  } catch (error) {
    await finishFailedRun(runtime, organizationId, runId, error);
    throw error;
  }
}

export async function listSchoolPayReconciliations(runtime: Runtime, organizationId: string, limit = 50) {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const rows = await runtime.db.query(
    `SELECT id,from_date::text AS "fromDate",to_date::text AS "toDate",status,fetched_count AS "fetchedCount",
      new_count AS "newCount",duplicate_count AS "duplicateCount",posted_count AS "postedCount",unmatched_count AS "unmatchedCount",
      failed_count AS "failedCount",ignored_count AS "ignoredCount",return_code AS "returnCode",return_message AS "returnMessage",
      error,created_by AS "createdBy",started_at AS "startedAt",completed_at AS "completedAt"
     FROM schoolpay_reconciliation_runs WHERE organization_id=$1 ORDER BY started_at DESC LIMIT $2`, [organizationId, bounded]);
  return rows.rows;
}

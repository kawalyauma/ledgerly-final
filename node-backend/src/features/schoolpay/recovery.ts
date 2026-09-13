import type { Runtime } from "../../runtime.js";
import {
  captureSchoolPayAdhocCallback,
  refreshSchoolPayAdhocStatus,
  type SchoolPayAdhocCallback,
} from "./adhoc.js";

export function schoolPayAdhocRecoveryDelayMinutes(attemptNumber: number) {
  const attempt = Math.max(1, Math.trunc(attemptNumber) || 1);
  if (attempt <= 1) return 5;
  if (attempt === 2) return 10;
  if (attempt === 3) return 15;
  if (attempt === 4) return 30;
  return 60;
}

async function withPaymentReferenceLock<T>(runtime: Runtime, paymentReference: string, work: () => Promise<T>) {
  const reference = paymentReference.trim();
  const connection = await runtime.db.connect();
  const lockKey = `schoolpay:adhoc-status:${reference}`;
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    return await work();
  } finally {
    try {
      await connection.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]);
    } finally {
      connection.release();
    }
  }
}

export async function refreshSchoolPayAdhocStatusLocked(runtime: Runtime, organizationId: string, paymentReference: string) {
  return withPaymentReferenceLock(runtime, paymentReference, () =>
    refreshSchoolPayAdhocStatus(runtime, organizationId, paymentReference));
}

export async function captureSchoolPayAdhocCallbackLocked(
  runtime: Runtime,
  webhookKey: string,
  payload: SchoolPayAdhocCallback,
) {
  return withPaymentReferenceLock(runtime, payload.paymentReference, () =>
    captureSchoolPayAdhocCallback(runtime, webhookKey, payload));
}

type RecoverableIntent = {
  id: string;
  organizationId: string;
  paymentReference: string;
  recoveryAttempts: number;
};

export async function recoverPendingSchoolPayAdhoc(runtime: Runtime, options: {
  organizationId?: string;
  limit?: number;
  force?: boolean;
} = {}) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const rows = await runtime.db.query<RecoverableIntent>(
    `SELECT i.id,i.organization_id AS "organizationId",i.payment_reference AS "paymentReference",
       i.recovery_attempts AS "recoveryAttempts"
     FROM schoolpay_adhoc_intents i
     JOIN schoolpay_configurations c ON c.organization_id=i.organization_id AND c.enabled=true
     WHERE i.status IN ('pending','posting_failed')
       AND i.payment_reference IS NOT NULL
       AND ($1::text IS NULL OR i.organization_id=$1)
       AND ($3::boolean OR (
         i.created_at>=CURRENT_TIMESTAMP-INTERVAL '7 days'
         AND (i.next_recovery_at IS NULL OR i.next_recovery_at<=CURRENT_TIMESTAMP)
       ))
     ORDER BY COALESCE(i.next_recovery_at,i.created_at),i.created_at,i.id
     LIMIT $2`,
    [options.organizationId ?? null, limit, options.force === true],
  );

  const counts = { selected: rows.rows.length, checked: 0, paid: 0, pending: 0, postingFailed: 0, errors: 0 };
  for (const intent of rows.rows) {
    const attemptNumber = Number(intent.recoveryAttempts) + 1;
    const delayMinutes = schoolPayAdhocRecoveryDelayMinutes(attemptNumber);
    const nextRecoveryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    try {
      const result = await refreshSchoolPayAdhocStatusLocked(runtime, intent.organizationId, intent.paymentReference);
      counts.checked++;
      if (result.status === "paid") counts.paid++;
      else if (result.status === "posting_failed") counts.postingFailed++;
      else counts.pending++;
      await runtime.db.query(
        `UPDATE schoolpay_adhoc_intents
         SET recovery_attempts=recovery_attempts+1,recovery_checked_at=CURRENT_TIMESTAMP,last_recovery_error=NULL,
           next_recovery_at=CASE WHEN $1='paid' THEN NULL ELSE $2::timestamptz END,updated_at=CURRENT_TIMESTAMP
         WHERE id=$3 AND organization_id=$4`,
        [result.status, nextRecoveryAt, intent.id, intent.organizationId],
      );
    } catch (error) {
      counts.errors++;
      const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
      await runtime.db.query(
        `UPDATE schoolpay_adhoc_intents
         SET recovery_attempts=recovery_attempts+1,recovery_checked_at=CURRENT_TIMESTAMP,last_recovery_error=$1,
           next_recovery_at=$2::timestamptz,updated_at=CURRENT_TIMESTAMP
         WHERE id=$3 AND organization_id=$4`,
        [message, nextRecoveryAt, intent.id, intent.organizationId],
      );
      runtime.logger.warn(
        { err: error, organizationId: intent.organizationId, paymentReference: intent.paymentReference },
        "SchoolPay ad-hoc recovery status check failed",
      );
    }
  }
  return counts;
}

import type { Runtime } from "../../runtime.js";
import { schoolPayConfigSummary } from "./service.js";

type EventStats = {
  failed: number;
  unmatched: number;
  received: number;
  posted24h: number;
  latestEventAt: string | null;
};

type AdhocStats = {
  pending: number;
  postingFailed: number;
  failed: number;
  paid24h: number;
  recoveryDue: number;
  stalePending: number;
  oldestPendingAt: string | null;
  recoveryErrors24h: number;
};

type ReconciliationRow = {
  id: string;
  status: string;
  fromDate: string;
  toDate: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

function ageMinutes(value: string | null | undefined) {
  if (!value) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return Math.max(0, Math.floor((Date.now() - millis) / 60_000));
}

export async function getSchoolPayDiagnostics(runtime: Runtime, organizationId: string) {
  const config = await schoolPayConfigSummary(runtime, organizationId);
  if (!config.configured) {
    return {
      status: "not_configured" as const,
      configured: false,
      recommendations: ["Configure this school's SchoolPay account before accepting payments."],
    };
  }

  const [events, adhoc, reconciliation] = await Promise.all([
    runtime.db.query<EventStats>(
      `SELECT
         COUNT(*) FILTER (WHERE status='failed')::int AS failed,
         COUNT(*) FILTER (WHERE status='unmatched')::int AS unmatched,
         COUNT(*) FILTER (WHERE status='received')::int AS received,
         COUNT(*) FILTER (WHERE status='posted' AND created_at>=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "posted24h",
         MAX(created_at)::text AS "latestEventAt"
       FROM schoolpay_events WHERE organization_id=$1`,
      [organizationId],
    ),
    runtime.db.query<AdhocStats>(
      `SELECT
         COUNT(*) FILTER (WHERE status='pending')::int AS pending,
         COUNT(*) FILTER (WHERE status='posting_failed')::int AS "postingFailed",
         COUNT(*) FILTER (WHERE status='failed')::int AS failed,
         COUNT(*) FILTER (WHERE status='paid' AND paid_at>=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "paid24h",
         COUNT(*) FILTER (WHERE status IN ('pending','posting_failed') AND payment_reference IS NOT NULL
           AND (next_recovery_at IS NULL OR next_recovery_at<=CURRENT_TIMESTAMP))::int AS "recoveryDue",
         COUNT(*) FILTER (WHERE status='pending' AND created_at<CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "stalePending",
         MIN(created_at) FILTER (WHERE status='pending')::text AS "oldestPendingAt",
         COUNT(*) FILTER (WHERE last_recovery_error IS NOT NULL AND recovery_checked_at>=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "recoveryErrors24h"
       FROM schoolpay_adhoc_intents WHERE organization_id=$1`,
      [organizationId],
    ),
    runtime.db.query<ReconciliationRow>(
      `SELECT id,status,from_date::text AS "fromDate",to_date::text AS "toDate",started_at::text AS "startedAt",
         completed_at::text AS "completedAt",error
       FROM schoolpay_reconciliation_runs WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 1`,
      [organizationId],
    ),
  ]);

  const eventStats = events.rows[0] ?? { failed: 0, unmatched: 0, received: 0, posted24h: 0, latestEventAt: null };
  const adhocStats = adhoc.rows[0] ?? {
    pending: 0,
    postingFailed: 0,
    failed: 0,
    paid24h: 0,
    recoveryDue: 0,
    stalePending: 0,
    oldestPendingAt: null,
    recoveryErrors24h: 0,
  };
  const latestReconciliation = reconciliation.rows[0] ?? null;
  const reconciliationAgeMinutes = ageMinutes(config.lastReconciledAt);
  const recommendations: string[] = [];

  let status: "healthy" | "degraded" | "action_required" | "disabled" = config.enabled ? "healthy" : "disabled";
  if (config.enabled) {
    if (eventStats.failed > 0 || eventStats.unmatched > 0 || adhocStats.postingFailed > 0 || latestReconciliation?.status === "failed") {
      status = "action_required";
    } else if (
      reconciliationAgeMinutes === null
      || reconciliationAgeMinutes > 180
      || adhocStats.recoveryDue > 0
      || adhocStats.recoveryErrors24h > 0
      || !runtime.config.SCHOOLPAY_PUBLIC_BASE_URL
    ) {
      status = "degraded";
    }
  }

  if (!config.enabled) recommendations.push("Enable SchoolPay for this school when its credentials and posting accounts are ready.");
  if (!runtime.config.SCHOOLPAY_PUBLIC_BASE_URL) recommendations.push("Set SCHOOLPAY_PUBLIC_BASE_URL so SchoolPay can deliver ad-hoc callbacks.");
  if (reconciliationAgeMinutes === null) recommendations.push("Run the first SchoolPay reconciliation for this school.");
  else if (reconciliationAgeMinutes > 180) recommendations.push("SchoolPay reconciliation is stale; check the scheduler and provider connectivity.");
  if (eventStats.unmatched > 0) recommendations.push("Resolve unmatched SchoolPay student payment codes, then retry those events.");
  if (eventStats.failed > 0) recommendations.push("Retry failed SchoolPay events after resolving their posting errors.");
  if (adhocStats.postingFailed > 0) recommendations.push("Recover ad-hoc payments that SchoolPay marked paid but Ledgerly has not posted successfully.");
  if (adhocStats.recoveryDue > 0) recommendations.push("Ad-hoc status recovery has due work; verify the queue/scheduler worker is running.");
  if (adhocStats.recoveryErrors24h > 0) recommendations.push("Recent ad-hoc recovery checks failed; verify SchoolPay API connectivity and credentials.");
  if (latestReconciliation?.status === "failed") recommendations.push("The latest SchoolPay reconciliation failed; inspect its error and rerun it.");

  return {
    status,
    configured: true,
    enabled: config.enabled,
    schoolCode: config.schoolCode,
    webhookPath: config.webhookPath,
    adhocCallbackPath: `${config.webhookPath}/adhoc`,
    publicBaseUrlConfigured: Boolean(runtime.config.SCHOOLPAY_PUBLIC_BASE_URL),
    autoAllocate: config.autoAllocate,
    lastWebhookAt: config.lastWebhookAt,
    lastReconciledAt: config.lastReconciledAt,
    reconciliationAgeMinutes,
    events: eventStats,
    adhoc: adhocStats,
    latestReconciliation,
    schedules: {
      transactionReconciliation: "hourly at minute 15",
      adhocRecovery: "every 5 minutes",
    },
    recommendations,
  };
}

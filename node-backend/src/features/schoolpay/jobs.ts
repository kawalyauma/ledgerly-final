import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";
import { reconcileSchoolPayTransactions } from "./reconciliation.js";

function dateInZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function recoverSchoolPayTransactions(_job: ClaimedJob, runtime: Runtime) {
  const schools = await runtime.db.query<{ organizationId: string }>(
    `SELECT organization_id AS "organizationId" FROM schoolpay_configurations WHERE enabled=true ORDER BY organization_id`,
  );
  if (!schools.rowCount) return;
  const now = new Date();
  const today = dateInZone(now, runtime.config.SCHEDULER_TIMEZONE);
  const yesterday = dateInZone(new Date(now.getTime() - 86_400_000), runtime.config.SCHEDULER_TIMEZONE);
  const failures: string[] = [];
  for (const school of schools.rows) {
    try {
      await reconcileSchoolPayTransactions(runtime, school.organizationId, "system:schoolpay", yesterday, today);
    } catch (error) {
      failures.push(school.organizationId);
      runtime.logger.error({ err: error, organizationId: school.organizationId }, "Scheduled SchoolPay reconciliation failed");
    }
  }
  if (failures.length) throw new Error(`SchoolPay reconciliation failed for ${failures.length} school(s)`);
}
